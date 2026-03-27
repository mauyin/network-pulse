package chain

import (
	"context"
	"log/slog"
	"math/big"
	"sync"

	ethtypes "github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"golang.org/x/sync/errgroup"
)

// ResolveTxSenders fetches the sender (tx.from) for each unique TxHash
// belonging to a PacketVerified log. This identifies which DVN submitted the
// verification proof on-chain.
//
// concurrency controls how many parallel eth_getTransactionByHash calls are made.
// Recommended: 10 for live poller, 5 for backfill (lower RPC pressure).
func ResolveTxSenders(
	ctx context.Context,
	client *ethclient.Client,
	chainID int,
	logs []ethtypes.Log,
	concurrency int,
	logger *slog.Logger,
) map[common.Hash]common.Address {
	// Collect unique tx hashes from PacketVerified logs only
	needed := make(map[common.Hash]struct{})
	for _, log := range logs {
		if len(log.Topics) > 0 && log.Topics[0] == PacketVerifiedSig {
			needed[log.TxHash] = struct{}{}
		}
	}

	if len(needed) == 0 {
		return nil
	}

	senders := make(map[common.Hash]common.Address, len(needed))
	cid := big.NewInt(int64(chainID))
	signer := ethtypes.LatestSignerForChainID(cid)

	g, gCtx := errgroup.WithContext(ctx)
	g.SetLimit(concurrency)
	var mu sync.Mutex

	for txHash := range needed {
		h := txHash
		g.Go(func() error {
			tx, _, err := client.TransactionByHash(gCtx, h)
			if err != nil {
				logger.Warn("failed to fetch tx for DVN address, skipping",
					"tx", h.Hex(), "error", err)
				return nil // skip, don't fail batch
			}

			from, err := ethtypes.Sender(signer, tx)
			if err != nil {
				logger.Warn("failed to recover tx sender, skipping",
					"tx", h.Hex(), "error", err)
				return nil
			}

			mu.Lock()
			senders[h] = from
			mu.Unlock()
			return nil
		})
	}
	_ = g.Wait()

	logger.Debug("resolved DVN addresses from tx senders",
		"requested", len(needed), "resolved", len(senders))

	return senders
}
