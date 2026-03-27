package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log/slog"
	"math/big"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	ethtypes "github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/errgroup"

	"github.com/mauyin/network-pulse/poller/internal/chain"
	"github.com/mauyin/network-pulse/poller/internal/checkpoint"
	"github.com/mauyin/network-pulse/poller/internal/dbquery"
	"github.com/mauyin/network-pulse/poller/internal/dbwriter"
	evtypes "github.com/mauyin/network-pulse/poller/pkg/types"
)

const (
	batchBlocks       = 10 // blocks per eth_getLogs call (Alchemy free tier)
	rateDelay         = 200 * time.Millisecond
	maxBatches        = 50_000 // safety cap: prevent multi-hour runs on fast chains
	checkpointEvery   = 50     // save progress every N batches
	dvnConcurrency    = 5      // lower than live poller (10) to reduce RPC pressure
)

func main() {
	// CLI flags
	days := flag.Int("days", 7, "target backfill depth in days")
	maxDays := flag.Int("max-days", 30, "maximum backfill depth safety cap")
	chainsFilter := flag.String("chains", "", "comma-separated chain names (default: all)")
	concurrency := flag.Int("concurrency", 3, "max concurrent chains")
	fresh := flag.Bool("fresh", false, "ignore existing checkpoints")
	dryRun := flag.Bool("dry-run", false, "print plan only, don't execute")
	flag.Parse()

	if *days > *maxDays {
		*days = *maxDays
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	fmt.Fprintln(os.Stderr, "DVN Pathway Health — Smart Backfill")
	logger.Info("starting smart backfill",
		"days", *days, "max_days", *maxDays, "dry_run", *dryRun)

	// Context with graceful shutdown
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// PostgreSQL
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://dvn:dvn_password@localhost:5433/dvn_health?sslmode=disable"
	}
	db, err := dbquery.OpenDB(dbURL)
	if err != nil {
		logger.Error("failed to connect to PostgreSQL", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	// Redis (for checkpointing only — no stream publishing)
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://:dvn_redis_password@localhost:6380"
	}
	redisOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		logger.Error("failed to parse REDIS_URL", "error", err)
		os.Exit(1)
	}
	redisClient := redis.NewClient(redisOpts)
	defer redisClient.Close()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		logger.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}

	cpStore := checkpoint.NewStore(redisClient, logger)
	writer := dbwriter.NewWriter(db, logger)

	// Load chain configs from chains.json
	chainsPath := os.Getenv("CHAINS_CONFIG")
	if chainsPath == "" {
		chainsPath = chain.DefaultChainsPath
	}

	chains, err := chain.LoadChains(chainsPath)
	if err != nil {
		logger.Error("failed to load chain config", "error", err)
		os.Exit(1)
	}
	if *chainsFilter != "" {
		chains = filterChains(chains, *chainsFilter)
	}
	if len(chains) == 0 {
		logger.Error("no chains configured — set at least one RPC URL env var")
		os.Exit(1)
	}
	for _, cfg := range chains {
		logger.Info("chain configured",
			"chain", cfg.Name, "eid", cfg.EID,
			"block_time", cfg.BlockTime,
			"confirm_depth", cfg.ConfirmationDepth,
		)
	}

	// Plan each chain's backfill
	plans := make([]*backfillPlan, 0, len(chains))
	for _, cfg := range chains {
		plan, err := planChain(ctx, cfg, db, cpStore, *days, *fresh, logger)
		if err != nil {
			logger.Error("failed to plan backfill", "chain", cfg.Name, "error", err)
			continue
		}
		if plan != nil {
			plans = append(plans, plan)
		}
	}

	if len(plans) == 0 {
		logger.Info("nothing to backfill — all chains already covered")
		return
	}

	// Print plan
	for _, p := range plans {
		logger.Info("backfill plan",
			"chain", p.config.Name,
			"from_block", p.fromBlock,
			"to_block", p.toBlock,
			"total_blocks", p.toBlock-p.fromBlock,
			"estimated_batches", (p.toBlock-p.fromBlock)/batchBlocks+1,
			"auto_capped", p.autoCapped,
		)
	}

	if *dryRun {
		logger.Info("dry run — exiting without backfilling")
		return
	}

	// Execute with concurrency limiter
	g, gCtx := errgroup.WithContext(ctx)
	g.SetLimit(*concurrency)

	for _, plan := range plans {
		p := plan
		g.Go(func() error {
			count, err := executeBackfill(gCtx, p, writer, cpStore, logger)
			if err != nil {
				logger.Error("backfill failed", "chain", p.config.Name, "error", err)
				return nil // don't cancel other chains
			}
			logger.Info("chain backfill complete",
				"chain", p.config.Name, "events", count)
			return nil
		})
	}
	_ = g.Wait()

	logger.Info("smart backfill complete")
}

// ── Planning ────────────────────────────────────────────────

type backfillPlan struct {
	config     chain.ChainConfig
	client     *ethclient.Client
	fromBlock  uint64
	toBlock    uint64
	autoCapped bool
}

