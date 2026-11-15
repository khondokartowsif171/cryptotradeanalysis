import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import express from 'express';
import { createMarketsRouter, parseCoinGeckoCaps } from '../dist/routes/markets.js';

test('parseCoinGeckoCaps keeps canonical highest market cap per symbol and ignores invalid entries', () => {
  const caps = parseCoinGeckoCaps([
    { symbol: 'btc', market_cap: 1_850_000_000_000 },
    { symbol: 'eth', market_cap: 380_000_000_000 },
    { symbol: 'btc', market_cap: 12_000_000 }, // secondary wrapped asset sharing symbol
    { symbol: 'zero', market_cap: 0 },
    { symbol: 'bad', market_cap: null },
    { symbol: '', market_cap: 1_000_000 },
  ]);

  assert.equal(caps.BTC, 1_850_000_000_000);
  assert.equal(caps.ETH, 380_000_000_000);
  assert.equal(caps.ZERO, undefined);
  assert.equal(caps.BAD, undefined);
});

test('GET /markets/caps caches responses, deduplicates concurrent fetches, and falls back to stale cache honestly', async (t) => {
  let currentMs = 1_700_000_000_000;
  let fetchCount = 0;
  let failUpstream = false;

  const app = express();
  app.use(
    '/markets',
    createMarketsRouter({
      now: () => currentMs,
      ttlMs: 300_000,
      fetcher: async () => {
        fetchCount++;
        if (failUpstream) {
          return new Response('rate limited', { status: 429 });
        }
        return new Response(
          JSON.stringify([
            { symbol: 'btc', market_cap: 1_900_000_000_000 },
            { symbol: 'sol', market_cap: 95_000_000_000 },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    })
  );

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  // Concurrent initial requests hit upstream only once
  const [r1, r2] = await Promise.all([
    fetch(`${base}/markets/caps`).then((r) => r.json()),
    fetch(`${base}/markets/caps`).then((r) => r.json()),
  ]);
  assert.equal(fetchCount, 1);
  assert.equal(r1.caps.BTC, 1_900_000_000_000);
  assert.equal(r2.caps.SOL, 95_000_000_000);

  // Subsequent request within TTL uses cache without upstream fetch
  currentMs += 60_000;
  const r3 = await fetch(`${base}/markets/caps`).then((r) => r.json());
  assert.equal(fetchCount, 1);
  assert.equal(r3.cached, true);
  assert.equal(r3.stale, false);

  // Past TTL with upstream 429 preserves last known real cache marked stale
  currentMs += 300_000;
  failUpstream = true;
  const r4 = await fetch(`${base}/markets/caps`).then((r) => r.json());
  assert.equal(fetchCount, 2);
  assert.equal(r4.stale, true);
  assert.equal(r4.caps.BTC, 1_900_000_000_000);
});

test('GET /markets/caps never invents fake caps on cold upstream outage', async (t) => {
  const app = express();
  app.use(
    '/markets',
    createMarketsRouter({
      fetcher: async () => new Response('down', { status: 503 }),
    })
  );

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const body = await fetch(`${base}/markets/caps`).then((r) => r.json());
  assert.deepEqual(body.caps, {});
  assert.equal(body.unavailable, true);
  assert.equal(body.stale, true);
});

test('GET /markets/global caches CoinGecko global stats and falls back cleanly on upstream error', async (t) => {
  let fetches = 0;
  let fail = false;
  const app = express();
  app.use(
    '/markets',
    createMarketsRouter({
      ttlMs: 300_000,
      fetcher: async () => {
        fetches++;
        if (fail) return new Response('rate limit', { status: 429 });
        return new Response(
          JSON.stringify({
            data: {
              active_cryptocurrencies: 14000,
              total_market_cap: { usd: 2_350_000_000_000 },
              total_volume: { usd: 95_000_000_000 },
              market_cap_percentage: { btc: 56.2, eth: 9.8 },
              market_cap_change_percentage_24h_usd: -1.4,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    })
  );

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const first = await fetch(`${base}/markets/global`).then((r) => r.json());
  const second = await fetch(`${base}/markets/global`).then((r) => r.json());
  assert.equal(fetches, 1);
  assert.equal(first.data.total_market_cap.usd, 2_350_000_000_000);
  assert.equal(second.cached, true);
});
