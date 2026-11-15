import { createHmac } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';
import { database } from '../billing/database.js';
import { loadClientUser, type Database } from '../billing/store.js';
import type { SignalHistoryRecord } from '../quant/signalHistory.js';

export type NotificationAssetClass = 'CRYPTO' | 'FOREX_COMMODITY';

export interface UserAlertSettingsRow {
  user_id: string;
  telegram_enabled: boolean;
  telegram_chat_id: string | null;
  webhook_enabled: boolean;
  webhook_url: string | null;
  webhook_secret: string | null;
  min_confidence: number;
  asset_classes: NotificationAssetClass[];
  notify_new_signals: boolean;
  notify_resolutions: boolean;
  updated_at: string;
}

export interface DispatchDeps {
  db?: Database;
  fetcher?: typeof fetch;
  lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  botToken?: string;
}

export interface DeliveryResult {
  ok: boolean;
  httpStatus: number | null;
  error?: string;
}

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '[::]', '[::1]', '::1']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.localdomain'];

export function getTelegramBotToken(override?: string): string {
  return (override ?? process.env.CRYPTOX_TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
}

export function isValidTelegramChatId(raw: string): boolean {
  const trimmed = raw.trim();
  return /^-?\d{5,20}$/.test(trimmed) || /^@[a-zA-Z0-9_]{5,32}$/.test(trimmed);
}

function parseMappedIpv4FromIpv6(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (!lower.startsWith('::ffff:')) return null;
  const tail = lower.slice(7);
  if (isIPv4(tail)) return tail;
  const parts = tail.split(':');
  if (parts.length === 2) {
    const hi = Number.parseInt(parts[0], 16);
    const lo = Number.parseInt(parts[1], 16);
    if (Number.isFinite(hi) && Number.isFinite(lo) && hi >= 0 && hi <= 0xffff && lo >= 0 && lo <= 0xffff) {
      return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    }
  }
  return null;
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0];
  if (!ip) return true;

  const mapped = parseMappedIpv4FromIpv6(ip);
  if (mapped) return isPrivateOrReservedIp(mapped);

  if (isIPv4(ip)) {
    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }

  if (isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (/^(0+:){7}0*[01]$/.test(lower)) return true;
    const firstHextet = Number.parseInt(lower.split(':')[0] || '0', 16);
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }

  return true;
}

export function validateWebhookUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 512) {
    throw new Error('Webhook URL must be 1-512 characters');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Invalid webhook URL format');
  }
  if (url.protocol !== 'https:') {
    throw new Error('Priority webhooks must use HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('Webhook URL must not contain embedded credentials');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || BLOCKED_HOSTNAMES.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new Error('Internal or local webhook hosts are not allowed');
  }
  if ((isIPv4(host) || isIPv6(host)) && isPrivateOrReservedIp(host)) {
    throw new Error('Private, loopback, or reserved IP webhook destinations are not allowed');
  }
  return url;
}

export async function assertPublicWebhookDestination(
  url: URL,
  lookupFn: (hostname: string) => Promise<Array<{ address: string; family: number }>> = (h) => dnsLookup(h, { all: true })
): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIPv4(host) || isIPv6(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Private or reserved webhook IP blocked');
    }
    return;
  }
  const resolved = await lookupFn(host);
  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error('Webhook host DNS resolution failed');
  }
  for (const record of resolved) {
    if (!record?.address || isPrivateOrReservedIp(record.address)) {
      throw new Error('Webhook host resolves to a private or reserved network');
    }
  }
}

