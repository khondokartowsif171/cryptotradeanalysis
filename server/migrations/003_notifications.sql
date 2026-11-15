CREATE TABLE IF NOT EXISTS user_alert_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_chat_id TEXT,
  webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  webhook_url TEXT,
  webhook_secret TEXT,
  min_confidence INTEGER NOT NULL DEFAULT 65 CHECK (min_confidence >= 40 AND min_confidence <= 95),
  asset_classes JSONB NOT NULL DEFAULT '["CRYPTO","FOREX_COMMODITY"]'::jsonb,
  notify_new_signals BOOLEAN NOT NULL DEFAULT TRUE,
  notify_resolutions BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'webhook')),
  event_key TEXT NOT NULL,
  signal_pair TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  http_status INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_deliveries_user_channel_event_idx
  ON alert_deliveries(user_id, channel, event_key);
CREATE INDEX IF NOT EXISTS alert_deliveries_user_created_idx
  ON alert_deliveries(user_id, created_at DESC);
