import React, { useEffect, useState } from 'react';
import {
  api,
  type NotificationDeliveryItem,
  type NotificationSettings,
} from '@/services/api';
import { openPlans } from '@/lib/subscription';
import { Bell, Send, Webhook, Copy, Check, RefreshCw, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  tier: string;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  telegramEnabled: false,
  telegramChatId: '',
  webhookEnabled: false,
  webhookUrl: '',
  hasWebhookSecret: false,
  webhookSecretPreview: null,
  minConfidence: 65,
  assetClasses: ['CRYPTO', 'FOREX_COMMODITY'],
  notifyNewSignals: true,
  notifyResolutions: true,
  updatedAt: null,
};

const SignalAlertsPanel: React.FC<Props> = ({ tier }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingChannel, setTestingChannel] = useState<'telegram' | 'webhook' | null>(null);
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [deliveries, setDeliveries] = useState<NotificationDeliveryItem[]>([]);
  const [telegramBotConfigured, setTelegramBotConfigured] = useState(true);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [newSecretInput, setNewSecretInput] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const isVip = tier === 'vip';

  const loadAlertData = async () => {
    setLoading(true);
    try {
      const [settingsRes, delivRes] = await Promise.all([
        api.notifications.getSettings(),
        api.notifications.deliveries(),
      ]);
      if (!settingsRes._offline) {
        setSettings(settingsRes.data.settings);
        setTelegramBotConfigured(settingsRes.data.telegramBotConfigured);
        setBotUsername(settingsRes.data.botUsername);
      }
      if (!delivRes._offline) {
        setDeliveries(delivRes.data.deliveries);
      }
    } catch (err: any) {
      setStatusMessage({ kind: 'err', text: err?.message || 'Unable to load alert preferences' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadAlertData();
  }, [open]);

  const handleSave = async (rotateSecret = false) => {
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await api.notifications.saveSettings({
        telegramEnabled: isVip ? settings.telegramEnabled : false,
        telegramChatId: settings.telegramChatId || null,
        webhookEnabled: settings.webhookEnabled,
        webhookUrl: settings.webhookUrl || null,
        ...(newSecretInput.trim() ? { webhookSecret: newSecretInput.trim() } : {}),
        ...(rotateSecret ? { regenerateWebhookSecret: true } : {}),
        minConfidence: settings.minConfidence,
        assetClasses: settings.assetClasses,
        notifyNewSignals: settings.notifyNewSignals,
        notifyResolutions: settings.notifyResolutions,
      });
      if (res._offline) throw new Error('API offline — retry once connected');
      setSettings(res.data.settings);
      setTelegramBotConfigured(res.data.telegramBotConfigured);
      setBotUsername(res.data.botUsername);
      setNewSecretInput('');
      if (res.data.generatedWebhookSecret) {
        setRevealedSecret(res.data.generatedWebhookSecret);
      }
      setStatusMessage({
        kind: 'ok',
        text: rotateSecret ? 'Webhook signing secret rotated and settings saved.' : 'Alert preferences saved.',
      });
    } catch (err: any) {
      setStatusMessage({ kind: 'err', text: err?.message || 'Could not save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (channel: 'telegram' | 'webhook') => {
    setTestingChannel(channel);
    setStatusMessage(null);
    try {
      // Save current edits cleanly first so test hits what user sees on screen
      const saveRes = await api.notifications.saveSettings({
        telegramEnabled: isVip ? settings.telegramEnabled : false,
        telegramChatId: settings.telegramChatId || null,
        webhookEnabled: settings.webhookEnabled,
        webhookUrl: settings.webhookUrl || null,
        ...(newSecretInput.trim() ? { webhookSecret: newSecretInput.trim() } : {}),
        minConfidence: settings.minConfidence,
        assetClasses: settings.assetClasses,
        notifyNewSignals: settings.notifyNewSignals,
        notifyResolutions: settings.notifyResolutions,
      });
      if (!saveRes._offline) {
        setSettings(saveRes.data.settings);
        if (saveRes.data.generatedWebhookSecret) {
          setRevealedSecret(saveRes.data.generatedWebhookSecret);
        }
        setNewSecretInput('');
      }

      const res = await api.notifications.sendTest(channel);
      if (res._offline) throw new Error('API offline — retry once connected');
      setStatusMessage({
        kind: res.data.ok ? 'ok' : 'err',
        text: res.data.ok
          ? `Test ${channel} alert delivered successfully (HTTP ${res.data.httpStatus ?? 200}).`
          : res.data.error || `Test ${channel} failed`,
      });
      const delivRes = await api.notifications.deliveries();
      if (!delivRes._offline) setDeliveries(delivRes.data.deliveries);
    } catch (err: any) {
      setStatusMessage({ kind: 'err', text: err?.message || `Failed to send ${channel} test` });
    } finally {
      setTestingChannel(null);
    }
  };

  const toggleAssetClass = (cls: 'CRYPTO' | 'FOREX_COMMODITY') => {
    setSettings((prev) => {
      const exists = prev.assetClasses.includes(cls);
      const next = exists
        ? prev.assetClasses.filter((c) => c !== cls)
        : [...prev.assetClasses, cls];
      return { ...prev, assetClasses: next.length ? next : [cls] };
    });
  };

  const copySecret = () => {
    if (!revealedSecret) return;
    void navigator.clipboard.writeText(revealedSecret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 1800);
  };

  return (
    <div className="glass-card p-4 mb-5 border border-border/60">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Bell className="w-4 h-4 text-primary shrink-0" />
          <div>
            <h3 className="text-sm font-semibold">Real-Time Push Alerts &amp; Priority Webhooks</h3>
            <p className="text-xs text-muted-foreground">
              Pro: HMAC-signed HTTPS webhooks • VIP: Webhooks + instant Telegram signal &amp; TP/SL delivery
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
        >
          {open ? (
            <>
              Close Setup <ChevronUp className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              Configure Alerts <ChevronDown className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-border/40 space-y-5">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading notification preferences...</p>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Priority Webhook Streams (Pro + VIP) */}
                <div className="rounded-xl bg-secondary/35 border border-border/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Webhook className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold">Priority Webhook Stream</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-primary/15 text-primary">
                        PRO &amp; VIP
                      </span>
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.webhookEnabled}
                        onChange={(e) => setSettings((s) => ({ ...s, webhookEnabled: e.target.checked }))}
                        className="rounded border-border accent-primary"
                      />
                      Enabled
                    </label>
                  </div>

                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">
                      HTTPS Webhook Endpoint URL
                    </label>
                    <input
                      type="url"
                      value={settings.webhookUrl}
                      onChange={(e) => setSettings((s) => ({ ...s, webhookUrl: e.target.value }))}
                      placeholder="https://your-bot.example.com/webhooks/cryptox"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] text-muted-foreground">
                        HMAC-SHA256 Signing Secret {settings.webhookSecretPreview ? `(${settings.webhookSecretPreview})` : ''}
                      </label>
                      {settings.hasWebhookSecret && (
                        <button
                          type="button"
                          onClick={() => void handleSave(true)}
                          disabled={saving}
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        >
                          <RefreshCw className="w-3 h-3" /> Rotate secret
                        </button>
                      )}
                    </div>
                    <input
                      type="password"
                      value={newSecretInput}
                      onChange={(e) => setNewSecretInput(e.target.value)}
                      placeholder={settings.hasWebhookSecret ? 'Leave blank to keep existing secret' : 'Optional custom secret (auto-generated if blank)'}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {revealedSecret && (
                      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1.5 text-[11px]">
                        <span className="font-mono truncate text-emerald-300">
                          Signing secret: {revealedSecret}
                        </span>
                        <button
                          type="button"
                          onClick={copySecret}
                          className="inline-flex items-center gap-1 text-emerald-300 font-medium shrink-0"
                        >
                          {copiedSecret ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedSecret ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-muted-foreground">
                      Verified via header <code className="text-foreground">X-CryptoX-Signature: sha256=...</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleTest('webhook')}
                      disabled={testingChannel !== null || !settings.webhookUrl.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                    >
                      {testingChannel === 'webhook' ? 'Sending...' : 'Send Test Webhook'}
                    </button>
                  </div>
                </div>

                {/* Telegram Push Alerts (VIP) */}
                <div className="rounded-xl bg-secondary/35 border border-border/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Send className="w-4 h-4 text-sky-400" />
                      <span className="text-sm font-semibold">Telegram Push Alerts</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400">
                        VIP
                      </span>
                    </div>
                    {isVip && (
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.telegramEnabled}
                          onChange={(e) => setSettings((s) => ({ ...s, telegramEnabled: e.target.checked }))}
                          className="rounded border-border accent-primary"
                        />
                        Enabled
                      </label>
                    )}
                  </div>

                  {!isVip ? (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Instant Telegram push alerts for new MTF setups and audited TP/SL outcomes are included in{' '}
                        <strong className="text-foreground">VIP Whale / Quant</strong>.
                      </p>
                      <button
                        type="button"
                        onClick={openPlans}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                      >
                        Upgrade to VIP
                      </button>
                    </div>
                  ) : (
                    <>
                      {!telegramBotConfigured && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-300">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>
                            API server needs <code className="font-mono">CRYPTOX_TELEGRAM_BOT_TOKEN</code> configured in Coolify before outbound Telegram pushes can deliver.
                          </span>
                        </div>
                      )}

                      <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">
                          Telegram Chat ID or Channel (@username or numeric ID)
                        </label>
                        <input
                          type="text"
                          value={settings.telegramChatId}
                          onChange={(e) => setSettings((s) => ({ ...s, telegramChatId: e.target.value }))}
                          placeholder="e.g. 5820941273 or @my_signals_channel"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Send <code className="text-foreground">/start</code> to{' '}
                          {botUsername ? <strong className="text-foreground">@{botUsername}</strong> : 'your CryptoX bot'} (or message <code className="text-foreground">@userinfobot</code> to get your numeric Chat ID) so Telegram permits delivery.
                        </p>
                      </div>

                      <div className="flex items-center justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => void handleTest('telegram')}
                          disabled={testingChannel !== null || !settings.telegramChatId.trim()}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                        >
                          {testingChannel === 'telegram' ? 'Sending...' : 'Send Test Telegram'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Filter rules & Save */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-secondary/25 px-4 py-3 border border-border/40">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <span className="text-muted-foreground">Min Confidence:</span>
                    <input
                      type="number"
                      min={40}
                      max={95}
                      value={settings.minConfidence}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          minConfidence: Math.max(40, Math.min(95, Number(e.target.value) || 65)),
                        }))
                      }
                      className="w-16 rounded border border-border bg-background px-2 py-1 font-mono"
                    />
                    <span>%</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.assetClasses.includes('CRYPTO')}
                      onChange={() => toggleAssetClass('CRYPTO')}
                      className="accent-primary"
                    />
                    Crypto
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.assetClasses.includes('FOREX_COMMODITY')}
                      onChange={() => toggleAssetClass('FOREX_COMMODITY')}
                      className="accent-primary"
                    />
                    Gold &amp; FX
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notifyNewSignals}
                      onChange={(e) => setSettings((s) => ({ ...s, notifyNewSignals: e.target.checked }))}
                      className="accent-primary"
                    />
                    New Setups
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notifyResolutions}
                      onChange={(e) => setSettings((s) => ({ ...s, notifyResolutions: e.target.checked }))}
                      className="accent-primary"
                    />
                    TP / SL Hits
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => void handleSave(false)}
                  disabled={saving}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 shrink-0"
                >
                  {saving ? 'Saving...' : 'Save Preferences'}
                </button>
              </div>

              {statusMessage && (
                <p
                  role="status"
                  className={`text-xs ${statusMessage.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {statusMessage.text}
                </p>
              )}

              {deliveries.length > 0 && (
                <div className="border-t border-border/30 pt-3">
                  <p className="text-[11px] font-medium text-muted-foreground mb-2">Recent Alert Deliveries</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto text-[11px]">
                    {deliveries.slice(0, 8).map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between gap-2 rounded bg-secondary/30 px-2.5 py-1.5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="uppercase font-mono font-bold text-[10px] px-1.5 py-0.5 rounded bg-background">
                            {d.channel}
                          </span>
                          <span className="font-medium truncate">
                            {d.signal_pair} ({d.signal_type})
                          </span>
                          {d.error_message && (
                            <span className="text-red-400 truncate">{d.error_message}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 font-mono">
                          <span className={d.status === 'sent' ? 'text-emerald-400' : 'text-red-400'}>
                            {d.status}
                            {d.http_status ? ` (${d.http_status})` : ''}
                          </span>
                          <span className="text-muted-foreground">
                            {new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SignalAlertsPanel;
