package dbwriter

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	evtypes "github.com/mauyin/network-pulse/poller/pkg/types"
)

const batchSize = 100

// Writer inserts ChainEvents directly into PostgreSQL's chain_events table,
// bypassing Redis Streams. Used by the backfill pipeline.
type Writer struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewWriter(db *sql.DB, logger *slog.Logger) *Writer {
	return &Writer{db: db, logger: logger}
}

// WriteBatch inserts events into chain_events in batches.
// Uses ON CONFLICT DO NOTHING for idempotent re-runs.
// Returns the number of rows actually inserted.
func (w *Writer) WriteBatch(ctx context.Context, events []*evtypes.ChainEvent) (int, error) {
	if len(events) == 0 {
		return 0, nil
	}

	total := 0
	for i := 0; i < len(events); i += batchSize {
		end := i + batchSize
		if end > len(events) {
			end = len(events)
		}

		n, err := w.insertBatch(ctx, events[i:end])
		if err != nil {
			return total, fmt.Errorf("insert batch [%d:%d]: %w", i, end, err)
		}
		total += n
	}

	return total, nil
}

func (w *Writer) insertBatch(ctx context.Context, events []*evtypes.ChainEvent) (int, error) {
	const cols = 14
	var b strings.Builder
	b.WriteString(`
		INSERT INTO chain_events (
			chain_id, block_number, tx_hash, log_index, event_type,
			src_eid, dst_eid, sender, nonce, receiver, guid, dvn_address,
			block_timestamp, raw_data
		) VALUES `)

	args := make([]any, 0, len(events)*cols)
	for i, ev := range events {
		if i > 0 {
			b.WriteString(", ")
		}

		base := i * cols
		b.WriteString(fmt.Sprintf(
			"($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d)",
			base+1, base+2, base+3, base+4, base+5, base+6, base+7,
			base+8, base+9, base+10, base+11, base+12, base+13, base+14,
		))

		rawJSON, _ := json.Marshal(ev)

		args = append(args,
			ev.ChainID,                           // chain_id
			ev.BlockNumber,                        // block_number
			ev.TxHash.Bytes(),                     // tx_hash
			ev.LogIndex,                           // log_index
			string(ev.EventType),                  // event_type
			ev.SrcEID,                             // src_eid
			nullableUint32(ev.DstEID),             // dst_eid
			ev.Sender.Bytes(),                     // sender
			ev.Nonce,                              // nonce
			nullableAddress(ev.Receiver),          // receiver
			nullableHash(ev.GUID),                 // guid
			nullableAddress(ev.DVNAddress),         // dvn_address
			time.Unix(ev.BlockTimestamp, 0),        // block_timestamp
			string(rawJSON),                       // raw_data
		)
	}

	b.WriteString(" ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING")

	result, err := w.db.ExecContext(ctx, b.String(), args...)
	if err != nil {
		return 0, err
	}

	n, _ := result.RowsAffected()
	return int(n), nil
}

// nullableUint32 returns nil for zero values (e.g., DstEID on PacketVerified).
func nullableUint32(v uint32) any {
	if v == 0 {
		return nil
	}
	return v
}

// nullableAddress returns nil for zero addresses.
func nullableAddress(addr [20]byte) any {
	var zero [20]byte
	if addr == zero {
		return nil
	}
	return addr[:]
}

// nullableHash returns nil for zero hashes.
func nullableHash(h [32]byte) any {
	var zero [32]byte
	if h == zero {
		return nil
	}
	return h[:]
}
