package breaker

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"testing"

	"github.com/sony/gobreaker/v2"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestNewCircuitBreaker_Name(t *testing.T) {
	cb := NewCircuitBreaker("ethereum", silentLogger())

	want := "rpc-ethereum"
	if got := cb.Name(); got != want {
		t.Errorf("Name() = %q, want %q", got, want)
	}
}

func TestCircuitBreaker_StartsInClosedState(t *testing.T) {
	cb := NewCircuitBreaker("avalanche", silentLogger())

	if got := cb.State(); got != gobreaker.StateClosed {
		t.Errorf("initial State() = %v, want StateClosed", got)
	}
}

func TestCircuitBreaker_SuccessKeepsClosed(t *testing.T) {
	cb := NewCircuitBreaker("polygon", silentLogger())

	for i := 0; i < 10; i++ {
		_, err := cb.Execute(func() ([]byte, error) {
			return []byte("ok"), nil
		})
		if err != nil {
			t.Fatalf("Execute succeeded but got error on call %d: %v", i, err)
		}
	}

	if got := cb.State(); got != gobreaker.StateClosed {
		t.Errorf("State() after 10 successes = %v, want StateClosed", got)
	}
}

func TestCircuitBreaker_TripsAfter5Failures(t *testing.T) {
	cb := NewCircuitBreaker("arbitrum", silentLogger())

	for i := 0; i < 5; i++ {
		cb.Execute(func() ([]byte, error) {
			return nil, fmt.Errorf("fail")
		})
	}

	if got := cb.State(); got != gobreaker.StateOpen {
		t.Errorf("State() after 5 failures = %v, want StateOpen", got)
	}
}

func TestCircuitBreaker_DoesNotTripBefore5Failures(t *testing.T) {
	cb := NewCircuitBreaker("optimism", silentLogger())

	for i := 0; i < 4; i++ {
		cb.Execute(func() ([]byte, error) {
			return nil, fmt.Errorf("fail")
		})
	}

	if got := cb.State(); got != gobreaker.StateClosed {
		t.Errorf("State() after 4 failures = %v, want StateClosed", got)
	}
}

func TestCircuitBreaker_OpenRejectsRequests(t *testing.T) {
	cb := NewCircuitBreaker("base", silentLogger())

	// Trip the breaker with 5 consecutive failures.
	for i := 0; i < 5; i++ {
		cb.Execute(func() ([]byte, error) {
			return nil, fmt.Errorf("fail")
		})
	}

	// Subsequent calls should be rejected with ErrOpenState.
	_, err := cb.Execute(func() ([]byte, error) {
		return []byte("should not run"), nil
	})
	if err == nil {
		t.Fatal("expected error from open breaker, got nil")
	}
	if !errors.Is(err, gobreaker.ErrOpenState) {
		t.Errorf("error = %v, want gobreaker.ErrOpenState", err)
	}
}
