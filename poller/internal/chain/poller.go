package chain

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/sony/gobreaker/v2"

	"github.com/mauyin/network-pulse/poller/internal/checkpoint"
	"github.com/mauyin/network-pulse/poller/internal/publisher"
	evtypes "github.com/mauyin/network-pulse/poller/pkg/types"
)

// Poller continuously polls a single chain for LayerZero events.
// Each chain gets its own goroutine with independent polling interval,
// circuit breaker, and checkpoint.
//
// Adaptive polling (tuned for Alchemy free tier — 10-block getLogs limit):
//   Default:    poll every block_time * 10 (fills every getLogs batch)
//   Events hit: decrease to block_time * 1 (lowest latency)
//   10 empty:   increase to block_time * 20 (max CU saving)
type Poller struct {
	config         ChainConfig
	client         *ethclient.Client
	fallbackClient *ethclient.Client // optional 2nd RPC for failover
	usingFallback  bool
	publisher      *publisher.RedisPublisher
	checkpoint     *checkpoint.Store
	breaker        *gobreaker.CircuitBreaker[[]byte]
	logger         *slog.Logger

	// adaptive polling state
	emptyPolls    int
	pollInterval  time.Duration
	lastBlock     uint64
	lastHeadBlock uint64 // for stale RPC detection
	staleChecks   int
}

func NewPoller(
	config ChainConfig,
	client *ethclient.Client,
	pub *publisher.RedisPublisher,
	cp *checkpoint.Store,
	cb *gobreaker.CircuitBreaker[[]byte],
	logger *slog.Logger,
) *Poller {
	return &Poller{
		config:       config,
		client:       client,
		publisher:    pub,
		checkpoint:   cp,
		breaker:      cb,
		logger:       logger.With("chain", config.Name, "chain_id", config.ChainID),
		pollInterval: config.BlockTime * 10,
	}
}

// SetFallbackClient configures an optional second RPC client for failover.
func (p *Poller) SetFallbackClient(client *ethclient.Client) {
	p.fallbackClient = client
}

// activeClient returns the currently active ethclient (primary or fallback).
func (p *Poller) activeClient() *ethclient.Client {
	if p.usingFallback && p.fallbackClient != nil {
		return p.fallbackClient
	}
	return p.client
}

// switchRPC toggles to the other RPC provider if a fallback is configured.
func (p *Poller) switchRPC() {
	if p.fallbackClient == nil {
		return
	}
	p.usingFallback = !p.usingFallback
	label := "primary"
	if p.usingFallback {
		label = "fallback"
	}
	p.logger.Warn("switched RPC provider", "active", label)
}

// Run starts the polling loop. Blocks until context is cancelled.
// On context cancellation (SIGTERM), saves the checkpoint before returning.
func (p *Poller) Run(ctx context.Context) {
	// Restore checkpoint
	savedBlock, err := p.checkpoint.Get(ctx, p.config.ChainID)
	if err != nil {
		p.logger.Error("failed to load checkpoint, starting from latest", "error", err)
	}
	p.lastBlock = savedBlock

	p.logger.Info("poller started",
		"endpoint", p.config.EndpointV2Address,
		"poll_interval", p.pollInterval,
		"start_block", p.lastBlock,
	)

	ticker := time.NewTicker(p.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			p.saveCheckpoint()
			p.logger.Info("poller stopped")
			return
		case <-ticker.C:
			p.poll(ctx)
			// Update ticker if interval changed
			ticker.Reset(p.pollInterval)
		}
	}
}

func (p *Poller) poll(ctx context.Context) {
	// Use circuit breaker to protect RPC calls
	_, err := p.breaker.Execute(func() ([]byte, error) {
		return nil, p.doPoll(ctx)
	})

	if err != nil {
		p.logger.Warn("poll failed (circuit breaker may be open)",
			"error", err,
			"breaker_state", p.breaker.State().String(),
		)
		// Switch to fallback RPC when circuit breaker opens
		if p.breaker.State() == gobreaker.StateOpen {
			p.switchRPC()
		}
	}
}