export function signWebhookPayload(bodyJson: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(bodyJson).digest('hex')}`;
}

function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatTelegramSignalMessage(
  eventType: 'signal.opened' | 'signal.resolved' | 'test.ping',
  sig?: Partial<SignalHistoryRecord>
): string {
  if (eventType === 'test.ping') {
    return [
      '<b>Aura CryptoX — VIP Alert Test</b>',
      'Your Telegram push alert connection is active.',
      `<i>${escapeHtml(new Date().toISOString())}</i>`,
    ].join('\n');
  }

  const pair = escapeHtml(sig?.pair || 'UNKNOWN');
  const dir = escapeHtml(sig?.type || '');
  const tf = escapeHtml(sig?.timeframe || 'H1 / H4');
  const conf = Number.isFinite(sig?.confidence) ? `${sig?.confidence}%` : '—';

  if (eventType === 'signal.resolved') {
    const statusLabel = sig?.status === 'TP_HIT' ? 'TP HIT' : sig?.status === 'SL_HIT' ? 'SL HIT' : 'EXPIRED';
    const pnl = typeof sig?.pnlPct === 'number' ? `${sig.pnlPct >= 0 ? '+' : ''}${sig.pnlPct}%` : '—';
    const rMult = typeof sig?.rMultiple === 'number' ? `${sig.rMultiple >= 0 ? '+' : ''}${sig.rMultiple}R` : '—';
    return [
      `<b>Aura CryptoX — ${escapeHtml(statusLabel)}: ${pair} (${dir})</b>`,
      `Entry: <code>${escapeHtml(sig?.entry)}</code> -> Exit: <code>${escapeHtml(sig?.exitPrice)}</code>`,
      `Outcome: <b>${escapeHtml(pnl)}</b> (${escapeHtml(rMult)})`,
      `Reason: ${escapeHtml(sig?.resolutionReason || 'Closed M15 candle verification')}`,
    ].join('\n');
  }

  return [
    `<b>Aura CryptoX — New ${dir} Signal: ${pair}</b>`,
    `Timeframe: ${tf} | Confidence: <b>${escapeHtml(conf)}</b>`,
    `Entry: <code>${escapeHtml(sig?.entry)}</code>`,
    `Take Profit: <code>${escapeHtml(sig?.takeProfit)}</code> | Stop Loss: <code>${escapeHtml(sig?.stopLoss)}</code>`,
    `R:R ${escapeHtml(sig?.riskRewardRatio || '—')} | Source: ${escapeHtml(sig?.source || 'Quant Engine')}`,
  ].join('\n');
}

export async function sendTelegramPush(
  chatId: string,
  text: string,
  deps?: DispatchDeps
): Promise<DeliveryResult> {
  const token = getTelegramBotToken(deps?.botToken);
  if (!token) {
    return {
      ok: false,
      httpStatus: 503,
      error: 'Telegram Bot Token is not configured on the CryptoX API server (CRYPTOX_TELEGRAM_BOT_TOKEN)',
    };
  }
  const fetcher = deps?.fetcher ?? fetch;
  try {
    // Stateless sendMessage only; never run getUpdates to avoid conflicts with polling bots.
    const res = await fetcher(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({} as any));
      return {
        ok: false,
        httpStatus: res.status,
        error: String(errBody?.description || `Telegram API HTTP ${res.status}`).slice(0, 220),
      };
    }
    return { ok: true, httpStatus: res.status };
  } catch (err: any) {
    return { ok: false, httpStatus: null, error: String(err?.message || 'Telegram request failed').slice(0, 220) };
  }
}

export async function sendSignedWebhook(
  webhookUrl: string,
  secret: string | null,
  eventType: 'signal.opened' | 'signal.resolved' | 'test.ping',
  payload: Record<string, unknown>,
  deps?: DispatchDeps
): Promise<DeliveryResult> {
  const fetcher = deps?.fetcher ?? fetch;
  try {
    const parsedUrl = validateWebhookUrl(webhookUrl);
    await assertPublicWebhookDestination(parsedUrl, deps?.lookup);

    const timestamp = new Date().toISOString();
    const body = JSON.stringify({
      event: eventType,
      timestamp,
      data: payload,
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Aura-CryptoX-Webhook/1.0',
      'X-CryptoX-Event': eventType,
      'X-CryptoX-Timestamp': timestamp,
    };
    if (secret && secret.trim()) {
      headers['X-CryptoX-Signature'] = signWebhookPayload(body, secret.trim());
    }

    const res = await fetcher(parsedUrl.toString(), {
      method: 'POST',
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      return { ok: false, httpStatus: res.status, error: `Webhook endpoint returned HTTP ${res.status}` };
    }
    return { ok: true, httpStatus: res.status };
  } catch (err: any) {
    return { ok: false, httpStatus: null, error: String(err?.message || 'Webhook delivery failed').slice(0, 220) };
  }
}

export async function recordDeliveryLog(
  db: Database,
  entry: {
    userId: string;
    channel: 'telegram' | 'webhook';
    eventKey: string;
    signalPair: string;
    signalType: string;
    status: 'sent' | 'failed' | 'skipped';
    httpStatus: number | null;
    errorMessage?: string | null;
  }
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO alert_deliveries
      (user_id, channel, event_key, signal_pair, signal_type, status, http_status, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, channel, event_key) DO NOTHING
     RETURNING id`,
    [
      entry.userId,
      entry.channel,
      entry.eventKey,
      entry.signalPair,
      entry.signalType,
      entry.status,
      entry.httpStatus,
      entry.errorMessage || null,
    ]
  );
  return result.rows.length > 0;
}

