package chain

import (
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	evtypes "github.com/mauyin/network-pulse/poller/pkg/types"
)

// EndpointV2 event signatures.
//
// PacketSent(bytes encodedPayload, bytes options, address sendLibrary)
// PacketVerified(Origin origin, address receiver, bytes32 payloadHash)
// PacketDelivered(Origin origin, address receiver)
//
// Origin is a struct: (uint32 srcEid, bytes32 sender, uint64 nonce)
var (
	PacketSentSig      = crypto.Keccak256Hash([]byte("PacketSent(bytes,bytes,address)"))
	PacketVerifiedSig  = crypto.Keccak256Hash([]byte("PacketVerified((uint32,bytes32,uint64),address,bytes32)"))
	PacketDeliveredSig = crypto.Keccak256Hash([]byte("PacketDelivered((uint32,bytes32,uint64),address)"))
)

// ParseEvent decodes a raw Ethereum log into a ChainEvent.
// Returns nil if the log doesn't match a known event signature.
func ParseEvent(log types.Log, chainID int, blockTimestamp uint64) (*evtypes.ChainEvent, error) {
	if len(log.Topics) == 0 {
		return nil, nil
	}

	switch log.Topics[0] {
	case PacketSentSig:
		return parsePacketSent(log, chainID, blockTimestamp)
	case PacketVerifiedSig:
		return parsePacketVerified(log, chainID, blockTimestamp)
	case PacketDeliveredSig:
		return parsePacketDelivered(log, chainID, blockTimestamp)
	default:
		return nil, nil // not our event
	}
}

func parsePacketSent(log types.Log, chainID int, blockTimestamp uint64) (*evtypes.ChainEvent, error) {
	// PacketSent emits the full encoded payload in data.
	// The payload contains: nonce (8 bytes) | srcEid (4) | sender (32) | dstEid (4) | receiver (32)
	// We need to decode the first argument (bytes encodedPayload) from the ABI-encoded data.
	if len(log.Data) < 64 {
		return nil, fmt.Errorf("PacketSent data too short: %d bytes", len(log.Data))
	}

	// ABI decoding: first 32 bytes = offset to encodedPayload, next 32 = offset to options, etc.
	// Read offset to first bytes param
	offset := new(big.Int).SetBytes(log.Data[0:32]).Uint64()
	if offset+32 > uint64(len(log.Data)) {
		return nil, fmt.Errorf("PacketSent: invalid offset %d for data length %d", offset, len(log.Data))
	}

	// Read length of encodedPayload
	payloadLen := new(big.Int).SetBytes(log.Data[offset : offset+32]).Uint64()
	payloadStart := offset + 32
	if payloadStart+payloadLen > uint64(len(log.Data)) {
		return nil, fmt.Errorf("PacketSent: payload extends beyond data")
	}

	payload := log.Data[payloadStart : payloadStart+payloadLen]

	// Decode packet header from payload (PacketV1Codec):
	// version (1 byte) | nonce (8) | srcEid (4) | sender (32) | dstEid (4) | receiver (32) = 81 bytes
	if len(payload) < 81 {
		return nil, fmt.Errorf("PacketSent: payload too short for header: %d bytes", len(payload))
	}

	// Skip version byte (payload[0] == 0x01)
	nonce := new(big.Int).SetBytes(payload[1:9]).Uint64()
	srcEid := uint32(new(big.Int).SetBytes(payload[9:13]).Uint64())
	sender := common.BytesToAddress(payload[13:45]) // bytes32, take last 20
	dstEid := uint32(new(big.Int).SetBytes(payload[45:49]).Uint64())
	receiver := common.BytesToAddress(payload[49:81]) // bytes32, take last 20

	// GUID = keccak256(nonce, srcEid, sender, dstEid, receiver)
	guidInput := make([]byte, 0, 80)
	guidInput = append(guidInput, payload[1:81]...)
	guid := crypto.Keccak256Hash(guidInput)

	return &evtypes.ChainEvent{
		EventType:          evtypes.EventPacketSent,
		ChainID:            chainID,
		BlockNumber:        log.BlockNumber,
		TxHash:             log.TxHash,
		LogIndex:           log.Index,
		BlockTimestamp:     int64(blockTimestamp),
		SrcEID:             srcEid,
		DstEID:             dstEid,
		Sender:             sender,
		Receiver:           receiver,
		Nonce:              nonce,
		GUID:               guid,
		IngestionTimestamp:  time.Now().Unix(),
	}, nil
}

func parsePacketVerified(log types.Log, chainID int, blockTimestamp uint64) (*evtypes.ChainEvent, error) {
	// PacketVerified((uint32 srcEid, bytes32 sender, uint64 nonce), address receiver, bytes32 payloadHash)
	// The Origin tuple is ABI-encoded in the data (not indexed).
	if len(log.Data) < 160 {
		return nil, fmt.Errorf("PacketVerified data too short: %d bytes", len(log.Data))
	}

	// Decode Origin struct from data:
	// [0:32]   srcEid (uint32, padded to 32 bytes)
	// [32:64]  sender (bytes32)
	// [64:96]  nonce (uint64, padded to 32 bytes)
	// [96:128] receiver (address, padded to 32 bytes)
	// [128:160] payloadHash (bytes32)
	srcEid := uint32(new(big.Int).SetBytes(log.Data[0:32]).Uint64())
	sender := common.BytesToAddress(log.Data[32:64])
	nonce := new(big.Int).SetBytes(log.Data[64:96]).Uint64()
	receiver := common.BytesToAddress(log.Data[96:128])
	payloadHash := common.BytesToHash(log.Data[128:160])

	// DVNAddress is resolved in fetchAndParse() via eth_getTransactionByHash.
	// ParseEvent stays pure (no I/O).

	return &evtypes.ChainEvent{
		EventType:          evtypes.EventPacketVerified,
		ChainID:            chainID,
		BlockNumber:        log.BlockNumber,
		TxHash:             log.TxHash,
		LogIndex:           log.Index,
		BlockTimestamp:     int64(blockTimestamp),
		SrcEID:             srcEid,
		Sender:             sender,
		Nonce:              nonce,
		Receiver:           receiver,
		PayloadHash:        payloadHash,
		IngestionTimestamp:  time.Now().Unix(),
	}, nil
}

func parsePacketDelivered(log types.Log, chainID int, blockTimestamp uint64) (*evtypes.ChainEvent, error) {
	// PacketDelivered((uint32 srcEid, bytes32 sender, uint64 nonce), address receiver)
	if len(log.Data) < 128 {
		return nil, fmt.Errorf("PacketDelivered data too short: %d bytes", len(log.Data))
	}

	srcEid := uint32(new(big.Int).SetBytes(log.Data[0:32]).Uint64())
	sender := common.BytesToAddress(log.Data[32:64])
	nonce := new(big.Int).SetBytes(log.Data[64:96]).Uint64()
	receiver := common.BytesToAddress(log.Data[96:128])

	return &evtypes.ChainEvent{
		EventType:          evtypes.EventPacketDelivered,
		ChainID:            chainID,
		BlockNumber:        log.BlockNumber,
		TxHash:             log.TxHash,
		LogIndex:           log.Index,
		BlockTimestamp:     int64(blockTimestamp),
		SrcEID:             srcEid,
		Sender:             sender,
		Nonce:              nonce,
		Receiver:           receiver,
		IngestionTimestamp:  time.Now().Unix(),
	}, nil
}