func (p *Poller) doPoll(ctx context.Context) error {
	// Get current head block
	head, err := p.activeClient().BlockNumber(ctx)
	if err != nil {
		return fmt.Errorf("get block number: %w", err)
	}

	// Stale RPC detection: if head hasn't moved in expected time, flag it
	if head == p.lastHeadBlock {
		p.staleChecks++
		if p.staleChecks > 5 {
			p.logger.Warn("RPC may be stale — head block unchanged",
				"head", head,
				"stale_checks", p.staleChecks,
			)
		}
	} else {
		p.staleChecks = 0
		p.lastHeadBlock = head
	}

	// Apply confirmation depth
	safeBlock := head - p.config.ConfirmationDepth
	if head < p.config.ConfirmationDepth {
		return nil // chain too young
	}

	// Determine range to poll
	fromBlock := p.lastBlock + 1
	if p.lastBlock == 0 {
		// Cold start: begin from safe block (no backfill in normal mode)
		fromBlock = safeBlock
	}

	if fromBlock > safeBlock {
		return nil // caught up, nothing new
	}

	// Cap range to avoid RPC errors
	toBlock := fromBlock + p.config.MaxBlockRange - 1
	if toBlock > safeBlock {
		toBlock = safeBlock
	}

	// Fetch logs
	events, err := p.fetchAndParse(ctx, fromBlock, toBlock)
	if err != nil {
		return err
	}

	// Publish events
	if len(events) > 0 {
		if err := p.publisher.PublishBatch(ctx, events); err != nil {
			return fmt.Errorf("publish batch: %w", err)
		}
	}

	// Update state
	p.lastBlock = toBlock
	p.adjustPollingInterval(len(events))

	p.logger.Info("polled blocks",
		"from", fromBlock,
		"to", toBlock,
		"events", len(events),
		"next_interval", p.pollInterval,
	)

	return nil
}

func (p *Poller) fetchAndParse(ctx context.Context, fromBlock, toBlock uint64) ([]*evtypes.ChainEvent, error) {
	endpointAddr := common.HexToAddress(p.config.EndpointV2Address)

	query := ethereum.FilterQuery{
		FromBlock: new(big.Int).SetUint64(fromBlock),
		ToBlock:   new(big.Int).SetUint64(toBlock),
		Addresses: []common.Address{endpointAddr},
		Topics: [][]common.Hash{
			{PacketSentSig, PacketVerifiedSig, PacketDeliveredSig},
		},
	}

	logs, err := p.activeClient().FilterLogs(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("filter logs [%d, %d]: %w", fromBlock, toBlock, err)
	}

	// Need block timestamps for each unique block
	blockTimestamps := make(map[uint64]uint64)
	for _, log := range logs {
		if _, ok := blockTimestamps[log.BlockNumber]; !ok {
			ts, err := p.getBlockTimestamp(ctx, log.BlockNumber)
			if err != nil {
				p.logger.Warn("failed to get block timestamp, using 0",
					"block", log.BlockNumber, "error", err)
				blockTimestamps[log.BlockNumber] = 0
			} else {
				blockTimestamps[log.BlockNumber] = ts
			}
		}
	}

	var events []*evtypes.ChainEvent
	for _, log := range logs {
		event, err := ParseEvent(log, p.config.ChainID, blockTimestamps[log.BlockNumber])
		if err != nil {
			p.logger.Warn("failed to parse event, skipping",
				"tx", log.TxHash.Hex(),
				"log_index", log.Index,
				"error", err,
			)
			continue
		}
		if event != nil {
			events = append(events, event)
		}
	}

	// Resolve DVN addresses (tx.from) for PacketVerified events
	txSenders := ResolveTxSenders(ctx, p.activeClient(), p.config.ChainID, logs, 10, p.logger)
	for _, event := range events {
		if event.EventType == evtypes.EventPacketVerified {
			if sender, ok := txSenders[event.TxHash]; ok {
				event.DVNAddress = sender
			}
		}
	}

	return events, nil
}

func (p *Poller) getBlockTimestamp(ctx context.Context, blockNumber uint64) (uint64, error) {
	header, err := p.activeClient().HeaderByNumber(ctx, new(big.Int).SetUint64(blockNumber))
	if err != nil {
		return 0, err
	}
	return header.Time, nil
}

// adjustPollingInterval implements adaptive polling (Alchemy free tier):
//   events found → faster polling (block_time * 1)
//   10 empty polls → slower polling (block_time * 20)
//   otherwise → default (block_time * 10, matches MaxBlockRange)
func (p *Poller) adjustPollingInterval(eventCount int) {
	if eventCount > 0 {
		p.emptyPolls = 0
		p.pollInterval = p.config.BlockTime
	} else {
		p.emptyPolls++
		if p.emptyPolls >= 10 {
			p.pollInterval = p.config.BlockTime * 20
		} else {
			p.pollInterval = p.config.BlockTime * 10
		}
	}
}

func (p *Poller) saveCheckpoint() {
	if p.lastBlock == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := p.checkpoint.Save(ctx, p.config.ChainID, p.lastBlock); err != nil {
		p.logger.Error("failed to save checkpoint on shutdown",
			"block", p.lastBlock,
			"error", err,
		)
	} else {
		p.logger.Info("checkpoint saved on shutdown", "block", p.lastBlock)
	}
}

