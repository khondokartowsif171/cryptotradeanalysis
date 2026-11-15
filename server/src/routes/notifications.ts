import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { database } from '../billing/database.js';
import type { Database } from '../billing/store.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireTier } from '../middleware/entitlements.js';
import {
  formatTelegramSignalMessage,
  getTelegramBotToken,
  isValidTelegramChatId,
  recordDeliveryLog,
  sendSignedWebhook,
  sendTelegramPush,
  validateWebhookUrl,
  type DispatchDeps,
  type NotificationAssetClass,
} from '../services/notifications.js';

const settingsSchema = z.object({
  telegramEnabled: z.boolean().optional(),
  telegramChatId: z.string().max(64).nullable().optional(),
  webhookEnabled: z.boolean().optional(),
  webhookUrl: z.string().max(512).nullable().optional(),
  webhookSecret: z.string().max(256).nullable().optional(),
  regenerateWebhookSecret: z.boolean().optional(),
  minConfidence: z.number().int().min(40).max(95).optional(),
  assetClasses: z.array(z.enum(['CRYPTO', 'FOREX_COMMODITY'])).min(1).max(2).optional(),
  notifyNewSignals: z.boolean().optional(),
  notifyResolutions: z.boolean().optional(),
});

const testSchema = z.object({
  channel: z.enum(['telegram', 'webhook']),
});

function maskSecret(secret: string | null | undefined): string | null {
  if (!secret || secret.trim().length < 6) return secret ? '••••' : null;
  const trimmed = secret.trim();
  return `••••${trimmed.slice(-4)}`;
}

