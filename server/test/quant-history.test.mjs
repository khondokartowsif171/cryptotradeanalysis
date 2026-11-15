import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeTrackRecord,
  evaluateCandlesAgainstSignal,
  evaluatePriceAgainstSignal,
  isValidDirectionalSignal,
} from '../dist/quant/signalHistory.js';

const HOUR_MS = 3_600_000;
const M15_MS = 900_000;

function makeCandle(openTime, low, high, close) {
  return {
    openTime,
    closeTime: openTime + M15_MS - 1,
    open: (low + high) / 2,
    high,
    low,
    close,
    volume: 100,
  };
}

test('evaluateCandlesAgainstSignal ignores pre-signal candles and resolves BUY TP cleanly', () => {
  const anchor = Date.parse('2026-11-15T00:00:00.000Z');
  const sig = {
    type: 'BUY',
    entry: 100,
    takeProfit: 110,
    stopLoss: 95,
    closedCandleTime: new Date(anchor - 1).toISOString(),
    openedAt: new Date(anchor).toISOString(),
  };

  const candles = [
    // Prior closed bar touching SL before signal was emitted -> must be ignored
    makeCandle(anchor - M15_MS, 90, 102, 100),
    // First post-signal closed bar stays inside range
    makeCandle(anchor, 98, 104, 103),
    // Second post-signal closed bar hits TP
    makeCandle(anchor + M15_MS, 102, 111, 109),
  ];

  const outcome = evaluateCandlesAgainstSignal(sig, candles, anchor + 3 * M15_MS);
  assert.ok(outcome);
  assert.equal(outcome.status, 'TP_HIT');
  assert.equal(outcome.exitPrice, 110);
  assert.equal(outcome.pnlPct, 10);
  assert.equal(outcome.rMultiple, 2);
});

test('evaluateCandlesAgainstSignal applies conservative SL-wins rule when both SL and TP occur in one candle', () => {
  const anchor = Date.parse('2026-11-15T00:00:00.000Z');
  const sig = {
    type: 'SELL',
    entry: 200,
    takeProfit: 180,
    stopLoss: 210,
    closedCandleTime: new Date(anchor).toISOString(),
    openedAt: new Date(anchor).toISOString(),
  };

  const candles = [makeCandle(anchor, 178, 212, 195)];
  const outcome = evaluateCandlesAgainstSignal(sig, candles, anchor + 2 * M15_MS);

  assert.ok(outcome);
  assert.equal(outcome.status, 'SL_HIT');
  assert.equal(outcome.exitPrice, 210);
  assert.equal(outcome.pnlPct, -5);
  assert.equal(outcome.rMultiple, -1);
});

test('evaluateCandlesAgainstSignal expires unresolved trades after 72h', () => {
  const anchor = Date.parse('2026-11-12T00:00:00.000Z');
  const sig = {
    type: 'BUY',
    entry: 100,
    takeProfit: 120,
    stopLoss: 90,
    closedCandleTime: new Date(anchor).toISOString(),
    openedAt: new Date(anchor).toISOString(),
  };

  const candles = [makeCandle(anchor + M15_MS, 95, 108, 105)];
  const stillOpen = evaluateCandlesAgainstSignal(sig, candles, anchor + 24 * HOUR_MS);
  assert.equal(stillOpen, null);

  const expired = evaluateCandlesAgainstSignal(sig, candles, anchor + 72 * HOUR_MS);
  assert.ok(expired);
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(expired.exitPrice, 105);
  assert.equal(expired.pnlPct, 5);
  assert.equal(expired.rMultiple, 0.5);
});

test('evaluatePriceAgainstSignal handles FX/Gold SELL outcomes and computeTrackRecord totals honestly', () => {
  const openedAt = '2026-11-15T00:00:00.000Z';
  const tp = evaluatePriceAgainstSignal(
    { type: 'SELL', entry: 2650, takeProfit: 2610, stopLoss: 2670, openedAt },
    2608,
    Date.parse(openedAt) + HOUR_MS
  );
  assert.equal(tp?.status, 'TP_HIT');
  assert.equal(tp?.rMultiple, 2);

  const emptySummary = computeTrackRecord([
    {
      signalKey: 'BTCUSDT:BUY:1',
      pair: 'BTCUSDT',
      symbol: 'BTC',
      assetClass: 'CRYPTO',
      type: 'BUY',
      entry: 65000,
      takeProfit: 68000,
      stopLoss: 63500,
      confidence: 74,
      riskRewardRatio: '1:2.0',
      timeframe: 'H1/H4',
      source: 'Quant',
      closedCandleTime: openedAt,
      openedAt,
      status: 'OPEN',
      resolvedAt: null,
      exitPrice: null,
      resolutionReason: null,
      pnlPct: null,
      rMultiple: null,
    },
  ]);
  assert.equal(emptySummary.totalTracked, 1);
  assert.equal(emptySummary.openCount, 1);
  assert.equal(emptySummary.winRatePct, null);

  const decidedSummary = computeTrackRecord([
    { status: 'TP_HIT', rMultiple: 2.0, openedAt: '2026-11-14T00:00:00.000Z' },
    { status: 'TP_HIT', rMultiple: 1.5, openedAt: '2026-11-15T00:00:00.000Z' },
    { status: 'SL_HIT', rMultiple: -1.0, openedAt: '2026-11-15T01:00:00.000Z' },
  ]);
  assert.equal(decidedSummary.tpHits, 2);
  assert.equal(decidedSummary.slHits, 1);
  assert.equal(decidedSummary.winRatePct, 66.7);
  assert.equal(decidedSummary.netRMultiple, 2.5);

  assert.equal(
    isValidDirectionalSignal({ type: 'HOLD', entry: 100, takeProfit: 110, stopLoss: 90 }),
    false
  );
  assert.equal(
    isValidDirectionalSignal({ type: 'BUY', entry: 100, takeProfit: 110, stopLoss: 95 }),
    true
  );
});
