import { getMongo } from '../db/mongo.js';

export interface ClosedCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type SignalDirection = 'BUY' | 'SELL' | 'HOLD';

export interface TimeframeBreakdown {
  timeframe: 'M15' | 'H1' | 'H4';
  direction: SignalDirection;
  score: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  ema9: number;
  ema20: number;
  ema21: number;
  ema50: number;
  ema200: number;
  atr14: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbWidth: number;
  goldenCross: boolean;
  deathCross: boolean;
  volumeSpike: boolean;
  reasons: string[];
}

export interface DerivativesMetrics {
  fundingRate: number | null;
  markPrice: number | null;
  openInterest: number | null;
}

export interface QuantSignal {
  pair: string;
  symbol: string;
  assetClass: 'CRYPTO' | 'FOREX_COMMODITY';
  type: SignalDirection;
  entry: number;
  price: number;
  target: number;
  takeProfit: number;
  stopLoss: number;
  confidence: number;
  riskRewardRatio: string;
  rsi: number;
  macd: number;
  macdHistogram: number;
  ema20: number;
  ema50: number;
  ema200: number;
  atr: number;
  fundingRate: number | null;
  openInterest: number | null;
  timeframe: string;
  indicator: string;
  reasons: string[];
  supportLevels: number[];
  resistanceLevels: number[];
  antiRepainting: true;
  closedCandleTime: string;
  generated_at: string;
  source: string;
}

export const TRACKED_CRYPTO_PAIRS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'LINKUSDT',
  'AVAXUSDT',
  'ADAUSDT',
];

function roundPrice(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= 1000) return parseFloat(value.toFixed(2));
  if (value >= 1) return parseFloat(value.toFixed(4));
  return parseFloat(value.toFixed(6));
}

function calcEMAArray(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let ema = sum / period;
  out[period - 1] = ema;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function calcWilderRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = calcEMAArray(closes, 12);
  const ema26 = calcEMAArray(closes, 26);
  const macdSeries: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (Number.isFinite(ema12[i]) && Number.isFinite(ema26[i])) {
      macdSeries.push(ema12[i] - ema26[i]);
    }
  }
  if (macdSeries.length < 9) return { macd: 0, signal: 0, histogram: 0 };
  const sigSeries = calcEMAArray(macdSeries, 9);
  const lastMacd = macdSeries[macdSeries.length - 1];
  const lastSig = sigSeries[sigSeries.length - 1] || 0;
  return {
    macd: lastMacd,
    signal: lastSig,
    histogram: lastMacd - lastSig,
  };
}

function calcBollinger(closes: number[], period = 20, mult = 2) {
  const slice = closes.slice(-period);
  if (slice.length < period) {
    const p = closes[closes.length - 1] || 0;
    return { upper: p, middle: p, lower: p, width: 0 };
  }
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = mean + mult * std;
  const lower = mean - mult * std;
  return {
    upper,
    middle: mean,
    lower,
    width: mean > 0 ? (upper - lower) / mean : 0,
  };
}

