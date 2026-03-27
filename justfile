# DVN Pathway Health Service — Task Runner

set dotenv-load

# Default: show available targets
default:
    @just --list

# ─── Development ──────────────────────────────────────────────

# Start all infrastructure (postgres, redis) in background
infra:
    docker compose up -d postgres redis

# Start Go poller in dev mode with hot reload
dev-poller:
    cd poller && air

# Start TS API in dev mode with hot reload
dev-api:
    cd api && PORT=${API_PORT:-3002} npx tsx watch src/index.ts

# Start React dashboard in dev mode
dev-dashboard:
    cd dashboard && npx vite

# Start everything in dev mode (infrastructure + all services)
dev: infra
    @echo "Starting services... (use Ctrl+C to stop)"
    @echo "  Poller:    just dev-poller"
    @echo "  API:       just dev-api"
    @echo "  Dashboard: just dev-dashboard"

# ─── Demo ─────────────────────────────────────────────────────

# Full demo: start stack, run backfill, open dashboard
demo: infra
    @echo "Waiting for infrastructure..."
    @sleep 3
    @echo "Running backfill (this may take a few minutes)..."
    cd poller && go run cmd/backfill/main.go
    @echo "Starting services..."
    docker compose up -d poller api dashboard
    @echo "Dashboard available at http://localhost:5173"
    @open http://localhost:5173 || true

# ─── Code Generation ──────────────────────────────────────────

# Generate Go structs + TS interfaces from JSON schemas
gen-types:
    @echo "Generating types from JSON schemas..."
    npx quicktype --src-lang schema schemas/packet-sent.json schemas/packet-verified.json schemas/packet-delivered.json \
        --lang go --top-level ChainEvent --out schemas/generated/events.go --package types
    npx quicktype --src-lang schema schemas/packet-sent.json schemas/packet-verified.json schemas/packet-delivered.json \
        --lang typescript --top-level ChainEvent --out schemas/generated/events.ts

# ─── Testing ──────────────────────────────────────────────────

# Run Go poller tests
test-poller:
    cd poller && go test ./... -v

# Run TS API tests
test-api:
    cd api && npx vitest run

# Run integration tests (requires infrastructure)
test-integration: infra
    cd api && npx vitest run --config vitest.integration.config.ts

# Run all tests
test: test-poller test-api

# Run chaos tests
test-chaos: infra
    @echo "Chaos tests not yet implemented"

# ─── Build ────────────────────────────────────────────────────

# Build Go poller binary
build-poller:
    cd poller && go build -o bin/poller cmd/poller/main.go

# Build TS API
build-api:
    cd api && npx tsc

# Build React dashboard
build-dashboard:
    cd dashboard && npx vite build

# Build all Docker images
build:
    docker compose build

# ─── Lint ─────────────────────────────────────────────────────

# Lint Go code
lint-poller:
    cd poller && golangci-lint run

# Lint TS code
lint-api:
    cd api && npx eslint src/

# Lint all
lint: lint-poller lint-api

# ─── Database ─────────────────────────────────────────────────

# Smart backfill: chain_events directly to PostgreSQL (default: 7 days, all chains)
backfill days="7" chains="": infra
    cd poller && go run ./cmd/backfill --days {{days}} {{ if chains != "" { "--chains " + chains } else { "" } }}

# Preview what would be backfilled without executing
backfill-dry-run days="7" chains="": infra
    cd poller && go run ./cmd/backfill --days {{days}} {{ if chains != "" { "--chains " + chains } else { "" } }} --dry-run

# Batch correlate: chain_events → messages + dvn_verifications
correlate:
    cd api && npx tsx src/correlation/batch-correlator.ts

# Full backfill workflow: ingest chain_events + correlate into messages
backfill-full days="7" chains="": infra
    just backfill {{days}} {{chains}}
    just correlate

# Run dedup migration (safe to run on live system)
db-migrate:
    @echo "Running dedup migration..."
    docker compose exec -T postgres psql -U dvn -d dvn_health < db/migrations/001_add_dedup_constraints.sql

# Reset database (destructive!)
db-reset:
    docker compose down -v postgres
    docker compose up -d postgres
    @echo "Waiting for postgres..."
    @sleep 5
    @echo "Database reset complete"

# ─── Cleanup ──────────────────────────────────────────────────

# Stop all services
down:
    docker compose down

# Stop all and remove volumes (destructive!)
clean:
    docker compose down -v
