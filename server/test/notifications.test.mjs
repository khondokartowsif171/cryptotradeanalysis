import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { randomUUID, createHmac } from 'node:crypto';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { generateToken } from '../dist/middleware/auth.js';
import { createNotificationsRouter } from '../dist/routes/notifications.js';
import {
  assertPublicWebhookDestination,
  dispatchSignalAlerts,
  validateWebhookUrl,
} from '../dist/services/notifications.js';

test('webhook SSRF guard rejects private, loopback, metadata, non-HTTPS, and rebinding hosts', async () => {
  for (const bad of [
    'http://hooks.example.test/path',
    'https://localhost/hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.5/hook',
    'https://192.168.1.50/hook',
    'https://[::1]/hook',
    'https://service.internal/hook',
    'https://user:pass@hooks.example.test/hook',
  ]) {
    assert.throws(() => validateWebhookUrl(bad), bad);
  }

  const rebindUrl = validateWebhookUrl('https://rebind.example.test/webhook');
  await assert.rejects(() =>
    assertPublicWebhookDestination(rebindUrl, async () => [{ address: '192.168.1.10', family: 4 }])
  );
  await assert.doesNotReject(() =>
    assertPublicWebhookDestination(rebindUrl, async () => [{ address: '93.184.216.34', family: 4 }])
  );
});

test('notifications tier gates, HMAC signatures, Telegram delivery, and idempotent dispatch work end-to-end', { timeout: 60000 }, async (t) => {
  const pg = new PGlite();
  await pg.exec(readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8'));
  await pg.exec(readFileSync(new URL('../migrations/002_verified_billing.sql', import.meta.url), 'utf8'));
  await pg.exec(readFileSync(new URL('../migrations/003_notifications.sql', import.meta.url), 'utf8'));

  const db = {
    query: (sql, values) => pg.query(sql, values),
    transaction: (work) => pg.transaction((tx) => work((sql, values) => tx.query(sql, values))),
  };

  const freeUser = randomUUID();
  const proUser = randomUUID();
  const vipUser = randomUUID();

  for (const [id, email] of [
    [freeUser, 'free@example.test'],
    [proUser, 'pro@example.test'],
    [vipUser, 'vip@example.test'],
  ]) {
    await db.query('INSERT INTO users(id, email) VALUES($1, $2)', [id, email]);
  }
  await db.query(
    `INSERT INTO subscription_grants(user_id, tier, source_id, starts_at, ends_at)
     VALUES ($1, 'pro', 'test:pro-1', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '30 days'),
            ($2, 'vip', 'test:vip-1', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '30 days')`,
    [proUser, vipUser]
  );

  const tokens = {
    free: generateToken({ userId: freeUser, email: 'free@example.test' }),
    pro: generateToken({ userId: proUser, email: 'pro@example.test' }),
    vip: generateToken({ userId: vipUser, email: 'vip@example.test' }),
  };

  const outbound = [];
  const fakeFetcher = async (url, init = {}) => {
    outbound.push({
      url: String(url),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body ? String(init.body) : '',
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const fakeDeps = { db, fetcher: fakeFetcher, lookup: fakeLookup, botToken: '123456:TEST_BOT_TOKEN' };

  const app = express();
  app.use(express.json());
  app.use('/notifications', createNotificationsRouter(db, fakeDeps));
  const http = app.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const base = `http://127.0.0.1:${http.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => http.close(resolve));
    await pg.close();
  });

  const call = async (path, role, body = null, method = body ? 'PUT' : 'GET') => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens[role]}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  };

  // Free user blocked from /notifications
  assert.equal((await call('/notifications/settings', 'free')).status, 403);

  // Pro user blocked from enabling Telegram, allowed to save & test HMAC webhook
  assert.equal(
    (await call('/notifications/settings', 'pro', { telegramEnabled: true, telegramChatId: '999888777' })).status,
    403
  );
  const proSaved = await call('/notifications/settings', 'pro', {
    webhookEnabled: true,
    webhookUrl: 'https://hooks.example.test/pro-stream',
    minConfidence: 70,
    assetClasses: ['CRYPTO'],
  });
  assert.equal(proSaved.status, 200);
  const webhookSecret = proSaved.body.generatedWebhookSecret;
  assert.ok(webhookSecret?.startsWith('whsec_'));

  const pingRes = await call('/notifications/test', 'pro', { channel: 'webhook' }, 'POST');
  assert.equal(pingRes.status, 200);
  assert.equal(pingRes.body.ok, true);
  assert.equal(outbound.length, 1);
  const sigHeader = outbound[0].headers['X-CryptoX-Signature'];
  const expectedSig = `sha256=${createHmac('sha256', webhookSecret).update(outbound[0].body).digest('hex')}`;
  assert.equal(sigHeader, expectedSig);

  // VIP user enables Telegram push + tests sendMessage (never getUpdates)
  const vipSaved = await call('/notifications/settings', 'vip', {
    telegramEnabled: true,
    telegramChatId: '555444333',
    minConfidence: 60,
  });
  assert.equal(vipSaved.status, 200);
  const tgTest = await call('/notifications/test', 'vip', { channel: 'telegram' }, 'POST');
  assert.equal(tgTest.status, 200);
  assert.match(outbound[1].url, /\/sendMessage$/);

  // Auto-dispatch honors confidence/asset filters and is idempotent across retries
  outbound.length = 0;
  const btcSignal = {
    signalKey: 'BTCUSDT:BUY:2026-11-15T01:00',
    pair: 'BTCUSDT',
    symbol: 'BTC',
    assetClass: 'CRYPTO',
    type: 'BUY',
    entry: 65000,
    takeProfit: 67500,
    stopLoss: 63800,
    confidence: 76,
    riskRewardRatio: '1:2.1',
    timeframe: 'H1/H4',
    source: 'Quant',
    closedCandleTime: '2026-11-15T01:00:00.000Z',
    openedAt: '2026-11-15T01:00:05.000Z',
    status: 'OPEN',
    resolvedAt: null,
    exitPrice: null,
    resolutionReason: null,
    pnlPct: null,
    rMultiple: null,
  };
  const lowConfFx = {
    ...btcSignal,
    signalKey: 'XAU/USD:SELL:2026-11-15T01',
    pair: 'XAU/USD',
    symbol: 'XAU/USD',
    assetClass: 'FOREX_COMMODITY',
    confidence: 62, // above VIP 60 threshold, below Pro 70 & filtered out for Pro CRYPTO-only
  };

  const firstDispatch = await dispatchSignalAlerts([btcSignal, lowConfFx], [], fakeDeps);
  // Pro receives BTC only (1 webhook), VIP receives BTC + Gold/FX (2 Telegram) = 3 total
  assert.equal(firstDispatch.sent, 3);
  assert.equal(firstDispatch.failed, 0);

  // Repeat call for same event_keys delivers zero duplicates
  const duplicateDispatch = await dispatchSignalAlerts([btcSignal, lowConfFx], [], fakeDeps);
  assert.equal(duplicateDispatch.sent, 0);
});
