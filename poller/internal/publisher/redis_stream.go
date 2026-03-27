package publisher

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/mauyin/network-pulse/poller/pkg/types"
	"github.com/redis/go-redis/v9"
)

const (
	StreamName = "stream:chain_events"
	MaxLen     = 100_000 // prevent Redis OOM — older entries trimmed automatically
)

// RedisPublisher publishes parsed chain events to a Redis Stream.
type RedisPublisher struct {
	client *redis.Client
	logger *slog.Logger
}

func NewRedisPublisher(client *redis.Client, logger *slog.Logger) *RedisPublisher {
	return &RedisPublisher{
		client: client,
		logger: logger,
	}
}

// Publish adds a chain event to the Redis Stream.
// Uses MAXLEN to cap stream size and prevent OOM.
func (p *RedisPublisher) Publish(ctx context.Context, event *types.ChainEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	result := p.client.XAdd(ctx, &redis.XAddArgs{
		Stream: StreamName,
		MaxLen: MaxLen,
		Approx: true, // ~ MAXLEN for better performance
		Values: map[string]interface{}{
			"data": string(data),
		},
	})

	if err := result.Err(); err != nil {
		p.logger.Error("failed to publish event",
			"event_type", event.EventType,
			"chain_id", event.ChainID,
			"block", event.BlockNumber,
			"error", err,
		)
		return fmt.Errorf("redis XADD: %w", err)
	}

	p.logger.Debug("published event",
		"event_type", event.EventType,
		"chain_id", event.ChainID,
		"block", event.BlockNumber,
		"tx", event.TxHash.Hex(),
	)

	return nil
}

// PublishBatch publishes multiple events in a pipeline for efficiency.
func (p *RedisPublisher) PublishBatch(ctx context.Context, events []*types.ChainEvent) error {
	if len(events) == 0 {
		return nil
	}

	pipe := p.client.Pipeline()
	for _, event := range events {
		data, err := json.Marshal(event)
		if err != nil {
			p.logger.Error("failed to marshal event in batch", "error", err)
			continue
		}

		pipe.XAdd(ctx, &redis.XAddArgs{
			Stream: StreamName,
			MaxLen: MaxLen,
			Approx: true,
			Values: map[string]interface{}{
				"data": string(data),
			},
		})
	}

	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("redis pipeline exec: %w", err)
	}

	p.logger.Info("published event batch",
		"count", len(events),
		"chain_id", events[0].ChainID,
	)

	return nil
}
