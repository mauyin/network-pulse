package chain

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// DefaultChainsPath is the default location of chains.json inside Docker containers.
// Local dev overrides this via the CHAINS_CONFIG environment variable.
const DefaultChainsPath = "/chains.json"

// ChainConfig holds per-chain configuration for the poller.
type ChainConfig struct {
	Name              string
	ChainID           int
	EID               uint32 // LayerZero endpoint ID
	RPCURL            string
	FallbackRPCURL    string // optional 2nd RPC for failover
	EndpointV2Address string
	BlockTime         time.Duration
	ConfirmationDepth uint64
	MaxBlockRange     uint64 // max blocks per eth_getLogs request
}

// unexported JSON-mapping structs
type chainsFile struct {
	Polled []chainEntry `json:"polled"`
}

type chainEntry struct {
	Name              string `json:"name"`
	ChainID           int    `json:"chainId"`
	EID               uint32 `json:"eid"`
	EndpointV2        string `json:"endpointV2"`
	RPCEnv            string `json:"rpcEnv"`
	BlockTimeMs       int    `json:"blockTimeMs"`
	ConfirmationDepth uint64 `json:"confirmationDepth"`
	MaxBlockRange     uint64 `json:"maxBlockRange"`
}

// LoadChains reads chains.json from the given path, looks up RPC URLs
// from environment variables, and returns only chains with a configured
// RPC URL. Fallback RPC is derived by convention: {rpcEnv}_FALLBACK.
func LoadChains(path string) ([]ChainConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read chains config: %w", err)
	}

	var file chainsFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("parse chains config: %w", err)
	}

	var configs []ChainConfig
	for _, entry := range file.Polled {
		rpcURL := os.Getenv(entry.RPCEnv)
		if rpcURL == "" {
			continue
		}

		cfg := ChainConfig{
			Name:              entry.Name,
			ChainID:           entry.ChainID,
			EID:               entry.EID,
			EndpointV2Address: entry.EndpointV2,
			BlockTime:         time.Duration(entry.BlockTimeMs) * time.Millisecond,
			ConfirmationDepth: entry.ConfirmationDepth,
			MaxBlockRange:     entry.MaxBlockRange,
			RPCURL:            rpcURL,
		}

		if fbURL := os.Getenv(entry.RPCEnv + "_FALLBACK"); fbURL != "" {
			cfg.FallbackRPCURL = fbURL
		}

		configs = append(configs, cfg)
	}
	return configs, nil
}
