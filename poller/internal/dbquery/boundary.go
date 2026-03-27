package dbquery

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ChainBoundary represents the earliest data in chain_events for a given chain.
type ChainBoundary struct {
	MinBlock     uint64
	MinTimestamp time.Time
	EventCount   int64
}

// GetChainBoundary returns the earliest block and timestamp in chain_events
// for the given chainID. Returns nil if no data exists for this chain.
func GetChainBoundary(ctx context.Context, db *sql.DB, chainID int) (*ChainBoundary, error) {
	var minBlock sql.NullInt64
	var minTimestamp sql.NullTime
	var count int64

	err := db.QueryRowContext(ctx, `
		SELECT MIN(block_number), MIN(block_timestamp), COUNT(*)
		FROM chain_events
		WHERE chain_id = $1
	`, chainID).Scan(&minBlock, &minTimestamp, &count)
	if err != nil {
		return nil, fmt.Errorf("query chain boundary for chain_id=%d: %w", chainID, err)
	}

	if !minBlock.Valid || count == 0 {
		return nil, nil
	}

	return &ChainBoundary{
		MinBlock:     uint64(minBlock.Int64),
		MinTimestamp: minTimestamp.Time,
		EventCount:   count,
	}, nil
}

// OpenDB opens a PostgreSQL connection using the DATABASE_URL format.
func OpenDB(databaseURL string) (*sql.DB, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return db, nil
}