function parseAssetClasses(raw: unknown): NotificationAssetClass[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is NotificationAssetClass => v === 'CRYPTO' || v === 'FOREX_COMMODITY');
  }
  return ['CRYPTO', 'FOREX_COMMODITY'];
}

export async function dispatchSignalAlerts(
  openedSignals: SignalHistoryRecord[],
  resolvedSignals: SignalHistoryRecord[],
  deps?: DispatchDeps
): Promise<{ sent: number; failed: number }> {
  if (openedSignals.length === 0 && resolvedSignals.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const db = deps?.db ?? database;
  const rows = await db.query(
    `SELECT user_id, telegram_enabled, telegram_chat_id, webhook_enabled, webhook_url, webhook_secret,
            min_confidence, asset_classes, notify_new_signals, notify_resolutions
     FROM user_alert_settings
     WHERE telegram_enabled = TRUE OR webhook_enabled = TRUE`
  );

  let sent = 0;
  let failed = 0;

  for (const row of rows.rows as any[]) {
    const clientUser = await loadClientUser(db.query, String(row.user_id));
    if (!clientUser || clientUser.tier === 'free') continue;

    const minConfidence = Number(row.min_confidence ?? 65);
    const allowedClasses = new Set(parseAssetClasses(row.asset_classes));
    const events: Array<{ eventType: 'signal.opened' | 'signal.resolved'; eventKey: string; sig: SignalHistoryRecord }> = [];

    if (row.notify_new_signals) {
      for (const sig of openedSignals) {
        if (sig.confidence < minConfidence || !allowedClasses.has(sig.assetClass)) continue;
        events.push({ eventType: 'signal.opened', eventKey: `opened:${sig.signalKey}`, sig });
      }
    }
    if (row.notify_resolutions) {
      for (const sig of resolvedSignals) {
        if (sig.confidence < minConfidence || !allowedClasses.has(sig.assetClass)) continue;
        events.push({ eventType: 'signal.resolved', eventKey: `resolved:${sig.signalKey}:${sig.status}`, sig });
      }
    }

    for (const item of events) {
      if (row.webhook_enabled && row.webhook_url && (clientUser.tier === 'pro' || clientUser.tier === 'vip')) {
        const existing = await db.query(
          `SELECT 1 FROM alert_deliveries WHERE user_id = $1 AND channel = 'webhook' AND event_key = $2 LIMIT 1`,
          [row.user_id, item.eventKey]
        );
        if (existing.rows.length === 0) {
          const outcome = await sendSignedWebhook(
            String(row.webhook_url),
            row.webhook_secret ? String(row.webhook_secret) : null,
            item.eventType,
            item.sig as unknown as Record<string, unknown>,
            deps
          );
          await recordDeliveryLog(db, {
            userId: String(row.user_id),
            channel: 'webhook',
            eventKey: item.eventKey,
            signalPair: item.sig.pair,
            signalType: item.sig.type,
            status: outcome.ok ? 'sent' : 'failed',
            httpStatus: outcome.httpStatus,
            errorMessage: outcome.error,
          });
          if (outcome.ok) sent++;
          else failed++;
        }
      }

      if (row.telegram_enabled && row.telegram_chat_id && clientUser.tier === 'vip') {
        const existing = await db.query(
          `SELECT 1 FROM alert_deliveries WHERE user_id = $1 AND channel = 'telegram' AND event_key = $2 LIMIT 1`,
          [row.user_id, item.eventKey]
        );
        if (existing.rows.length === 0) {
          const text = formatTelegramSignalMessage(item.eventType, item.sig);
          const outcome = await sendTelegramPush(String(row.telegram_chat_id), text, deps);
          await recordDeliveryLog(db, {
            userId: String(row.user_id),
            channel: 'telegram',
            eventKey: item.eventKey,
            signalPair: item.sig.pair,
            signalType: item.sig.type,
            status: outcome.ok ? 'sent' : 'failed',
            httpStatus: outcome.httpStatus,
            errorMessage: outcome.error,
          });
          if (outcome.ok) sent++;
          else failed++;
        }
      }
    }
  }

  return { sent, failed };
}
