import type { Db } from 'mongodb';
import { fetchBinanceSpotKlines, type ClosedCandle, type QuantSignal } from './signalEngine.js';

export type TrackedSignalStatus = 'OPEN' | 'TP_HIT' | 'SL_HIT' | 'EXPIRED';

export interface SignalHistoryRecord {
  signalKey: string;
  pair: string;
  symbol: string;
  assetClass: 'CRYPTO' | 'FOREX_COMMODITY';
  type: 'BUY' | 'SELL';
  entry: number;
  takeProfit: number;
  stopLoss: number;
  confidence: number;
  riskRewardRatio: string;
  timeframe: string;
  source: string;
  closedCandleTime: string;
  openedAt: string;
  status: TrackedSignalStatus;
  resolvedAt: string | null;
  exitPrice: number | null;
  resolutionReason: string | null;
  pnlPct: number | null;
  rMultiple: number | null;
}

export interface SignalTrackRecordSummary {
  totalTracked: number;
  openCount: number;
  resolvedCount: number;
  tpHits: number;
  slHits: number;
  expiredCount: number;
  decidedCount: number;
  winRatePct: number | null;
  netRMultiple: number;
  avgRMultiple: number | null;
  since: string | null;
}

export interface SignalResolutionOutcome {
  status: 'TP_HIT' | 'SL_HIT' | 'EXPIRED';
  resolvedAt: string;
  exitPrice: number;
  pnlPct: number;
  rMultiple: number;
  resolutionReason: string;
}

const EXPIRY_MS = 72 * 60 * 60 * 1000;

function roundNum(val: number, digits = 2): number {
  return Number.isFinite(val) ? parseFloat(val.toFixed(digits)) : 0;
}

function roundExitPrice(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= 1000) return parseFloat(value.toFixed(2));
  if (value >= 1) return parseFloat(value.toFixed(4));
  return parseFloat(value.toFixed(6));
}

export function computeOutcomeMetrics(
  type: 'BUY' | 'SELL',
  entry: number,
  stopLoss: number,
  exitPrice: number
): { pnlPct: number; rMultiple: number } {
  const rawPnlPct = type === 'BUY' ? ((exitPrice - entry) / entry) * 100 : ((entry - exitPrice) / entry) * 100;
  const risk = Math.abs(entry - stopLoss);
  let rMultiple = 0;
  if (risk > 0) {
    rMultiple = type === 'BUY' ? (exitPrice - entry) / risk : (entry - exitPrice) / risk;
  }
  return {
    pnlPct: roundNum(rawPnlPct, 2),
    rMultiple: roundNum(rMultiple, 2),
  };
}

/**
 * Evaluates an open trade chronologically against closed 15m candles starting strictly
 * after the signal's anchor closed candle time. Conservative audit rule: if both Stop Loss
 * and Take Profit are touched within the same 15m bar, Stop Loss takes precedence.
 */
