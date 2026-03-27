package types

import (
	"github.com/ethereum/go-ethereum/common"
)

// EventType represents the type of LayerZero event.
type EventType string

const (
	EventPacketSent      EventType = "PacketSent"
	EventPacketVerified  EventType = "PacketVerified"
	EventPacketDelivered EventType = "PacketDelivered"
)

// ChainEvent is the canonical event structure published to Redis Streams.
// This must stay in sync with the JSON schemas in schemas/.
//
//	Go struct ──serialize──▶ Redis Stream ──deserialize──▶ TS interface
type ChainEvent struct {
	EventType          EventType      `json:"event_type"`
	ChainID            int            `json:"chain_id"`
	BlockNumber        uint64         `json:"block_number"`
	TxHash             common.Hash    `json:"tx_hash"`
	LogIndex           uint           `json:"log_index"`
	BlockTimestamp     int64          `json:"block_timestamp"`
	SrcEID             uint32         `json:"src_eid"`
	DstEID             uint32         `json:"dst_eid,omitempty"`
	Sender             common.Address `json:"sender"`
	Receiver           common.Address `json:"receiver,omitempty"`
	Nonce              uint64         `json:"nonce"`
	GUID               common.Hash    `json:"guid,omitempty"`
	DVNAddress         common.Address `json:"dvn_address,omitempty"`
	PayloadHash        common.Hash    `json:"payload_hash,omitempty"`
	IngestionTimestamp int64          `json:"ingestion_timestamp"`
}
