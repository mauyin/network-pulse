-- Migration: Add unique constraints for deduplication safety
-- Pre-requisite: deduplicate existing rows (keep lowest id per unique tuple)

BEGIN;

-- 1. Deduplicate chain_events (keep lowest id per chain_id, tx_hash, log_index)
DELETE FROM chain_events a
  USING chain_events b
  WHERE a.chain_id = b.chain_id
    AND a.tx_hash = b.tx_hash
    AND a.log_index = b.log_index
    AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chain_events_unique
  ON chain_events(chain_id, tx_hash, log_index);

-- 2. Deduplicate dvn_verifications (keep lowest id per message_guid, dvn_address, tx_hash)
DELETE FROM dvn_verifications a
  USING dvn_verifications b
  WHERE a.message_guid = b.message_guid
    AND a.dvn_address = b.dvn_address
    AND a.tx_hash = b.tx_hash
    AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dvn_verif_unique
  ON dvn_verifications(message_guid, dvn_address, tx_hash);

COMMIT;