export function evaluateCandlesAgainstSignal(
  sig: Pick<SignalHistoryRecord, 'type' | 'entry' | 'takeProfit' | 'stopLoss' | 'closedCandleTime' | 'openedAt'>,
  candles: ClosedCandle[],
  nowMs = Date.now()
): SignalResolutionOutcome | null {
  const anchorMs = Date.parse(sig.closedCandleTime || sig.openedAt);
  const openedMs = Date.parse(sig.openedAt || sig.closedCandleTime);
  if (!Number.isFinite(anchorMs) || !Number.isFinite(openedMs)) return null;

  const startMs = Math.max(anchorMs, openedMs);
  const eligible = candles
    .filter((c) => c.openTime >= startMs && c.closeTime <= nowMs)
    .sort((a, b) => a.openTime - b.openTime);

  for (const bar of eligible) {
    if (sig.type === 'BUY') {
      const hitSL = bar.low <= sig.stopLoss;
      const hitTP = bar.high >= sig.takeProfit;
      if (hitSL) {
        const { pnlPct, rMultiple } = computeOutcomeMetrics('BUY', sig.entry, sig.stopLoss, sig.stopLoss);
        return {
          status: 'SL_HIT',
          resolvedAt: new Date(bar.closeTime).toISOString(),
          exitPrice: roundExitPrice(sig.stopLoss),
          pnlPct,
          rMultiple,
          resolutionReason: hitTP
            ? 'Stop Loss triggered before Take Profit within same M15 candle (conservative rule)'
            : 'Stop Loss level touched on closed M15 candle',
        };
      }
      if (hitTP) {
        const { pnlPct, rMultiple } = computeOutcomeMetrics('BUY', sig.entry, sig.stopLoss, sig.takeProfit);
        return {
          status: 'TP_HIT',
          resolvedAt: new Date(bar.closeTime).toISOString(),
          exitPrice: roundExitPrice(sig.takeProfit),
          pnlPct,
          rMultiple,
          resolutionReason: 'Take Profit target reached on closed M15 candle',
        };
      }
    } else {
      const hitSL = bar.high >= sig.stopLoss;
      const hitTP = bar.low <= sig.takeProfit;
      if (hitSL) {
        const { pnlPct, rMultiple } = computeOutcomeMetrics('SELL', sig.entry, sig.stopLoss, sig.stopLoss);
        return {
          status: 'SL_HIT',
          resolvedAt: new Date(bar.closeTime).toISOString(),
          exitPrice: roundExitPrice(sig.stopLoss),
          pnlPct,
          rMultiple,
          resolutionReason: hitTP
            ? 'Stop Loss triggered before Take Profit within same M15 candle (conservative rule)'
            : 'Stop Loss level touched on closed M15 candle',
        };
      }
      if (hitTP) {
        const { pnlPct, rMultiple } = computeOutcomeMetrics('SELL', sig.entry, sig.stopLoss, sig.takeProfit);
        return {
          status: 'TP_HIT',
          resolvedAt: new Date(bar.closeTime).toISOString(),
          exitPrice: roundExitPrice(sig.takeProfit),
          pnlPct,
          rMultiple,
          resolutionReason: 'Take Profit target reached on closed M15 candle',
        };
      }
    }
  }

  if (nowMs - openedMs >= EXPIRY_MS) {
    const lastBar = eligible[eligible.length - 1];
    const exitPrice = roundExitPrice(lastBar ? lastBar.close : sig.entry);
    const { pnlPct, rMultiple } = computeOutcomeMetrics(sig.type, sig.entry, sig.stopLoss, exitPrice);
    return {
      status: 'EXPIRED',
      resolvedAt: new Date(nowMs).toISOString(),
      exitPrice,
      pnlPct,
      rMultiple,
      resolutionReason: 'Signal window expired after 72 hours without TP or SL execution',
    };
  }

  return null;
}

export function evaluatePriceAgainstSignal(
  sig: Pick<SignalHistoryRecord, 'type' | 'entry' | 'takeProfit' | 'stopLoss' | 'openedAt'>,
  currentPrice: number | null | undefined,
  nowMs = Date.now()
): SignalResolutionOutcome | null {
  const openedMs = Date.parse(sig.openedAt);
  if (!Number.isFinite(openedMs)) return null;

  if (typeof currentPrice === 'number' && Number.isFinite(currentPrice) && currentPrice > 0) {
    if (sig.type === 'BUY') {
      if (currentPrice <= sig.stopLoss) {
        const { pnlPct, rMultiple } = computeOutcomeMetrics('BUY', sig.entry, sig.stopLoss, sig.stopLoss);
        return {
          status: 'SL_HIT',
          resolvedAt: new Date(nowMs).toISOString(),
          exitPrice: roundExitPrice(sig.stopLoss),
          pnlPct,
          rMultiple,
          resolutionReason: 'Stop Loss reached in live market feed',
        };
      }
      if (currentPrice >= sig.takeProfit) {
        const { pnlPct, rMultiple } = computeOutcomeMetrics('BUY', sig.entry, sig.stopLoss, sig.takeProfit);
        return {
          status: 'TP_HIT',
          resolvedAt: new Date(nowMs).toISOString(),
          exitPrice: roundExitPrice(sig.takeProfit),
          pnlPct,
          rMultiple,
          resolutionReason: 'Take Profit reached in live market feed',
        };
      }
    } else {
      if (currentPrice >= sig.stopLoss) {
        const { pnlPct, rMultiple } = computeOutcomeMetrics('SELL', sig.entry, sig.stopLoss, sig.stopLoss);
        return {
          status: 'SL_HIT',
          resolvedAt: new Date(nowMs).toISOString(),
          exitPrice: roundExitPrice(sig.stopLoss),
          pnlPct,
          rMultiple,
          resolutionReason: 'Stop Loss reached in live market feed',
        };
      }
      if (currentPrice <= sig.takeProfit) {
        const { pnlPct, rMultiple } = computeOutcomeMetrics('SELL', sig.entry, sig.stopLoss, sig.takeProfit);
        return {
          status: 'TP_HIT',
          resolvedAt: new Date(nowMs).toISOString(),
          exitPrice: roundExitPrice(sig.takeProfit),
          pnlPct,
          rMultiple,
          resolutionReason: 'Take Profit reached in live market feed',
        };
      }
    }
  }

  if (nowMs - openedMs >= EXPIRY_MS) {
    const exitPrice = roundExitPrice(
      typeof currentPrice === 'number' && Number.isFinite(currentPrice) && currentPrice > 0
        ? currentPrice
        : sig.entry
    );
    const { pnlPct, rMultiple } = computeOutcomeMetrics(sig.type, sig.entry, sig.stopLoss, exitPrice);
    return {
      status: 'EXPIRED',
      resolvedAt: new Date(nowMs).toISOString(),
      exitPrice,
      pnlPct,
      rMultiple,
      resolutionReason: 'Signal window expired after 72 hours',
    };
  }

  return null;
}

