import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { getMongo } from '../db/mongo.js';
import { authMiddleware, type AuthPayload } from '../middleware/auth.js';
import { isAdminPrincipal, requireTier } from '../middleware/entitlements.js';
import { syncAllQuantSignalsToMongo } from '../quant/signalEngine.js';

const router = Router();

function validWebhookSecret(req: Request): boolean {
  const provided = String(req.get('x-webhook-secret') || '').trim();
  const configured = (process.env.N8N_WEBHOOK_SECRET || process.env.JWT_SECRET || '').trim();
  if (!provided || !configured) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(configured).digest();
  return timingSafeEqual(a, b);
}

function validAdminBearer(req: Request): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  try {
    const secret = process.env.JWT_SECRET || 'cryptox-dev-secret-change-in-production';
    const payload = jwt.verify(header.slice(7), secret, { algorithms: ['HS256'] }) as AuthPayload;
    return isAdminPrincipal(payload);
  } catch {
    return false;
  }
}

export const signalsHandler: RequestHandler = async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const db = await getMongo();
    let signals = await db.collection('signals').find({}).sort({ generated_at: -1 }).limit(24).toArray();

    const newestMs = signals[0]?.generated_at ? Date.parse(String(signals[0].generated_at)) : 0;
    if (!signals.length || !Number.isFinite(newestMs) || Date.now() - newestMs > 15 * 60_000) {
      await syncAllQuantSignalsToMongo().catch((err) => console.error('Quant sync fallback error:', err?.message));
      signals = await db.collection('signals').find({}).sort({ generated_at: -1 }).limit(24).toArray();
    }

    res.json({ signals, count: signals.length, fetchedAt: new Date().toISOString() });
  } catch (err: any) {
    console.error('Signals handler error:', err?.message || err);
    res.status(503).json({ error: 'The premium signal feed is temporarily unavailable', signals: [] });
  }
};

router.get('/', authMiddleware, requireTier('pro'), signalsHandler);

router.post('/ingest', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!validWebhookSecret(req) && !validAdminBearer(req)) {
    return void res.status(401).json({ error: 'Valid x-webhook-secret or admin token required' });
  }

  try {
    const db = await getMongo();
    const kind = String(req.body?.kind || 'signal').toLowerCase();
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [req.body];
    let saved = 0;

    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue;
      if (kind === 'news') {
        const title = String(item.title || '').trim();
        const url = String(item.url || '').trim();
        if (!title || !url) continue;
        await db.collection('news').updateOne(
          { url },
          {
            $set: {
              title,
              url,
              source: String(item.source || 'n8n Feed'),
              category: String(item.category || 'Crypto'),
              summary: String(item.summary || '').slice(0, 400),
              published_at: item.published_at || new Date().toISOString(),
              fetched_at: new Date().toISOString(),
            },
          },
          { upsert: true }
        );
        saved++;
      } else if (kind === 'alert') {
        const symbol = String(item.symbol || item.pair || '').toUpperCase().trim();
        if (!symbol) continue;
        const bucket = new Date().toISOString().slice(0, 13);
        const alertKey = `n8n:${symbol}:${String(item.type || 'PRICE_ALERT')}:${bucket}`;
        await db.collection('alerts').updateOne(
          { alertKey },
          {
            $set: {
              alertKey,
              symbol,
              price: String(item.price || ''),
              type: String(item.type || 'PRICE_ALERT'),
              threshold: String(item.threshold || ''),
              triggered_at: item.triggered_at || new Date().toISOString(),
              source: 'n8n Price Alert',
            },
          },
          { upsert: true }
        );
        saved++;
      } else {
        const pair = String(item.pair || item.symbol || '').toUpperCase().trim();
        if (!pair) continue;
        const doc = {
          ...item,
          pair,
          symbol: String(item.symbol || pair.replace(/USDT$/i, '')).toUpperCase(),
          type: String(item.type || item.signal || 'HOLD').toUpperCase(),
          entry: Number(item.entry || item.price || 0),
          price: Number(item.price || item.entry || 0),
          generated_at: item.generated_at || item.createdAt || new Date().toISOString(),
          source: String(item.source || 'n8n RSI Signal Generator'),
        };
        await db.collection('signals').updateOne({ pair }, { $set: doc }, { upsert: true });
        saved++;
      }
    }

    res.json({ ok: true, kind, saved, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Ingest failed' });
  }
});

export default router;
