package breaker

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/sony/gobreaker/v2"
)

// NewCircuitBreaker creates a circuit breaker for an RPC endpoint.
//
// State machine:
//   ┌────────┐  5 failures/30s  ┌────────┐  60s cooldown  ┌───────────┐
//   │ Closed │ ────────────────▶ │  Open  │ ──────────────▶ │ Half-Open │
//   └────────┘                   └────────┘                 └───────────┘
//        ▲                                                       │
//        │              success                                  │
//        └───────────────────────────────────────────────────────┘
//                                  │
//                                  │ failure
//                                  ▼
//                             ┌────────┐
//                             │  Open  │
//                             └────────┘
func NewCircuitBreaker(chainName string, logger *slog.Logger) *gobreaker.CircuitBreaker[[]byte] {
	settings := gobreaker.Settings{
		Name:        fmt.Sprintf("rpc-%s", chainName),
		MaxRequests: 1,                // allow 1 request in half-open state
		Interval:    30 * time.Second, // rolling window for failure count
		Timeout:     60 * time.Second, // time to wait before half-open

		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= 5
		},

		OnStateChange: func(name string, from gobreaker.State, to gobreaker.State) {
			logger.Warn("circuit breaker state change",
				"breaker", name,
				"from", from.String(),
				"to", to.String(),
			)
		},
	}

	return gobreaker.NewCircuitBreaker[[]byte](settings)
}