export function computeTrackRecord(records: SignalHistoryRecord[]): SignalTrackRecordSummary {
  let openCount = 0;
  let tpHits = 0;
  let slHits = 0;
  let expiredCount = 0;
  let netRMultiple = 0;
  let since: string | null = null;

  for (const r of records) {
    if (r.openedAt && (!since || r.openedAt < since)) since = r.openedAt;
    if (r.status === 'OPEN') {
      openCount++;
      continue;
    }
    if (r.status === 'TP_HIT') tpHits++;
    else if (r.status === 'SL_HIT') slHits++;
    else if (r.status === 'EXPIRED') expiredCount++;
    if (typeof r.rMultiple === 'number' && Number.isFinite(r.rMultiple)) {
      netRMultiple += r.rMultiple;
    }
  }

  const resolvedCount = tpHits + slHits + expiredCount;
  const decidedCount = tpHits + slHits;
  const winRatePct = decidedCount > 0 ? roundNum((tpHits / decidedCount) * 100, 1) : null;
  const avgRMultiple = resolvedCount > 0 ? roundNum(netRMultiple / resolvedCount, 2) : null;

  return {
    totalTracked: records.length,
    openCount,
    resolvedCount,
    tpHits,
    slHits,
    expiredCount,
    decidedCount,
    winRatePct,
    netRMultiple: roundNum(netRMultiple, 2),
    avgRMultiple,
    since,
  };
}

function buildSignalKey(sig: QuantSignal): string {
  const rawTime = sig.closedCandleTime || sig.generated_at || new Date().toISOString();
  const anchor = sig.assetClass === 'FOREX_COMMODITY' ? rawTime.slice(0, 13) : rawTime.slice(0, 16);
  return `${sig.pair}:${sig.type}:${anchor}`;
}

export function isValidDirectionalSignal(sig: QuantSignal): sig is QuantSignal & { type: 'BUY' | 'SELL' } {
  if (sig.type !== 'BUY' && sig.type !== 'SELL') return false;
  if (!Number.isFinite(sig.entry) || sig.entry <= 0) return false;
  if (!Number.isFinite(sig.takeProfit) || sig.takeProfit <= 0) return false;
  if (!Number.isFinite(sig.stopLoss) || sig.stopLoss <= 0) return false;
  if (sig.type === 'BUY') {
    return sig.takeProfit > sig.entry && sig.stopLoss < sig.entry;
  }
  return sig.takeProfit < sig.entry && sig.stopLoss > sig.entry;
}

