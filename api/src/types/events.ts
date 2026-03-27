// Canonical event types matching Go structs (poller/pkg/types/events.go)
// and JSON schemas (schemas/*.json).
// Keep in sync — CI validates via `just gen-types`.

export type EventType = "PacketSent" | "PacketVerified" | "PacketDelivered";

export interface BaseChainEvent {
  event_type: EventType;
  chain_id: number;
  block_number: number;
  tx_hash: string;
  log_index: number;
  block_timestamp: number;
  src_eid: number;
  sender: string;
  nonce: number;
  ingestion_timestamp: number;
}

export interface PacketSentEvent extends BaseChainEvent {
  event_type: "PacketSent";
  dst_eid: number;
  receiver: string;
  guid: string;
}

export interface PacketVerifiedEvent extends BaseChainEvent {
  event_type: "PacketVerified";
  dvn_address: string;
  receiver?: string;
  payload_hash?: string;
}

export interface PacketDeliveredEvent extends BaseChainEvent {
  event_type: "PacketDelivered";
  receiver?: string;
}

export type ChainEvent = PacketSentEvent | PacketVerifiedEvent | PacketDeliveredEvent;
