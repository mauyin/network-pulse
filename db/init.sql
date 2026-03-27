-- DVN Pathway Health Service — Database Schema

-- Raw chain events
CREATE TABLE chain_events (
  id BIGSERIAL PRIMARY KEY,
  chain_id INT NOT NULL,
  block_number BIGINT NOT NULL,
  tx_hash BYTEA NOT NULL,
  log_index INT NOT NULL,
  event_type TEXT NOT NULL,  -- 'PacketSent', 'PacketVerified', 'PacketDelivered'
  src_eid INT NOT NULL,
  dst_eid INT,
  sender BYTEA NOT NULL,
  receiver BYTEA,
  nonce BIGINT NOT NULL,
  guid BYTEA,
  dvn_address BYTEA,
  block_timestamp TIMESTAMPTZ NOT NULL,
  ingestion_timestamp TIMESTAMPTZ DEFAULT NOW(),
  raw_data JSONB
);

CREATE INDEX idx_chain_events_type ON chain_events(event_type, block_timestamp DESC);
CREATE INDEX idx_chain_events_origin ON chain_events(src_eid, sender, nonce);

-- Dedup safety: one row per on-chain event (enables ON CONFLICT DO NOTHING)
CREATE UNIQUE INDEX idx_chain_events_unique ON chain_events(chain_id, tx_hash, log_index);

-- Correlated cross-chain messages
CREATE TABLE messages (
  guid BYTEA PRIMARY KEY,
  src_eid INT NOT NULL,
  dst_eid INT NOT NULL,
  sender BYTEA NOT NULL,
  receiver BYTEA NOT NULL,
  nonce BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',  -- 'sent', 'verified', 'delivered'
  sent_block_number BIGINT,
  sent_tx_hash BYTEA,
  sent_at TIMESTAMPTZ,
  first_verified_at TIMESTAMPTZ,
  fully_verified_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  delivered_tx_hash BYTEA,
  verification_latency_s FLOAT,
  delivery_latency_s FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_pathway ON messages(src_eid, dst_eid);
CREATE INDEX idx_messages_sent_at ON messages(sent_at);
CREATE INDEX idx_messages_origin ON messages(src_eid, sender, nonce);
CREATE INDEX idx_messages_sender ON messages(sender);

-- DVN verification records
CREATE TABLE dvn_verifications (
  id BIGSERIAL PRIMARY KEY,
  message_guid BYTEA REFERENCES messages(guid),
  dvn_address BYTEA NOT NULL,
  src_eid INT NOT NULL,
  dst_eid INT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  verification_latency_s FLOAT NOT NULL,
  block_number BIGINT NOT NULL,
  tx_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Composite index for analytics queries (covers percentile_cont filter pattern)
CREATE INDEX idx_dvn_verif_analytics
  ON dvn_verifications(src_eid, dst_eid, dvn_address, verified_at);
CREATE INDEX idx_dvn_verif_dvn ON dvn_verifications(dvn_address);
CREATE INDEX idx_dvn_verif_time ON dvn_verifications(verified_at);

-- Dedup safety: one row per DVN per verification tx (enables ON CONFLICT DO NOTHING)
CREATE UNIQUE INDEX idx_dvn_verif_unique ON dvn_verifications(message_guid, dvn_address, tx_hash);

-- DVN providers (one row per DVN identity, from LayerZero metadata API)
CREATE TABLE dvn_providers (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  deprecated BOOLEAN DEFAULT FALSE,
  lz_read_compatible BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- DVN addresses (one row per DVN per chain)
CREATE TABLE dvn_addresses (
  address BYTEA NOT NULL,
  eid INT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES dvn_providers(id),
  version INT DEFAULT 2,
  deprecated BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (address, eid)
);

CREATE INDEX idx_dvn_addresses_provider ON dvn_addresses(provider_id);
CREATE INDEX idx_dvn_addresses_eid ON dvn_addresses(eid);

-- Active alerts
CREATE TABLE alerts (
  id BIGSERIAL PRIMARY KEY,
  alert_type TEXT NOT NULL,  -- 'pathway_degraded', 'dvn_anomaly', 'stuck_message'
  severity TEXT NOT NULL,    -- 'info', 'warning', 'critical'
  src_eid INT,
  dst_eid INT,
  dvn_address BYTEA,
  message_guid BYTEA,
  reason TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_alerts_active ON alerts(is_active, created_at DESC);
CREATE INDEX idx_alerts_pathway ON alerts(src_eid, dst_eid);

-- API keys for external consumers
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  rate_limit INT DEFAULT 100,     -- requests per minute
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_keys_key ON api_keys(key);

-- Alert subscriptions (webhook delivery)
CREATE TABLE alert_subscriptions (
  id TEXT PRIMARY KEY,
  pathway_src_eid INT,
  pathway_dst_eid INT,
  dvn_address BYTEA,
  threshold_type TEXT NOT NULL,    -- 'health_score', 'latency', 'stuck_message'
  threshold_value FLOAT NOT NULL,
  webhook_url TEXT NOT NULL,
  webhook_secret TEXT,             -- optional HMAC signing secret
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alert_subs_pathway ON alert_subscriptions(pathway_src_eid, pathway_dst_eid);
CREATE INDEX idx_alert_subs_active ON alert_subscriptions(is_active);