export async function syncSignalHistoryAndResolve(
  db: Db,
  signals: QuantSignal[],
  deps?: {
    fetchKlines?: (pair: string, interval: '15m', limit?: number) => Promise<ClosedCandle[]>;
    nowMs?: () => number;
  }
): Promise<{
  openedSignals: SignalHistoryRecord[];
  resolvedSignals: SignalHistoryRecord[];
  summary: SignalTrackRecordSummary;
}> {
  const col = db.collection<SignalHistoryRecord>('signal_history');
  const fetchKlines = deps?.fetchKlines ?? ((pair, interval, limit = 300) => fetchBinanceSpotKlines(pair, interval, limit));
  const nowMs = deps?.nowMs?.() ?? Date.now();

  // Map live FX prices so open non-crypto trades can also resolve against the live feed.
  const fxLivePrices = new Map<string, number>();
  for (const sig of signals) {
    if (sig.assetClass === 'FOREX_COMMODITY' && Number.isFinite(sig.price) && sig.price > 0) {
      fxLivePrices.set(sig.pair, sig.price);
    }
  }

  // Step 1: Audit all currently OPEN trades against real closed candles / FX quotes.
  const openTrades = await col.find({ status: 'OPEN' }).toArray();
  const klineCache = new Map<string, ClosedCandle[]>();
  const resolvedSignals: SignalHistoryRecord[] = [];

  for (const trade of openTrades) {
    let outcome: SignalResolutionOutcome | null = null;
    if (trade.assetClass === 'CRYPTO') {
      try {
        let candles = klineCache.get(trade.pair);
        if (!candles) {
          candles = await fetchKlines(trade.pair, '15m', 300);
          klineCache.set(trade.pair, candles);
        }
        outcome = evaluateCandlesAgainstSignal(trade, candles, nowMs);
      } catch (err: any) {
        console.warn(`Signal history kline check skipped for ${trade.pair}:`, err?.message || err);
      }
    } else {
      outcome = evaluatePriceAgainstSignal(trade, fxLivePrices.get(trade.pair), nowMs);
    }

    if (outcome) {
      await col.updateOne(
        { signalKey: trade.signalKey, status: 'OPEN' },
        {
          $set: {
            status: outcome.status,
            resolvedAt: outcome.resolvedAt,
            exitPrice: outcome.exitPrice,
            resolutionReason: outcome.resolutionReason,
            pnlPct: outcome.pnlPct,
            rMultiple: outcome.rMultiple,
          },
        }
      );
      resolvedSignals.push({ ...trade, ...outcome });
    }
  }

  // Step 2: Record new directional signals without stacking an already-OPEN same-direction trade.
  const openedSignals: SignalHistoryRecord[] = [];
  const stillOpen = await col.find({ status: 'OPEN' }).project({ pair: 1, type: 1 }).toArray();
  const openPairsByDir = new Set(stillOpen.map((d) => `${d.pair}:${d.type}`));

  for (const sig of signals) {
    if (!isValidDirectionalSignal(sig)) continue;
    const pairDir = `${sig.pair}:${sig.type}`;
    if (openPairsByDir.has(pairDir)) continue;

    const signalKey = buildSignalKey(sig);
    const existing = await col.findOne({ signalKey });
    if (existing) continue;

    const doc: SignalHistoryRecord = {
      signalKey,
      pair: sig.pair,
      symbol: sig.symbol,
      assetClass: sig.assetClass,
      type: sig.type,
      entry: sig.entry,
      takeProfit: sig.takeProfit,
      stopLoss: sig.stopLoss,
      confidence: sig.confidence,
      riskRewardRatio: sig.riskRewardRatio,
      timeframe: sig.timeframe,
      source: sig.source,
      closedCandleTime: sig.closedCandleTime || sig.generated_at,
      openedAt: sig.generated_at || new Date(nowMs).toISOString(),
      status: 'OPEN',
      resolvedAt: null,
      exitPrice: null,
      resolutionReason: null,
      pnlPct: null,
      rMultiple: null,
    };

    const up = await col.updateOne({ signalKey }, { $setOnInsert: doc }, { upsert: true });
    if (up.upsertedCount > 0) {
      openedSignals.push(doc);
      openPairsByDir.add(pairDir);
    }
  }

  const all = await col.find({}).toArray();
  const summary = computeTrackRecord(all);
  return { openedSignals, resolvedSignals, summary };
}

export async function fetchTrackRecordSummary(db: Db): Promise<SignalTrackRecordSummary> {
  const records = await db.collection<SignalHistoryRecord>('signal_history').find({}).toArray();
  return computeTrackRecord(records);
}

export async function fetchSignalHistoryLedger(
  db: Db,
  limit = 50
): Promise<{ summary: SignalTrackRecordSummary; history: SignalHistoryRecord[] }> {
  const all = await db
    .collection<SignalHistoryRecord>('signal_history')
    .find({})
    .sort({ openedAt: -1 })
    .toArray();
  return {
    summary: computeTrackRecord(all),
    history: all.slice(0, Math.max(1, Math.min(200, limit))),
  };
}
