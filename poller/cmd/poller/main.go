package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"

	"github.com/mauyin/network-pulse/poller/internal/breaker"
	"github.com/mauyin/network-pulse/poller/internal/chain"
	"github.com/mauyin/network-pulse/poller/internal/checkpoint"
	"github.com/mauyin/network-pulse/poller/internal/publisher"
)

func main() {
	// Structured JSON logging
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	logger.Info("starting DVN health poller")

	// Redis connection
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://:dvn_redis_password@localhost:6379"
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		logger.Error("failed to parse REDIS_URL", "error", err)
		os.Exit(1)
	}

	redisClient := redis.NewClient(opts)
	defer redisClient.Close()

	// Verify Redis connection
	if err := redisClient.Ping(context.Background()).Err(); err != nil {
		logger.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	logger.Info("connected to Redis")

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
	if len(chains) == 0 {
		logger.Error("no chains configured — set at least one RPC URL env var")
		os.Exit(1)
	}
	for _, cfg := range chains {
		logger.Info("chain configured",
			"chain", cfg.Name, "eid", cfg.EID,
			"block_time", cfg.BlockTime,
			"confirm_depth", cfg.ConfirmationDepth,
			"has_fallback", cfg.FallbackRPCURL != "",
		)
	}

	// Shared services
	pub := publisher.NewRedisPublisher(redisClient, logger)
	cpStore := checkpoint.NewStore(redisClient, logger)

	// Graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		logger.Info("received signal, shutting down", "signal", sig)
		cancel()
	}()

	// Health endpoint for Docker health checks
	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"ok"}`))
		})
		srv := &http.Server{Addr: ":8080", Handler: mux}
		go func() {
			<-ctx.Done()
			srv.Close()
		}()
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			logger.Error("health server failed", "error", err)
		}
	}()
	logger.Info("health endpoint listening", "addr", ":8080")

	// Start one goroutine per chain
	var wg sync.WaitGroup
	for _, cfg := range chains {
		wg.Add(1)
		go func(c chain.ChainConfig) {
			defer wg.Done()

			client, err := ethclient.DialContext(ctx, c.RPCURL)
			if err != nil {
				logger.Error("failed to connect to primary RPC",
					"chain", c.Name,
					"error", err,
				)
				return
			}
			defer client.Close()

			// Optional fallback RPC client
			var fallback *ethclient.Client
			if c.FallbackRPCURL != "" {
				fb, err := ethclient.DialContext(ctx, c.FallbackRPCURL)
				if err != nil {
					logger.Warn("failed to connect to fallback RPC, continuing with primary only",
						"chain", c.Name,
						"error", err,
					)
				} else {
					fallback = fb
					defer fb.Close()
					logger.Info("fallback RPC connected", "chain", c.Name)
				}
			}

			cb := breaker.NewCircuitBreaker(c.Name, logger)
			poller := chain.NewPoller(c, client, pub, cpStore, cb, logger)
			if fallback != nil {
				poller.SetFallbackClient(fallback)
			}
			poller.Run(ctx)
		}(cfg)
	}

	wg.Wait()
	logger.Info("all pollers stopped, exiting")
}

func init() {
	// Ensure required tooling is clear
	fmt.Fprintln(os.Stderr, "DVN Pathway Health — Go Poller Service")
}