function sanitizeSettingsRow(row: any) {
  const assetClasses: NotificationAssetClass[] = Array.isArray(row?.asset_classes)
    ? row.asset_classes.filter((x: unknown) => x === 'CRYPTO' || x === 'FOREX_COMMODITY')
    : ['CRYPTO', 'FOREX_COMMODITY'];

  return {
    telegramEnabled: Boolean(row?.telegram_enabled),
    telegramChatId: row?.telegram_chat_id ? String(row.telegram_chat_id) : '',
    webhookEnabled: Boolean(row?.webhook_enabled),
    webhookUrl: row?.webhook_url ? String(row.webhook_url) : '',
    hasWebhookSecret: Boolean(row?.webhook_secret),
    webhookSecretPreview: maskSecret(row?.webhook_secret),
    minConfidence: Number(row?.min_confidence ?? 65),
    assetClasses: assetClasses.length > 0 ? assetClasses : (['CRYPTO', 'FOREX_COMMODITY'] as NotificationAssetClass[]),
    notifyNewSignals: row?.notify_new_signals !== undefined ? Boolean(row.notify_new_signals) : true,
    notifyResolutions: row?.notify_resolutions !== undefined ? Boolean(row.notify_resolutions) : true,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export function createNotificationsRouter(
  db: Database = database,
  deps?: DispatchDeps
) {
  const router = Router();
  const proGuard = requireTier('pro', db.query);

  router.get('/settings', authMiddleware, proGuard, async (req, res) => {
    try {
      const userId = req.clientUser!.id;
      const result = await db.query(
        `SELECT * FROM user_alert_settings WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      res.json({
        settings: sanitizeSettingsRow(result.rows[0]),
        tier: req.clientUser!.tier,
        telegramBotConfigured: Boolean(getTelegramBotToken(deps?.botToken)),
        botUsername: process.env.CRYPTOX_TELEGRAM_BOT_USERNAME?.trim() || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load alert settings' });
    }
  });

  router.put('/settings', authMiddleware, proGuard, async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return void res.status(400).json({ error: 'Invalid notification settings payload' });
    }

    try {
      const userId = req.clientUser!.id;
      const tier = req.clientUser!.tier;
      const existingRes = await db.query(
        `SELECT * FROM user_alert_settings WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      const existing = existingRes.rows[0] || {};
      const input = parsed.data;

      const telegramEnabled = input.telegramEnabled ?? Boolean(existing.telegram_enabled);
      const telegramChatIdRaw =
        input.telegramChatId !== undefined
          ? (input.telegramChatId || '').trim() || null
          : existing.telegram_chat_id || null;

      if (telegramEnabled && tier !== 'vip') {
        return void res.status(403).json({
          error: 'Telegram push alerts require an active VIP subscription',
          code: 'TIER_REQUIRED',
        });
      }
      if (telegramChatIdRaw && !isValidTelegramChatId(telegramChatIdRaw)) {
        return void res.status(400).json({
          error: 'Invalid Telegram Chat ID (use numeric chat ID like 123456789 or @channelusername)',
        });
      }
      if (telegramEnabled && !telegramChatIdRaw) {
        return void res.status(400).json({ error: 'Enter a valid Telegram Chat ID before enabling Telegram alerts' });
      }

      const webhookEnabled = input.webhookEnabled ?? Boolean(existing.webhook_enabled);
      const webhookUrlRaw =
        input.webhookUrl !== undefined
          ? (input.webhookUrl || '').trim() || null
          : existing.webhook_url || null;

      if (webhookUrlRaw) {
        try {
          validateWebhookUrl(webhookUrlRaw);
        } catch (err: any) {
          return void res.status(400).json({ error: err?.message || 'Invalid webhook URL' });
        }
      }
      if (webhookEnabled && !webhookUrlRaw) {
        return void res.status(400).json({ error: 'Enter an HTTPS webhook URL before enabling priority webhooks' });
      }

      let webhookSecret = existing.webhook_secret ? String(existing.webhook_secret) : null;
      let generatedWebhookSecret: string | null = null;
      if (input.regenerateWebhookSecret) {
        generatedWebhookSecret = `whsec_${randomBytes(20).toString('hex')}`;
        webhookSecret = generatedWebhookSecret;
      } else if (input.webhookSecret !== undefined) {
        const trimmedSecret = (input.webhookSecret || '').trim();
        webhookSecret = trimmedSecret || null;
      } else if (webhookEnabled && !webhookSecret) {
        generatedWebhookSecret = `whsec_${randomBytes(20).toString('hex')}`;
        webhookSecret = generatedWebhookSecret;
      }

      const minConfidence = input.minConfidence ?? Number(existing.min_confidence ?? 65);
      const assetClasses = input.assetClasses ?? (existing.asset_classes || ['CRYPTO', 'FOREX_COMMODITY']);
      const notifyNewSignals = input.notifyNewSignals ?? (existing.notify_new_signals !== undefined ? Boolean(existing.notify_new_signals) : true);
      const notifyResolutions = input.notifyResolutions ?? (existing.notify_resolutions !== undefined ? Boolean(existing.notify_resolutions) : true);

      const saved = await db.query(
        `INSERT INTO user_alert_settings
          (user_id, telegram_enabled, telegram_chat_id, webhook_enabled, webhook_url, webhook_secret,
           min_confidence, asset_classes, notify_new_signals, notify_resolutions, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           telegram_enabled = EXCLUDED.telegram_enabled,
           telegram_chat_id = EXCLUDED.telegram_chat_id,
           webhook_enabled = EXCLUDED.webhook_enabled,
           webhook_url = EXCLUDED.webhook_url,
           webhook_secret = EXCLUDED.webhook_secret,
           min_confidence = EXCLUDED.min_confidence,
           asset_classes = EXCLUDED.asset_classes,
           notify_new_signals = EXCLUDED.notify_new_signals,
           notify_resolutions = EXCLUDED.notify_resolutions,
           updated_at = NOW()
         RETURNING *`,
        [
          userId,
          telegramEnabled,
          telegramChatIdRaw,
          webhookEnabled,
          webhookUrlRaw,
          webhookSecret,
          minConfidence,
          JSON.stringify(assetClasses),
          notifyNewSignals,
          notifyResolutions,
        ]
      );

      res.json({
        settings: sanitizeSettingsRow(saved.rows[0]),
        ...(generatedWebhookSecret ? { generatedWebhookSecret } : {}),
        tier,
        telegramBotConfigured: Boolean(getTelegramBotToken(deps?.botToken)),
        botUsername: process.env.CRYPTOX_TELEGRAM_BOT_USERNAME?.trim() || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to save alert settings' });
    }
  });

  router.post('/test', authMiddleware, proGuard, async (req, res) => {
    const parsed = testSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return void res.status(400).json({ error: 'Specify channel: "webhook" or "telegram"' });
    }

    try {
      const userId = req.clientUser!.id;
      const tier = req.clientUser!.tier;
      const { channel } = parsed.data;
      const rowRes = await db.query(
        `SELECT * FROM user_alert_settings WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      const settings = rowRes.rows[0];

      if (channel === 'telegram') {
        if (tier !== 'vip') {
          return void res.status(403).json({
            error: 'Telegram push alerts require an active VIP subscription',
            code: 'TIER_REQUIRED',
          });
        }
        const chatId = settings?.telegram_chat_id ? String(settings.telegram_chat_id).trim() : '';
        if (!chatId) {
          return void res.status(400).json({ error: 'Save a valid Telegram Chat ID first before testing' });
        }
        const outcome = await sendTelegramPush(chatId, formatTelegramSignalMessage('test.ping'), {
          ...deps,
          db,
        });
        await recordDeliveryLog(db, {
          userId,
          channel: 'telegram',
          eventKey: `test:${Date.now()}:${randomBytes(3).toString('hex')}`,
          signalPair: 'TEST',
          signalType: 'TEST_PING',
          status: outcome.ok ? 'sent' : 'failed',
          httpStatus: outcome.httpStatus,
          errorMessage: outcome.error,
        });
        return void res.status(outcome.ok ? 200 : outcome.httpStatus === 503 ? 503 : 502).json({
          ok: outcome.ok,
          channel,
          httpStatus: outcome.httpStatus,
          error: outcome.error || null,
          deliveredAt: new Date().toISOString(),
        });
      }

      const webhookUrl = settings?.webhook_url ? String(settings.webhook_url).trim() : '';
      if (!webhookUrl) {
        return void res.status(400).json({ error: 'Save an HTTPS webhook URL first before testing' });
      }
      const outcome = await sendSignedWebhook(
        webhookUrl,
        settings?.webhook_secret ? String(settings.webhook_secret) : null,
        'test.ping',
        { message: 'Aura CryptoX webhook stream test ping', userId },
        { ...deps, db }
      );
      await recordDeliveryLog(db, {
        userId,
        channel: 'webhook',
        eventKey: `test:${Date.now()}:${randomBytes(3).toString('hex')}`,
        signalPair: 'TEST',
        signalType: 'TEST_PING',
        status: outcome.ok ? 'sent' : 'failed',
        httpStatus: outcome.httpStatus,
        errorMessage: outcome.error,
      });
      return void res.status(outcome.ok ? 200 : 502).json({
        ok: outcome.ok,
        channel,
        httpStatus: outcome.httpStatus,
        error: outcome.error || null,
        deliveredAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to execute test alert' });
    }
  });

  router.get('/deliveries', authMiddleware, proGuard, async (req, res) => {
    try {
      const result = await db.query(
        `SELECT id, channel, event_key, signal_pair, signal_type, status, http_status, error_message, created_at
         FROM alert_deliveries
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [req.clientUser!.id]
      );
      res.json({ deliveries: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load delivery history' });
    }
  });

  return router;
}

export default createNotificationsRouter(database);