function calcATR(candles: ClosedCandle[], period = 14): number {
  if (candles.length <= period) return 0;
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function findPivots(candles: ClosedCandle[], currentPrice: number): { supportLevels: number[]; resistanceLevels: number[] } {
  const slice = candles.slice(-60);
  const supports: number[] = [];
  const resistances: number[] = [];
  for (let i = 2; i < slice.length - 2; i++) {
    const c = slice[i];
    if (c.low < slice[i - 1].low && c.low < slice[i - 2].low && c.low < slice[i + 1].low && c.low < slice[i + 2].low) {
      if (c.low < currentPrice) supports.push(c.low);
    }
    if (c.high > slice[i - 1].high && c.high > slice[i - 2].high && c.high > slice[i + 1].high && c.high > slice[i + 2].high) {
      if (c.high > currentPrice) resistances.push(c.high);
    }
  }
  supports.sort((a, b) => b - a);
  resistances.sort((a, b) => a - b);
  return {
    supportLevels: supports.slice(0, 2).map(roundPrice),
    resistanceLevels: resistances.slice(0, 2).map(roundPrice),
  };
}

export function evaluateClosedCandles(candles: ClosedCandle[], timeframe: 'M15' | 'H1' | 'H4'): TimeframeBreakdown {
  // Anti-repainting guard: evaluate strictly on finalized closed candles (exclude index -1 forming bar if >= 220 bars, or ensure last candle is closed)
  const closed = candles.length > 60 ? candles.slice(0, -1) : candles;
  const closes = closed.map((c) => c.close);
  const lastClose = closes[closes.length - 1] || 0;

  const ema9Arr = calcEMAArray(closes, 9);
  const ema20Arr = calcEMAArray(closes, 20);
  const ema21Arr = calcEMAArray(closes, 21);
  const ema50Arr = calcEMAArray(closes, 50);
  const ema200Arr = calcEMAArray(closes, Math.min(200, Math.max(50, closes.length - 1)));

  const idx = closes.length - 1;
  const prevIdx = Math.max(0, idx - 1);
  const ema9 = ema9Arr[idx] || lastClose;
  const ema20 = ema20Arr[idx] || lastClose;
  const ema21 = ema21Arr[idx] || lastClose;
  const ema50 = ema50Arr[idx] || lastClose;
  const ema200 = ema200Arr[idx] || ema50;

  const prevEma9 = ema9Arr[prevIdx] || ema9;
  const prevEma21 = ema21Arr[prevIdx] || ema21;
  const goldenCross = prevEma9 <= prevEma21 && ema9 > ema21;
  const deathCross = prevEma9 >= prevEma21 && ema9 < ema21;

  const rsi14 = calcWilderRSI(closes, 14);
  const { macd, signal: macdSignal, histogram: macdHistogram } = calcMACD(closes);
  const bb = calcBollinger(closes, 20, 2);
  const atr14 = calcATR(closed, 14);

  const volSlice = closed.slice(-21, -1).map((c) => c.volume);
  const avgVol = volSlice.length ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 0;
  const lastVol = closed[idx]?.volume || 0;
  const volumeSpike = avgVol > 0 && lastVol > avgVol * 1.5;

  let buyScore = 0;
  let sellScore = 0;
  const reasons: string[] = [];

  if (lastClose > ema200 && ema20 > ema50 && ema50 > ema200) {
    buyScore += 30;
    reasons.push(`[${timeframe}] Structural uptrend (Price > EMA200 & EMA50 > EMA200)`);
  } else if (lastClose < ema200 && ema20 < ema50 && ema50 < ema200) {
    sellScore += 30;
    reasons.push(`[${timeframe}] Structural downtrend (Price < EMA200 & EMA50 < EMA200)`);
  } else if (ema20 > ema50) {
    buyScore += 15;
    reasons.push(`[${timeframe}] EMA20 > EMA50 bullish bias`);
  } else if (ema20 < ema50) {
    sellScore += 15;
    reasons.push(`[${timeframe}] EMA20 < EMA50 bearish bias`);
  }

  if (goldenCross) {
    buyScore += 20;
    reasons.push(`[${timeframe}] EMA9/EMA21 Golden Cross on closed bar`);
  } else if (deathCross) {
    sellScore += 20;
    reasons.push(`[${timeframe}] EMA9/EMA21 Death Cross on closed bar`);
  } else if (ema9 > ema21) {
    buyScore += 10;
  } else if (ema9 < ema21) {
    sellScore += 10;
  }

  if (rsi14 >= 40 && rsi14 <= 58 && ema50 >= ema200) {
    buyScore += 20;
    reasons.push(`[${timeframe}] Wilder RSI(${rsi14}) healthy trend pullback zone`);
  } else if (rsi14 >= 42 && rsi14 <= 60 && ema50 < ema200) {
    sellScore += 20;
    reasons.push(`[${timeframe}] Wilder RSI(${rsi14}) bear pullback rejection zone`);
  } else if (rsi14 < 32) {
    buyScore += 18;
    reasons.push(`[${timeframe}] Wilder RSI(${rsi14}) oversold mean-reversion setup`);
  } else if (rsi14 > 68) {
    sellScore += 18;
    reasons.push(`[${timeframe}] Wilder RSI(${rsi14}) overbought distribution setup`);
  } else if (rsi14 >= 50) {
    buyScore += 6;
  } else {
    sellScore += 6;
  }

  if (macd > macdSignal && macdHistogram > 0) {
    buyScore += 20;
    reasons.push(`[${timeframe}] MACD bullish momentum (+histogram)`);
  } else if (macd < macdSignal && macdHistogram < 0) {
    sellScore += 20;
    reasons.push(`[${timeframe}] MACD bearish momentum (-histogram)`);
  } else if (macd > macdSignal) {
    buyScore += 10;
  } else {
    sellScore += 10;
  }

  const bbRange = bb.upper - bb.lower;
  if (bbRange > 0) {
    const pos = (lastClose - bb.lower) / bbRange;
    if (pos < 0.22) {
      buyScore += 15;
      reasons.push(`[${timeframe}] Closed price near lower Bollinger Band`);
    } else if (pos > 0.78) {
      sellScore += 15;
      reasons.push(`[${timeframe}] Closed price near upper Bollinger Band`);
    } else if (pos < 0.4) {
      buyScore += 6;
    } else if (pos > 0.6) {
      sellScore += 6;
    }
  }

  if (bb.width > 0 && bb.width < 0.025) {
    reasons.push(`[${timeframe}] Volatility compression (BB squeeze)`);
  }
  if (volumeSpike) {
    if (buyScore >= sellScore) buyScore += 10;
    else sellScore += 10;
    reasons.push(`[${timeframe}] Closed-bar volume spike >1.5x 20-bar mean`);
  }

  const maxPts = 115;
  let direction: SignalDirection = 'HOLD';
  let score = 50;
  if (buyScore > sellScore && buyScore >= 42) {
    direction = 'BUY';
    score = Math.min(98, Math.round((buyScore / maxPts) * 100));
  } else if (sellScore > buyScore && sellScore >= 42) {
    direction = 'SELL';
    score = Math.min(98, Math.round((sellScore / maxPts) * 100));
  } else {
    score = Math.min(60, Math.round((Math.max(buyScore, sellScore) / maxPts) * 100));
  }

  return {
    timeframe,
    direction,
    score,
    rsi14,
    macd,
    macdSignal,
    macdHistogram,
    ema9,
    ema20,
    ema21,
    ema50,
    ema200,
    atr14,
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    bbWidth: bb.width,
    goldenCross,
    deathCross,
    volumeSpike,
    reasons,
  };
}

async function fetchBinanceSpotKlines(pair: string, interval: '15m' | '1h' | '4h', limit = 250): Promise<ClosedCandle[]> {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Binance klines HTTP ${res.status}`);
  const raw = (await res.json()) as any[];
  if (!Array.isArray(raw) || raw.length < 30) throw new Error(`Insufficient klines for ${pair}`);
  return raw.map((row) => ({
    openTime: Number(row[0]),
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
    closeTime: Number(row[6]),
  }));
}

async function fetchFuturesDerivatives(pair: string): Promise<DerivativesMetrics> {
  try {
    const [premRes, oiRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(pair)}`, { signal: AbortSignal.timeout(2500) }),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(pair)}`, { signal: AbortSignal.timeout(2500) }),
    ]);
    const prem = premRes.ok ? ((await premRes.json()) as any) : null;
    const oi = oiRes.ok ? ((await oiRes.json()) as any) : null;
    return {
      fundingRate: prem?.lastFundingRate != null ? parseFloat(prem.lastFundingRate) : null,
      markPrice: prem?.markPrice != null ? parseFloat(prem.markPrice) : null,
      openInterest: oi?.openInterest != null ? parseFloat(oi.openInterest) : null,
    };
  } catch {
    return { fundingRate: null, markPrice: null, openInterest: null };
  }
}

export async function analyzeSymbolQuant(
  rawSymbol: string,
  options?: { livePrice?: number }
): Promise<QuantSignal> {
  const cleanSym = rawSymbol.toUpperCase().replace(/USDT$|USD$/i, '');
  const pair = `${cleanSym}USDT`;

  const [m15Candles, h1Candles, h4Candles, deriv] = await Promise.all([
    fetchBinanceSpotKlines(pair, '15m', 250),
    fetchBinanceSpotKlines(pair, '1h', 250),
    fetchBinanceSpotKlines(pair, '4h', 220),
    fetchFuturesDerivatives(pair),
  ]);

  const m15 = evaluateClosedCandles(m15Candles, 'M15');
  const h1 = evaluateClosedCandles(h1Candles, 'H1');
  const h4 = evaluateClosedCandles(h4Candles, 'H4');

  const votes = [m15, h1, h4];
  const buyWeight = votes.reduce((s, v, idx) => s + (v.direction === 'BUY' ? (idx === 2 ? 0.45 : idx === 1 ? 0.35 : 0.20) : 0), 0);
  const sellWeight = votes.reduce((s, v, idx) => s + (v.direction === 'SELL' ? (idx === 2 ? 0.45 : idx === 1 ? 0.35 : 0.20) : 0), 0);

  let finalDirection: SignalDirection = 'HOLD';
  if (buyWeight >= 0.5 && buyWeight > sellWeight) finalDirection = 'BUY';
  else if (sellWeight >= 0.5 && sellWeight > buyWeight) finalDirection = 'SELL';

  let weightedScore = Math.round(h4.score * 0.45 + h1.score * 0.35 + m15.score * 0.20);
  const extraReasons: string[] = [];

  if (deriv.fundingRate !== null) {
    const pct = (deriv.fundingRate * 100).toFixed(4);
    if (deriv.fundingRate > 0.0005) {
      if (finalDirection === 'BUY') weightedScore = Math.max(40, weightedScore - 12);
      else if (finalDirection === 'SELL') weightedScore = Math.min(96, weightedScore + 6);
      extraReasons.push(`Futures Funding +${pct}% (elevated long leverage caution)`);
    } else if (deriv.fundingRate < -0.0002) {
      if (finalDirection === 'BUY') weightedScore = Math.min(96, weightedScore + 6);
      else if (finalDirection === 'SELL') weightedScore = Math.max(40, weightedScore - 10);
      extraReasons.push(`Futures Funding ${pct}% (short-skew squeeze tailwind)`);
    } else {
      extraReasons.push(`Futures Funding neutral (${pct}%)`);
    }
  }

  if (deriv.openInterest !== null) {
    extraReasons.push(`Perp Open Interest: ${Math.round(deriv.openInterest).toLocaleString()} ${cleanSym}`);
  }

  if (finalDirection === 'HOLD') {
    weightedScore = Math.min(weightedScore, 62);
  }

  const closedH1 = h1Candles.slice(0, -1);
  const lastClosed = closedH1[closedH1.length - 1];
  const entry = options?.livePrice && options.livePrice > 0 ? options.livePrice : lastClosed.close;
  const atr = h1.atr14 || m15.atr14 || entry * 0.01;
  const slDist = Math.max(atr * 1.5, entry * 0.004);
  const tpDist = slDist * 2.4;

  const stopLoss = finalDirection === 'SELL' ? roundPrice(entry + slDist) : roundPrice(entry - slDist);
  const takeProfit = finalDirection === 'SELL' ? roundPrice(entry - tpDist) : roundPrice(entry + tpDist);
  const pivots = findPivots(closedH1, entry);

  const reasons = [
    ...h4.reasons.slice(0, 2),
    ...h1.reasons.slice(0, 2),
    ...m15.reasons.slice(0, 1),
    ...extraReasons,
  ].slice(0, 6);

  return {
    pair,
    symbol: cleanSym,
    assetClass: 'CRYPTO',
    type: finalDirection,
    entry: roundPrice(entry),
    price: roundPrice(entry),
    target: takeProfit,
    takeProfit,
    stopLoss,
    confidence: Math.max(35, Math.min(96, weightedScore)),
    riskRewardRatio: '1:2.4',
    rsi: h1.rsi14,
    macd: parseFloat(h1.macd.toFixed(4)),
    macdHistogram: parseFloat(h1.macdHistogram.toFixed(4)),
    ema20: roundPrice(h1.ema20),
    ema50: roundPrice(h1.ema50),
    ema200: roundPrice(h1.ema200),
    atr: roundPrice(atr),
    fundingRate: deriv.fundingRate,
    openInterest: deriv.openInterest,
    timeframe: '15m / 1H / 4H Closed-Candle Confluence',
    indicator: `EMA50/200 • Wilder RSI(${h1.rsi14}) • MACD • ATR(${roundPrice(atr)}) • Perp Funding`,
    reasons: reasons.length ? reasons : ['Multi-timeframe neutral equilibrium — wait for H1/H4 breakout'],
    supportLevels: pivots.supportLevels,
    resistanceLevels: pivots.resistanceLevels,
    antiRepainting: true,
    closedCandleTime: new Date(lastClosed.closeTime).toISOString(),
    generated_at: new Date().toISOString(),
    source: 'Aura CryptoX Institutional Quant Engine (Binance Spot + Futures)',
  };
}

async function fetchSignalBotFeed(): Promise<QuantSignal[]> {
  const signalBotUrl = process.env.SIGNAL_BOT_URL || 'https://signals.tradingbangla.com/signals';
  try {
    const res = await fetch(signalBotUrl, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const items = Object.values(data?.latestLive || {}) as any[];
    return items
      .filter((item) => item && item.symbol && Number(item.entry) > 0)
      .map((item) => {
        const cleanPair = String(item.symbol).replace('/', '');
        const dir: SignalDirection = item.direction === 'BUY' || item.direction === 'SELL' ? item.direction : 'HOLD';
        const ind = item.indicators || {};
        return {
          pair: cleanPair,
          symbol: cleanPair,
          assetClass: 'FOREX_COMMODITY' as const,
          type: dir,
          entry: Number(item.entry),
          price: Number(item.entry),
          target: Number(item.takeProfit),
          takeProfit: Number(item.takeProfit),
          stopLoss: Number(item.stopLoss),
          confidence: Number(item.confidence) || 45,
          riskRewardRatio: `1:${item.riskReward || 2.5}`,
          rsi: Number(ind.rsi?.toFixed?.(2) ?? 50),
          macd: Number(ind.macd?.toFixed?.(4) ?? 0),
          macdHistogram: Number(ind.macdHistogram?.toFixed?.(4) ?? 0),
          ema20: Number(ind.ema20 ?? item.entry),
          ema50: Number(ind.ema50 ?? item.entry),
          ema200: Number(ind.ema200 ?? item.entry),
          atr: Number(ind.atr?.toFixed?.(4) ?? 0),
          fundingRate: null,
          openInterest: null,
          timeframe: '15m / 1H / 4H Multi-TF',
          indicator: `VPS Signal Bot (${item.symbol}) • RSI(${Number(ind.rsi || 50).toFixed(1)}) • EMA50/200 • ATR`,
          reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 5) : [],
          supportLevels: [],
          resistanceLevels: [],
          antiRepainting: true as const,
          closedCandleTime: new Date(item.timestamp || Date.now()).toISOString(),
          generated_at: new Date().toISOString(),
          source: 'Trading Bangla VPS Signal Bot (MTF Engine)',
        };
      });
  } catch {
    return [];
  }
}

async function fetchCointelegraphItems(limit = 15): Promise<any[]> {
  try {
    const res = await fetch('https://cointelegraph.com/rss', {
      headers: { 'User-Agent': 'Mozilla/5.0 AuraCryptoX/1.3' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const blocks = xml.split('<item>').slice(1, limit + 1);
    return blocks
      .map((block) => {
        const body = block.split('</item>')[0];
        const title = body.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
        const url = body.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/s)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
        const desc = body.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s)?.[1]?.replace(/<[^>]+>|<!\[CDATA\[|\]\]>/g, '').trim() || '';
        const pubDate = body.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || new Date().toUTCString();
        if (!title || !url) return null;
        return {
          title,
          source: 'Cointelegraph',
          url,
          category: 'Crypto',
          summary: desc.slice(0, 320),
          published_at: new Date(pubDate).toISOString(),
          fetched_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

let inFlightSync: Promise<{ signalsSynced: number; newsSynced: number; alertsLogged: number }> | null = null;

export async function syncAllQuantSignalsToMongo(): Promise<{ signalsSynced: number; newsSynced: number; alertsLogged: number }> {
  if (inFlightSync) return inFlightSync;

  inFlightSync = (async () => {
    const [cryptoSettled, fxSignals, newsItems] = await Promise.all([
      Promise.allSettled(TRACKED_CRYPTO_PAIRS.map((pair) => analyzeSymbolQuant(pair))),
      fetchSignalBotFeed(),
      fetchCointelegraphItems(15),
    ]);

    const cryptoSignals = cryptoSettled
      .filter((r): r is PromiseFulfilledResult<QuantSignal> => r.status === 'fulfilled')
      .map((r) => r.value);

    const allSignals = [...cryptoSignals, ...fxSignals];
    let signalsSynced = 0;
    let newsSynced = 0;
    let alertsLogged = 0;

    const db = await getMongo();
    for (const sig of allSignals) {
      await db.collection('signals').updateOne(
        { pair: sig.pair },
        { $set: sig },
        { upsert: true }
      );
      signalsSynced++;

      if (sig.type !== 'HOLD' && sig.confidence >= 65) {
        const alertKey = `${sig.pair}:${sig.closedCandleTime.slice(0, 13)}`;
        const up = await db.collection('alerts').updateOne(
          { alertKey },
          {
            $setOnInsert: {
              alertKey,
              symbol: sig.pair,
              direction: sig.type,
              price: String(sig.entry),
              confidence: sig.confidence,
              type: 'QUANT_CONFLUENCE',
              triggered_at: new Date().toISOString(),
            },
          },
          { upsert: true }
        );
        if (up.upsertedCount > 0) alertsLogged++;
      }
    }

    for (const article of newsItems) {
      await db.collection('news').updateOne(
        { url: article.url },
        { $set: article },
        { upsert: true }
      );
      newsSynced++;
    }

    return { signalsSynced, newsSynced, alertsLogged };
  })();

  try {
    return await inFlightSync;
  } finally {
    inFlightSync = null;
  }
}