func planChain(
	ctx context.Context,
	cfg chain.ChainConfig,
	db *sql.DB,
	cpStore *checkpoint.Store,
	days int,
	fresh bool,
	logger *slog.Logger,
) (*backfillPlan, error) {
	chainLog := logger.With("chain", cfg.Name, "chain_id", cfg.ChainID)

	client, err := ethclient.DialContext(ctx, cfg.RPCURL)
	if err != nil {
		return nil, fmt.Errorf("connect to RPC: %w", err)
	}

	// 1. Get head block
	head, err := client.BlockNumber(ctx)
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("get head block: %w", err)
	}

	safeHead := head - cfg.ConfirmationDepth
	if head < cfg.ConfirmationDepth {
		client.Close()
		chainLog.Warn("chain too young for backfill", "head", head)
		return nil, nil
	}

	// 2. Calculate target floor based on days
	blocksPerSecond := 1.0 / cfg.BlockTime.Seconds()
	blocksForDays := uint64(blocksPerSecond * float64(days*86400))
	targetFloor := safeHead - blocksForDays
	if targetFloor > safeHead { // underflow
		targetFloor = 0
	}

	// 3. Auto-cap based on maxBatches
	autoCapped := false
	maxBlocks := uint64(maxBatches) * batchBlocks
	if safeHead-targetFloor > maxBlocks {
		targetFloor = safeHead - maxBlocks
		autoCapped = true
		cappedDays := float64(maxBlocks) / blocksPerSecond / 86400
		chainLog.Info("auto-capped backfill depth",
			"max_batches", maxBatches,
			"capped_days", fmt.Sprintf("%.1f", cappedDays),
		)
	}

	// 4. Check DB boundary (existing data)
	boundary, err := dbquery.GetChainBoundary(ctx, db, cfg.ChainID)
	if err != nil {
		chainLog.Warn("failed to query DB boundary, proceeding without", "error", err)
	}

	fromBlock := targetFloor

	if boundary != nil {
		chainLog.Info("existing data found",
			"min_block", boundary.MinBlock,
			"event_count", boundary.EventCount,
		)
		// If DB already has data deeper than our target, skip
		if boundary.MinBlock <= targetFloor {
			chainLog.Info("already backfilled deep enough, skipping")
			client.Close()
			return nil, nil
		}
		// Fill the gap: scan from target floor up to existing data
		// The batch writer handles dedup via ON CONFLICT DO NOTHING
	}

	// 5. Check checkpoint (resume interrupted backfill)
	if !fresh {
		progress, err := cpStore.GetBackfill(ctx, cfg.ChainID)
		if err != nil {
			chainLog.Warn("failed to load backfill checkpoint", "error", err)
		}
		if progress != nil && progress.CurrentBlock > fromBlock {
			chainLog.Info("resuming from checkpoint",
				"checkpoint_block", progress.CurrentBlock,
				"original_start", fromBlock,
			)
			fromBlock = progress.CurrentBlock + 1
		}
	}

	if fromBlock >= safeHead {
		chainLog.Info("nothing to backfill — range is empty")
		client.Close()
		return nil, nil
	}

	return &backfillPlan{
		config:     cfg,
		client:     client,
		fromBlock:  fromBlock,
		toBlock:    safeHead,
		autoCapped: autoCapped,
	}, nil
}

// ── Execution ───────────────────────────────────────────────

