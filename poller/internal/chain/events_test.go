package chain

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	evtypes "github.com/mauyin/network-pulse/poller/pkg/types"
)

func TestParseEvent_EmptyTopics(t *testing.T) {
	log := types.Log{
		Topics: nil,
		Data:   []byte{0x01, 0x02},
	}

	evt, err := ParseEvent(log, 1, 1000)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if evt != nil {
		t.Fatalf("expected nil event, got: %+v", evt)
	}
}

func TestParseEvent_UnknownTopic(t *testing.T) {
	unknownTopic := common.HexToHash("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
	log := types.Log{
		Topics: []common.Hash{unknownTopic},
		Data:   []byte{0x01, 0x02},
	}

	evt, err := ParseEvent(log, 1, 1000)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if evt != nil {
		t.Fatalf("expected nil event, got: %+v", evt)
	}
}

// buildPacketSentData constructs valid ABI-encoded data for a PacketSent event.
//
// ABI layout (simplified for this event where encodedPayload is the first bytes arg):
//
//	[0:32]   offset to encodedPayload bytes
//	[32:64]  offset to options bytes (unused in parsing, but present)
//	[64:96]  sendLibrary address (unused in parsing, but present)
//	[96:128] length of encodedPayload
//	[128:…]  encodedPayload bytes (padded to 32-byte boundary)
//
// The payload header (PacketV1Codec) is: version(1) | nonce(8) | srcEid(4) | sender(32) | dstEid(4) | receiver(32) = 81 bytes
func buildPacketSentData(nonce uint64, srcEid uint32, sender common.Address, dstEid uint32, receiver common.Address) []byte {
	// Build the payload header (81 bytes).
	payload := make([]byte, 0, 81)
	payload = append(payload, 0x01) // version byte
	nonceBytes := make([]byte, 8)
	big.NewInt(int64(nonce)).FillBytes(nonceBytes)
	payload = append(payload, nonceBytes...)

	srcEidBytes := make([]byte, 4)
	big.NewInt(int64(srcEid)).FillBytes(srcEidBytes)
	payload = append(payload, srcEidBytes...)

	// sender as bytes32 (left-padded to 32 bytes)
	payload = append(payload, common.LeftPadBytes(sender.Bytes(), 32)...)

	dstEidBytes := make([]byte, 4)
	big.NewInt(int64(dstEid)).FillBytes(dstEidBytes)
	payload = append(payload, dstEidBytes...)

	// receiver as bytes32 (left-padded to 32 bytes)
	payload = append(payload, common.LeftPadBytes(receiver.Bytes(), 32)...)

	// Pad payload to 32-byte boundary for ABI encoding.
	paddedPayloadLen := len(payload)
	if paddedPayloadLen%32 != 0 {
		paddedPayloadLen += 32 - (paddedPayloadLen%32)
	}
	paddedPayload := make([]byte, paddedPayloadLen)
	copy(paddedPayload, payload)

	// ABI-encode the full data section.
	// Slot 0: offset to encodedPayload = 96 (0x60) — skip 3 slots (offset_payload, offset_options, sendLibrary)
	// Slot 1: offset to options = some value (not parsed, just needs to be present)
	// Slot 2: sendLibrary address (not parsed)
	// Slot 3: length of encodedPayload
	// Slot 4+: encodedPayload bytes
	data := make([]byte, 0, 128+len(paddedPayload))

	offset := make([]byte, 32)
	big.NewInt(96).FillBytes(offset) // offset to payload = 96
	data = append(data, offset...)

	optionsOffset := make([]byte, 32)
	big.NewInt(0).FillBytes(optionsOffset)
	data = append(data, optionsOffset...) // placeholder for options offset

	sendLibrary := make([]byte, 32) // placeholder for sendLibrary
	data = append(data, sendLibrary...)

	payloadLenSlot := make([]byte, 32)
	big.NewInt(int64(len(payload))).FillBytes(payloadLenSlot)
	data = append(data, payloadLenSlot...)

	data = append(data, paddedPayload...)

	return data
}

func TestParsePacketSent_Valid(t *testing.T) {
	nonce := uint64(42)
	srcEid := uint32(30101)
	dstEid := uint32(30110)
	sender := common.HexToAddress("0xABCDEF1234567890ABCDEF1234567890ABCDEF12")
	receiver := common.HexToAddress("0x1234567890ABCDEF1234567890ABCDEF12345678")
	chainID := 1
	blockTimestamp := uint64(1700000000)
	txHash := common.HexToHash("0xaaaa")
	blockNumber := uint64(12345)
	logIndex := uint(7)

	data := buildPacketSentData(nonce, srcEid, sender, dstEid, receiver)

	log := types.Log{
		Topics:      []common.Hash{PacketSentSig},
		Data:        data,
		BlockNumber: blockNumber,
		TxHash:      txHash,
		Index:       logIndex,
	}

	evt, err := ParseEvent(log, chainID, blockTimestamp)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if evt == nil {
		t.Fatal("expected non-nil event")
	}

	if evt.EventType != evtypes.EventPacketSent {
		t.Errorf("EventType = %q, want %q", evt.EventType, evtypes.EventPacketSent)
	}
	if evt.ChainID != chainID {
		t.Errorf("ChainID = %d, want %d", evt.ChainID, chainID)
	}
	if evt.BlockNumber != blockNumber {
		t.Errorf("BlockNumber = %d, want %d", evt.BlockNumber, blockNumber)
	}
	if evt.TxHash != txHash {
		t.Errorf("TxHash = %s, want %s", evt.TxHash.Hex(), txHash.Hex())
	}
	if evt.LogIndex != logIndex {
		t.Errorf("LogIndex = %d, want %d", evt.LogIndex, logIndex)
	}
	if evt.BlockTimestamp != int64(blockTimestamp) {
		t.Errorf("BlockTimestamp = %d, want %d", evt.BlockTimestamp, blockTimestamp)
	}
	if evt.SrcEID != srcEid {
		t.Errorf("SrcEID = %d, want %d", evt.SrcEID, srcEid)
	}
	if evt.DstEID != dstEid {
		t.Errorf("DstEID = %d, want %d", evt.DstEID, dstEid)
	}
	if evt.Sender != sender {
		t.Errorf("Sender = %s, want %s", evt.Sender.Hex(), sender.Hex())
	}
	if evt.Receiver != receiver {
		t.Errorf("Receiver = %s, want %s", evt.Receiver.Hex(), receiver.Hex())
	}
	if evt.Nonce != nonce {
		t.Errorf("Nonce = %d, want %d", evt.Nonce, nonce)
	}

	// Verify GUID: keccak256 of the first 80 bytes of payload.
	payloadHeader := make([]byte, 0, 80)
	nonceBytes := make([]byte, 8)
	big.NewInt(int64(nonce)).FillBytes(nonceBytes)
	payloadHeader = append(payloadHeader, nonceBytes...)
	srcEidBytes := make([]byte, 4)
	big.NewInt(int64(srcEid)).FillBytes(srcEidBytes)
	payloadHeader = append(payloadHeader, srcEidBytes...)
	payloadHeader = append(payloadHeader, common.LeftPadBytes(sender.Bytes(), 32)...)
	dstEidBytes := make([]byte, 4)
	big.NewInt(int64(dstEid)).FillBytes(dstEidBytes)
	payloadHeader = append(payloadHeader, dstEidBytes...)
	payloadHeader = append(payloadHeader, common.LeftPadBytes(receiver.Bytes(), 32)...)
	expectedGUID := crypto.Keccak256Hash(payloadHeader)

	if evt.GUID != expectedGUID {
		t.Errorf("GUID = %s, want %s", evt.GUID.Hex(), expectedGUID.Hex())
	}
}

func TestParsePacketSent_DataTooShort(t *testing.T) {
	// Data shorter than 64 bytes should error.
	data := make([]byte, 63)

	log := types.Log{
		Topics: []common.Hash{PacketSentSig},
		Data:   data,
	}

	evt, err := ParseEvent(log, 1, 1000)
	if err == nil {
		t.Fatal("expected error for short data, got nil")
	}
	if evt != nil {
		t.Fatalf("expected nil event, got: %+v", evt)
	}
}

func TestParsePacketSent_PayloadTooShort(t *testing.T) {
	// Build ABI structure that's valid but payload is only 80 bytes (< 81).
	payload := make([]byte, 80) // too short for header

	// Pad payload to 32-byte boundary.
	paddedPayloadLen := 96 // next 32-byte boundary above 80
	paddedPayload := make([]byte, paddedPayloadLen)
	copy(paddedPayload, payload)

	data := make([]byte, 0, 128+paddedPayloadLen)

	offset := make([]byte, 32)
	big.NewInt(96).FillBytes(offset) // offset to payload = 96
	data = append(data, offset...)

	optionsOffset := make([]byte, 32)
	data = append(data, optionsOffset...)

	sendLibrary := make([]byte, 32)
	data = append(data, sendLibrary...)

	payloadLenSlot := make([]byte, 32)
	big.NewInt(80).FillBytes(payloadLenSlot)
	data = append(data, payloadLenSlot...)

	data = append(data, paddedPayload...)

	log := types.Log{
		Topics: []common.Hash{PacketSentSig},
		Data:   data,
	}

	evt, err := ParseEvent(log, 1, 1000)
	if err == nil {
		t.Fatal("expected error for payload too short, got nil")
	}
	if evt != nil {
		t.Fatalf("expected nil event, got: %+v", evt)
	}
}

// buildVerifiedOrDeliveredData builds ABI-encoded data for PacketVerified or PacketDelivered.
//
// Layout:
//
//	[0:32]   srcEid  (uint32 padded to 32 bytes)
//	[32:64]  sender  (bytes32)
//	[64:96]  nonce   (uint64 padded to 32 bytes)
//	[96:128] receiver (address padded to 32 bytes)
//
// For PacketVerified, an additional slot is appended:
//
//	[128:160] payloadHash (bytes32)
func buildVerifiedOrDeliveredData(srcEid uint32, sender common.Address, nonce uint64, receiver common.Address, payloadHash *common.Hash) []byte {
	size := 128
	if payloadHash != nil {
		size = 160
	}
	data := make([]byte, size)

	// srcEid at [0:32]
	big.NewInt(int64(srcEid)).FillBytes(data[0:32])

	// sender at [32:64] — left-padded to 32 bytes
	copy(data[32:64], common.LeftPadBytes(sender.Bytes(), 32))

	// nonce at [64:96]
	big.NewInt(int64(nonce)).FillBytes(data[64:96])

	// receiver at [96:128] — left-padded to 32 bytes
	copy(data[96:128], common.LeftPadBytes(receiver.Bytes(), 32))

	if payloadHash != nil {
		copy(data[128:160], payloadHash.Bytes())
	}

	return data
}

func TestParsePacketVerified_Valid(t *testing.T) {
	srcEid := uint32(30101)
	sender := common.HexToAddress("0xABCDEF1234567890ABCDEF1234567890ABCDEF12")
	nonce := uint64(99)
	receiver := common.HexToAddress("0x1234567890ABCDEF1234567890ABCDEF12345678")
	payloadHash := common.HexToHash("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	chainID := 42
	blockTimestamp := uint64(1700001000)
	txHash := common.HexToHash("0xcccc")
	blockNumber := uint64(54321)
	logIndex := uint(3)

	data := buildVerifiedOrDeliveredData(srcEid, sender, nonce, receiver, &payloadHash)

	log := types.Log{
		Topics:      []common.Hash{PacketVerifiedSig},
		Data:        data,
		BlockNumber: blockNumber,
		TxHash:      txHash,
		Index:       logIndex,
	}

	evt, err := ParseEvent(log, chainID, blockTimestamp)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if evt == nil {
		t.Fatal("expected non-nil event")
	}

	if evt.EventType != evtypes.EventPacketVerified {
		t.Errorf("EventType = %q, want %q", evt.EventType, evtypes.EventPacketVerified)
	}
	if evt.ChainID != chainID {
		t.Errorf("ChainID = %d, want %d", evt.ChainID, chainID)
	}
	if evt.BlockNumber != blockNumber {
		t.Errorf("BlockNumber = %d, want %d", evt.BlockNumber, blockNumber)
	}
	if evt.TxHash != txHash {
		t.Errorf("TxHash = %s, want %s", evt.TxHash.Hex(), txHash.Hex())
	}
	if evt.LogIndex != logIndex {
		t.Errorf("LogIndex = %d, want %d", evt.LogIndex, logIndex)
	}
	if evt.BlockTimestamp != int64(blockTimestamp) {
		t.Errorf("BlockTimestamp = %d, want %d", evt.BlockTimestamp, blockTimestamp)
	}
	if evt.SrcEID != srcEid {
		t.Errorf("SrcEID = %d, want %d", evt.SrcEID, srcEid)
	}
	if evt.Sender != sender {
		t.Errorf("Sender = %s, want %s", evt.Sender.Hex(), sender.Hex())
	}
	if evt.Nonce != nonce {
		t.Errorf("Nonce = %d, want %d", evt.Nonce, nonce)
	}
	if evt.Receiver != receiver {
		t.Errorf("Receiver = %s, want %s", evt.Receiver.Hex(), receiver.Hex())
	}
	if evt.PayloadHash != payloadHash {
		t.Errorf("PayloadHash = %s, want %s", evt.PayloadHash.Hex(), payloadHash.Hex())
	}
}

func TestParsePacketVerified_DataTooShort(t *testing.T) {
	data := make([]byte, 159)

	log := types.Log{
		Topics: []common.Hash{PacketVerifiedSig},
		Data:   data,
	}

	evt, err := ParseEvent(log, 1, 1000)
	if err == nil {
		t.Fatal("expected error for short data, got nil")
	}
	if evt != nil {
		t.Fatalf("expected nil event, got: %+v", evt)
	}
}

func TestParsePacketDelivered_Valid(t *testing.T) {
	srcEid := uint32(30110)
	sender := common.HexToAddress("0x9999888877776666555544443333222211110000")
	nonce := uint64(7)
	receiver := common.HexToAddress("0x0000111122223333444455556666777788889999")
	chainID := 137
	blockTimestamp := uint64(1700002000)
	txHash := common.HexToHash("0xdddd")
	blockNumber := uint64(99999)
	logIndex := uint(0)

	data := buildVerifiedOrDeliveredData(srcEid, sender, nonce, receiver, nil)

	log := types.Log{
		Topics:      []common.Hash{PacketDeliveredSig},
		Data:        data,
		BlockNumber: blockNumber,
		TxHash:      txHash,
		Index:       logIndex,
	}

	evt, err := ParseEvent(log, chainID, blockTimestamp)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if evt == nil {
		t.Fatal("expected non-nil event")
	}

	if evt.EventType != evtypes.EventPacketDelivered {
		t.Errorf("EventType = %q, want %q", evt.EventType, evtypes.EventPacketDelivered)
	}
	if evt.ChainID != chainID {
		t.Errorf("ChainID = %d, want %d", evt.ChainID, chainID)
	}
	if evt.BlockNumber != blockNumber {
		t.Errorf("BlockNumber = %d, want %d", evt.BlockNumber, blockNumber)
	}
	if evt.TxHash != txHash {
		t.Errorf("TxHash = %s, want %s", evt.TxHash.Hex(), txHash.Hex())
	}
	if evt.LogIndex != logIndex {
		t.Errorf("LogIndex = %d, want %d", evt.LogIndex, logIndex)
	}
	if evt.BlockTimestamp != int64(blockTimestamp) {
		t.Errorf("BlockTimestamp = %d, want %d", evt.BlockTimestamp, blockTimestamp)
	}
	if evt.SrcEID != srcEid {
		t.Errorf("SrcEID = %d, want %d", evt.SrcEID, srcEid)
	}
	if evt.Sender != sender {
		t.Errorf("Sender = %s, want %s", evt.Sender.Hex(), sender.Hex())
	}
	if evt.Nonce != nonce {
		t.Errorf("Nonce = %d, want %d", evt.Nonce, nonce)
	}
	if evt.Receiver != receiver {
		t.Errorf("Receiver = %s, want %s", evt.Receiver.Hex(), receiver.Hex())
	}
}

func TestParsePacketDelivered_DataTooShort(t *testing.T) {
	data := make([]byte, 127)

	log := types.Log{
		Topics: []common.Hash{PacketDeliveredSig},
		Data:   data,
	}

	evt, err := ParseEvent(log, 1, 1000)
	if err == nil {
		t.Fatal("expected error for short data, got nil")
	}
	if evt != nil {
		t.Fatalf("expected nil event, got: %+v", evt)
	}
}
