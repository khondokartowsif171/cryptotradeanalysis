import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { getMongo, pingMongo } from '../db/mongo.js';
import { database } from '../billing/database.js';
import { loadClientUser } from '../billing/store.js';
import { isAdminPrincipal } from '../middleware/entitlements.js';
import { checkBinanceApiHealth, syncAllQuantSignalsToMongo } from '../quant/signalEngine.js';

const router = Router();

export async function fetchPlatformSummary() {
  const [userCount, activePaidCount, subscriberCount, mongoPing] = await Promise.all([
    query('SELECT COUNT(*) as count FROM users'),
    query('SELECT COUNT(DISTINCT user_id) as count FROM subscription_grants WHERE starts_at <= NOW() AND ends_at > NOW()'),
    query('SELECT COUNT(*) as count FROM subscribers'),
    pingMongo(),
  ]);

  let signals = 0;
  let news = 0;
  let alerts = 0;
  if (mongoPing.connected) {
    try {
      const db = await getMongo();
      [signals, news, alerts] = await Promise.all([
        db.collection('signals').countDocuments(),
        db.collection('news').countDocuments(),
        db.collection('alerts').countDocuments(),
      ]);
    } catch {}
  }

  return {
    users: parseInt(userCount.rows[0]?.count || '0', 10),
    activePaidUsers: parseInt(activePaidCount.rows[0]?.count || '0', 10),
    subscribers: parseInt(subscriberCount.rows[0]?.count || '0', 10),
    signals,
    news,
    alerts,
    mongoConnected: mongoPing.connected,
    timestamp: new Date().toISOString(),
  };
}

async function checkService(url: string): Promise<{ ok: boolean; status?: number }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  }
}