func executeBackfill(
	ctx context.Context,
	plan *backfillPlan,
	writer *dbwriter.Writer,
	cpStore *checkpoint.Store,
	logger *slog.Logger,
) (int, error) {
	defer plan.client.Close()

	cfg := plan.config
	chainLog := logger.With("chain", cfg.Name, "chain_id", cfg.ChainID)
	endpointAddr := common.HexToAddress(cfg.EndpointV2Address)

	totalBlocks := plan.toBlock - plan.fromBlock
	totalEvents := 0
	batchCount := 0

	progress := &checkpoint.BackfillProgress{
		ChainID:    cfg.ChainID,
		StartBlock: plan.fromBlock,
		TargetBlock: plan.toBlock,
	}

	chainLog.Info("backfill starting",
		"from_block", plan.fromBlock,
		"to_block", plan.toBlock,
		"total_blocks", totalBlocks,
		"estimated_batches", totalBlocks/batchBlocks+1,
	)

	for from := plan.fromBlock; from <= plan.toBlock; from += batchBlocks {
		// Check for cancellation
		if ctx.Err() != nil {
			chainLog.Info("backfill interrupted, saving checkpoint")
			saveProgress(ctx, cpStore, progress, chainLog)
			return totalEvents, ctx.Err()
		}

		to := from + batchBlocks - 1
		if to > plan.toBlock {
			to = plan.toBlock
		}

		// 1. Fetch logs
		events, logs, err := fetchAndParseBatch(ctx, plan.client, endpointAddr, from, to, cfg.ChainID, chainLog)
		if err != nil {
			chainLog.Warn("batch failed, retrying after backoff",
				"from", from, "to", to, "error", err)
			time.Sleep(rateDelay * 5)

			// Retry once
			events, logs, err = fetchAndParseBatch(ctx, plan.client, endpointAddr, from, to, cfg.ChainID, chainLog)
			if err != nil {
				chainLog.Warn("batch failed twice, skipping",
					"from", from, "to", to, "error", err)
				time.Sleep(rateDelay * 5)
				continue
			}
		}

		// 2. Resolve DVN addresses for PacketVerified events
		if len(logs) > 0 {
			txSenders := chain.ResolveTxSenders(ctx, plan.client, cfg.ChainID, logs, dvnConcurrency, chainLog)
			for _, event := range events {
				if event.EventType == evtypes.EventPacketVerified {
					if sender, ok := txSenders[event.TxHash]; ok {
						event.DVNAddress = sender
					}
				}
			}
		}

		// 3. Write to PostgreSQL (not Redis)
		if len(events) > 0 {
			inserted, err := writer.WriteBatch(ctx, events)
			if err != nil {
				chainLog.Warn("DB write failed", "from", from, "to", to, "error", err)
			}
			totalEvents += inserted
		}

		// 4. Update progress
		batchCount++
		progress.CurrentBlock = to
		progress.EventCount = totalEvents
		progress.BatchCount = batchCount

		// 5. Checkpoint every N batches
		if batchCount%checkpointEvery == 0 {
			saveProgress(ctx, cpStore, progress, chainLog)
		}

		// Log progress periodically
		pct := float64(to-plan.fromBlock) / float64(totalBlocks) * 100
		if len(events) > 0 || batchCount%500 == 0 {
			chainLog.Info("progress",
				"from", from, "to", to,
				"batch_events", len(events),
				"total_events", totalEvents,
				"progress", fmt.Sprintf("%.1f%%", pct),
			)
		}

		time.Sleep(rateDelay)
	}

	// Final checkpoint save
	saveProgress(ctx, cpStore, progress, chainLog)
	chainLog.Info("backfill complete",
		"total_events", totalEvents,
		"total_batches", batchCount,
	)
	return totalEvents, nil
}

func fetchAndParseBatch(
	ctx context.Context,
	client *ethclient.Client,
	endpoint common.Address,
	from, to uint64,
	chainID int,
	logger *slog.Logger,
) ([]*evtypes.ChainEvent, []ethtypes.Log, error) {
	query := ethereum.FilterQuery{
		FromBlock: new(big.Int).SetUint64(from),
		ToBlock:   new(big.Int).SetUint64(to),
		Addresses: []common.Address{endpoint},
		Topics: [][]common.Hash{
			{chain.PacketSentSig, chain.PacketVerifiedSig, chain.PacketDeliveredSig},
		},
	}

	logs, err := client.FilterLogs(ctx, query)
	if err != nil {
		return nil, nil, fmt.Errorf("filter logs [%d,%d]: %w", from, to, err)
	}

	if len(logs) == 0 {
		return nil, nil, nil
	}

	// Fetch block timestamps for blocks that contain events
	blockTimestamps := make(map[uint64]uint64)
	for _, log := range logs {
		if _, ok := blockTimestamps[log.BlockNumber]; !ok {
			header, err := client.HeaderByNumber(ctx, new(big.Int).SetUint64(log.BlockNumber))
			if err != nil {
				logger.Warn("failed to get block timestamp",
					"block", log.BlockNumber, "error", err)
				blockTimestamps[log.BlockNumber] = 0
			} else {
				blockTimestamps[log.BlockNumber] = header.Time
			}
		}
	}

	var events []*evtypes.ChainEvent
	for _, log := range logs {
		event, err := chain.ParseEvent(log, chainID, blockTimestamps[log.BlockNumber])
		if err != nil {
			logger.Warn("failed to parse event, skipping",
				"tx", log.TxHash.Hex(), "log_index", log.Index, "error", err)
			continue
		}
		if event != nil {
			events = append(events, event)
		}
	}

	return events, logs, nil
}

func saveProgress(ctx context.Context, cpStore *checkpoint.Store, progress *checkpoint.BackfillProgress, logger *slog.Logger) {
	saveCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := cpStore.SaveBackfill(saveCtx, progress); err != nil {
		logger.Error("failed to save backfill checkpoint", "error", err)
	}
	_ = ctx // ensure we don't use the potentially cancelled ctx for saving
}

// ── Chain config ────────────────────────────────────────────

func filterChains(chains []chain.ChainConfig, filter string) []chain.ChainConfig {
	names := make(map[string]bool)
	for _, name := range strings.Split(filter, ",") {
		trimmed := strings.TrimSpace(name)
		if trimmed != "" {
			names[strings.ToLower(trimmed)] = true
		}
	}

	var filtered []chain.ChainConfig
	for _, c := range chains {
		if names[strings.ToLower(c.Name)] {
			filtered = append(filtered, c)
		}
	}
	return filtered
}
