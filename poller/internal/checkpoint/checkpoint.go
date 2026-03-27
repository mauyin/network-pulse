package checkpoint

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"

	"github.com/redis/go-redis/v9"
)

// Store persists the last processed block per chain in Redis.
// On restart, the poller resumes from the checkpoint instead of replaying
// all events from genesis.
//
//	Redis key format: chain:{chain_id}:last_block
type Store struct {
	client *redis.Client
	logger *slog.Logger
}

func NewStore(client *redis.Client, logger *slog.Logger) *Store {
	return &Store{
		client: client,
		logger: logger,
	}
}

func (s *Store) key(chainID int) string {
	return fmt.Sprintf("chain:%d:last_block", chainID)
}

// Get returns the last processed block for a chain.
// Returns 0 if no checkpoint exists (cold start).
func (s *Store) Get(ctx context.Context, chainID int) (uint64, error) {
	val, err := s.client.Get(ctx, s.key(chainID)).Result()
	if err == redis.Nil {
		s.logger.Info("no checkpoint found, starting from latest",
			"chain_id", chainID,
		)
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("redis GET checkpoint: %w", err)
	}

	block, err := strconv.ParseUint(val, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse checkpoint value %q: %w", val, err)
	}

	s.logger.Info("resuming from checkpoint",
		"chain_id", chainID,
		"block", block,
	)

	return block, nil
}

// Save persists the last processed block for a chain.
func (s *Store) Save(ctx context.Context, chainID int, blockNumber uint64) error {
	err := s.client.Set(ctx, s.key(chainID), strconv.FormatUint(blockNumber, 10), 0).Err()
	if err != nil {
		return fmt.Errorf("redis SET checkpoint: %w", err)
	}
	return nil
}

// ── Backfill progress ───────────────────────────────────────

// BackfillProgress tracks the state of a backfill run for a single chain.
type BackfillProgress struct {
	ChainID      int    `json:"chain_id"`
	StartBlock   uint64 `json:"start_block"`   // where the scan began (forward scan floor)
	CurrentBlock uint64 `json:"current_block"` // last successfully processed block
	TargetBlock  uint64 `json:"target_block"`  // head block at backfill start
	EventCount   int    `json:"event_count"`
	BatchCount   int    `json:"batch_count"`
}

func (s *Store) backfillKey(chainID int) string {
	return fmt.Sprintf("backfill:%d:progress", chainID)
}

// GetBackfill returns the saved backfill progress for a chain.
// Returns nil if no progress exists.
func (s *Store) GetBackfill(ctx context.Context, chainID int) (*BackfillProgress, error) {
	val, err := s.client.Get(ctx, s.backfillKey(chainID)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("redis GET backfill progress: %w", err)
	}

	var progress BackfillProgress
	if err := json.Unmarshal([]byte(val), &progress); err != nil {
		return nil, fmt.Errorf("parse backfill progress: %w", err)
	}

	s.logger.Info("found backfill checkpoint",
		"chain_id", chainID,
		"current_block", progress.CurrentBlock,
		"target_block", progress.TargetBlock,
		"events", progress.EventCount,
	)

	return &progress, nil
}

// SaveBackfill persists the backfill progress for a chain.
func (s *Store) SaveBackfill(ctx context.Context, progress *BackfillProgress) error {
	data, err := json.Marshal(progress)
	if err != nil {
		return fmt.Errorf("marshal backfill progress: %w", err)
	}

	if err := s.client.Set(ctx, s.backfillKey(progress.ChainID), data, 0).Err(); err != nil {
		return fmt.Errorf("redis SET backfill progress: %w", err)
	}
	return nil
}

// ClearBackfill removes the backfill checkpoint for a chain.
func (s *Store) ClearBackfill(ctx context.Context, chainID int) error {
	return s.client.Del(ctx, s.backfillKey(chainID)).Err()
}