router.get('/stats', async (_req, res) => {
  try {
    const [
      userCount,
      watchlistCount,
      portfolioCount,
      subscriberCount,
      activePaidCount,
      pendingIntentsCount,
      confirmedIntentsCount,
      tradesCount,
      mongoPing,
      candleProxy,
      priceProxy,
      signalBot,
      binanceApi,
    ] = await Promise.all([
      query('SELECT COUNT(*) as count FROM users'),
      query('SELECT COUNT(*) as count FROM watchlists'),
      query('SELECT COUNT(*) as count FROM portfolios'),
      query('SELECT COUNT(*) as count FROM subscribers'),
      query("SELECT COUNT(DISTINCT user_id) as count FROM subscription_grants WHERE starts_at <= NOW() AND ends_at > NOW()"),
      query("SELECT COUNT(*) as count FROM billing_intents WHERE status = 'pending'"),
      query("SELECT COUNT(*) as count FROM billing_intents WHERE status = 'confirmed'"),
      query('SELECT COUNT(*) as count FROM autonomous_trades').catch(() => ({ rows: [{ count: 0 }] })),
      pingMongo(),
      checkService(process.env.CANDLE_PROXY_HEALTH_URL || 'http://candles.auraajenticai.cloud/health'),
      checkService(process.env.PRICE_PROXY_HEALTH_URL || 'http://prices.auraajenticai.cloud/health'),
      checkService(process.env.SIGNAL_BOT_HEALTH_URL || 'https://signals.tradingbangla.com/health'),
      checkBinanceApiHealth(),
    ]);

    let mongoStats = { news: 0, signals: 0, alerts: 0 };
    if (mongoPing.connected) {
      try {
        const db = await getMongo();
        mongoStats.news = await db.collection('news').countDocuments();
        mongoStats.signals = await db.collection('signals').countDocuments();
        mongoStats.alerts = await db.collection('alerts').countDocuments();
      } catch {}
    }

    res.json({
      users: parseInt(userCount.rows[0].count),
      activePaidUsers: parseInt(activePaidCount.rows[0].count),
      watchlists: parseInt(watchlistCount.rows[0].count),
      portfolios: parseInt(portfolioCount.rows[0].count),
      subscribers: parseInt(subscriberCount.rows[0].count),
      pendingIntents: parseInt(pendingIntentsCount.rows[0].count),
      confirmedIntents: parseInt(confirmedIntentsCount.rows[0].count),
      autonomousTrades: parseInt(tradesCount.rows[0]?.count || '0'),
      mongo: mongoStats,
      health: {
        postgres: { ok: true },
        mongo: { ok: mongoPing.connected, error: mongoPing.error },
        candleProxy,
        priceProxy,
        signalBot,
        binanceApi: {
          ok: binanceApi.ok,
          keyConfigured: binanceApi.keyConfigured,
          authenticatedAccount: binanceApi.authenticatedAccount,
          accountType: binanceApi.accountType,
          canTrade: binanceApi.canTrade,
          freeUsdt: binanceApi.freeUsdt,
          activeAssetCount: binanceApi.activeBalances?.length ?? 0,
          message: binanceApi.message,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/binance-account', async (_req, res) => {
  try {
    const account = await checkBinanceApiHealth();
    res.json({ ...account, checkedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to inspect Binance account' });
  }
});

router.get('/users', async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        u.id,
        u.email,
        u.wallet_address,
        u.created_at,
        COALESCE(g.tier, 'free') AS tier,
        g.expires AS tier_expires_at,
        COALESCE(jsonb_array_length(w.coin_ids), 0) AS watchlist_count,
        COALESCE(jsonb_array_length(p.holdings), 0) AS portfolio_count,
        (SELECT COUNT(*)::int FROM client_api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL AND k.expires_at > NOW()) AS api_keys_count,
        (SELECT COUNT(*)::int FROM billing_intents b WHERE b.user_id = u.id AND b.status = 'confirmed') AS confirmed_payments
      FROM users u
      LEFT JOIN LATERAL (
        SELECT tier, MAX(ends_at) AS expires
        FROM subscription_grants
        WHERE user_id = u.id AND starts_at <= NOW() AND ends_at > NOW()
        GROUP BY tier
        ORDER BY CASE tier WHEN 'vip' THEN 2 ELSE 1 END DESC
        LIMIT 1
      ) g ON true
      LEFT JOIN watchlists w ON w.user_id = u.id
      LEFT JOIN portfolios p ON p.user_id = u.id
      ORDER BY u.created_at DESC
      LIMIT 100
    `);

    const users = result.rows.map((row: any) => ({
      ...row,
      is_admin: isAdminPrincipal(row),
    }));
    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/intents', async (_req, res) => {
  try {
    const [intentsRes, grantsRes] = await Promise.all([
      query(`
        SELECT b.*, u.email AS user_email
        FROM billing_intents b
        LEFT JOIN users u ON u.id = b.user_id
        ORDER BY b.created_at DESC
        LIMIT 50
      `),
      query(`
        SELECT g.*, u.email AS user_email, u.wallet_address AS user_wallet
        FROM subscription_grants g
        LEFT JOIN users u ON u.id = g.user_id
        ORDER BY g.ends_at DESC
        LIMIT 50
      `),
    ]);
    res.json({ intents: intentsRes.rows, grants: grantsRes.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/:id/grant', async (req, res) => {
  try {
    const userId = z.string().uuid().parse(req.params.id);
    const { tier, durationDays } = z
      .object({
        tier: z.enum(['free', 'pro', 'vip']),
        durationDays: z.number().int().min(1).max(36500).default(3650),
      })
      .parse(req.body);

    const updatedUser = await database.transaction(async (txQuery) => {
      const target = await txQuery('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!target.rows.length) return null;

      await txQuery("UPDATE subscription_grants SET ends_at = NOW() WHERE user_id = $1 AND ends_at > NOW()", [userId]);

      if (tier === 'pro' || tier === 'vip') {
        const sourceId = `admin:${Date.now()}:${userId}`;
        await txQuery(
          `INSERT INTO subscription_grants (source_id, user_id, tier, starts_at, ends_at)
           VALUES ($1, $2, $3, NOW(), NOW() + $4 * INTERVAL '1 day')`,
          [sourceId, userId, tier, durationDays]
        );
      }

      const fresh = await loadClientUser(txQuery, userId);
      await txQuery('UPDATE users SET tier = $2, tier_expires_at = $3, updated_at = NOW() WHERE id = $1', [
        userId,
        fresh!.tier,
        fresh!.tier_expires_at,
      ]);
      return fresh;
    });

    if (!updatedUser) {
      return void res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, user: { ...updatedUser, is_admin: isAdminPrincipal(updatedUser) } });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Grant update failed' });
  }
});

router.post('/quant/refresh', async (_req, res) => {
  try {
    const summary = await syncAllQuantSignalsToMongo();
    res.json({ success: true, ...summary, refreshedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Quant refresh failed' });
  }
});

router.get('/subscribers', async (_req, res) => {
  try {
    const result = await query('SELECT id, email, subscribed_at FROM subscribers ORDER BY subscribed_at DESC LIMIT 50');
    res.json({ subscribers: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
