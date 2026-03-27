package chain

import (
	"os"
	"testing"
	"time"
)

const testChainsJSON = `{
  "polled": [
    {
      "name": "Ethereum",
      "chainId": 1,
      "eid": 30101,
      "endpointV2": "0x1a44076050125825900e736c501f859c50fE728c",
      "rpcEnv": "ETH_RPC_URL",
      "blockTimeMs": 12000,
      "confirmationDepth": 12,
      "maxBlockRange": 10,
      "explorerUrl": "https://etherscan.io"
    },
    {
      "name": "Arbitrum",
      "chainId": 42161,
      "eid": 30110,
      "endpointV2": "0x1a44076050125825900e736c501f859c50fE728c",
      "rpcEnv": "ARB_RPC_URL",
      "blockTimeMs": 250,
      "confirmationDepth": 64,
      "maxBlockRange": 100,
      "explorerUrl": "https://arbiscan.io"
    }
  ]
}`

func writeTempChainsFile(t *testing.T, content string) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "chains-*.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString(content); err != nil {
		t.Fatal(err)
	}
	f.Close()
	return f.Name()
}

func TestLoadChains_NoEnvVars(t *testing.T) {
	path := writeTempChainsFile(t, testChainsJSON)

	chains, err := LoadChains(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(chains) != 0 {
		t.Fatalf("expected 0 chains without env vars, got %d", len(chains))
	}
}

func TestLoadChains_WithRPC(t *testing.T) {
	path := writeTempChainsFile(t, testChainsJSON)
	t.Setenv("ETH_RPC_URL", "https://eth.example.com")

	chains, err := LoadChains(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(chains) != 1 {
		t.Fatalf("expected 1 chain, got %d", len(chains))
	}

	eth := chains[0]
	if eth.Name != "Ethereum" {
		t.Errorf("expected name Ethereum, got %s", eth.Name)
	}
	if eth.ChainID != 1 {
		t.Errorf("expected chainID 1, got %d", eth.ChainID)
	}
	if eth.EID != 30101 {
		t.Errorf("expected EID 30101, got %d", eth.EID)
	}
	if eth.BlockTime != 12*time.Second {
		t.Errorf("expected 12s block time, got %v", eth.BlockTime)
	}
	if eth.ConfirmationDepth != 12 {
		t.Errorf("expected confirmation depth 12, got %d", eth.ConfirmationDepth)
	}
	if eth.MaxBlockRange != 10 {
		t.Errorf("expected max block range 10, got %d", eth.MaxBlockRange)
	}
	if eth.RPCURL != "https://eth.example.com" {
		t.Errorf("expected RPC URL https://eth.example.com, got %s", eth.RPCURL)
	}
	if eth.FallbackRPCURL != "" {
		t.Errorf("expected empty fallback, got %s", eth.FallbackRPCURL)
	}
}

func TestLoadChains_Arbitrum(t *testing.T) {
	path := writeTempChainsFile(t, testChainsJSON)
	t.Setenv("ARB_RPC_URL", "https://arb.example.com")

	chains, err := LoadChains(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(chains) != 1 {
		t.Fatalf("expected 1 chain, got %d", len(chains))
	}

	arb := chains[0]
	if arb.Name != "Arbitrum" {
		t.Errorf("expected name Arbitrum, got %s", arb.Name)
	}
	if arb.ChainID != 42161 {
		t.Errorf("expected chainID 42161, got %d", arb.ChainID)
	}
	if arb.EID != 30110 {
		t.Errorf("expected EID 30110, got %d", arb.EID)
	}
	if arb.BlockTime != 250*time.Millisecond {
		t.Errorf("expected 250ms block time, got %v", arb.BlockTime)
	}
	if arb.MaxBlockRange != 100 {
		t.Errorf("expected max block range 100, got %d", arb.MaxBlockRange)
	}
}

func TestLoadChains_Fallback(t *testing.T) {
	path := writeTempChainsFile(t, testChainsJSON)
	t.Setenv("ETH_RPC_URL", "https://eth.example.com")
	t.Setenv("ETH_RPC_URL_FALLBACK", "https://eth-fallback.example.com")

	chains, err := LoadChains(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(chains) != 1 {
		t.Fatalf("expected 1 chain, got %d", len(chains))
	}
	if chains[0].FallbackRPCURL != "https://eth-fallback.example.com" {
		t.Errorf("expected fallback URL, got %s", chains[0].FallbackRPCURL)
	}
}

func TestLoadChains_BadPath(t *testing.T) {
	_, err := LoadChains("/nonexistent/chains.json")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestLoadChains_BadJSON(t *testing.T) {
	path := writeTempChainsFile(t, `{invalid json}`)

	_, err := LoadChains(path)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}
