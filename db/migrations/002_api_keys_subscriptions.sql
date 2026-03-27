-- Migration 002: Add api_keys and alert_subscriptions tables
-- Part of CEO Strategic Expansion (Phase 2 + Phase 4)
-- Safe to run multiple times (IF NOT EXISTS)

BEGIN;

-- API keys for external consumers (Phase 2)
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  rate_limit INT DEFAULT 100,
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);

-- Alert subscriptions for webhook delivery (Phase 4)
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id TEXT PRIMARY KEY,
  pathway_src_eid INT,
  pathway_dst_eid INT,
  dvn_address BYTEA,
  threshold_type TEXT NOT NULL,
  threshold_value FLOAT NOT NULL,
  webhook_url TEXT NOT NULL,
  webhook_secret TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_subs_pathway ON alert_subscriptions(pathway_src_eid, pathway_dst_eid);
CREATE INDEX IF NOT EXISTS idx_alert_subs_active ON alert_subscriptions(is_active);

COMMIT;
