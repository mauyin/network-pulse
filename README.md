# Network Pulse — DVN Pathway Health Service

A real-time monitoring service for DVN (Decentralized Verifier Network) performance across LayerZero V2 cross-chain pathways. Tracks message lifecycle (Sent → Verified → Delivered), detects anomalies, scores DVN reliability, and audits OApp security configurations.

**No competing product exists** — this fills a verified gap in the LayerZero ecosystem.

## Architecture

```
Chain RPCs (Ethereum, Arbitrum, Optimism, Polygon, BSC, Base, Mantle)
         │
         ▼
┌─────────────────────┐
│   Go Poller Service  │  1 goroutine/chain, circuit breaker,
│                      │  adaptive polling, confirmation depth
└─────────┬───────────┘
          │ Redis Streams
          ▼
┌─────────────────────┐     ┌─────────────────┐
│ TypeScript API       │────▶│  PostgreSQL 18   │
│                      │     │                  │
│ • Correlation Engine │     └─────────────────┘
│ • Analytics (p50/95) │
│ • Anomaly Detection  │     ┌─────────────────┐
│ • Config Auditor     │────▶│  React Dashboard │
│ • REST + WebSocket   │     │  (Vite + TW CSS) │
└──────────────────────┘     └─────────────────┘
```

## Key Features

| Feature | Description |
|---------|-------------|
| **Network Pulse** | Real-time pathway health grid with color-coded scores |
| **DVN Leaderboard** | First-ever DVN performance ranking (latency, reliability, coverage) |
| **DVN Compare** | Side-by-side DVN comparison across metrics and pathways |
| **DVN Registry** | Full DVN provider list with chain coverage breakdown |
| **DVN Reputation** | Rolling 7/30/90-day reputation scores per DVN |
| **Config Auditor** | Security scoring for OApp DVN configurations via on-chain RPC calls |
| **Message Timeline** | Animated cross-chain message journey visualization |
| **Message Search** | Search messages by GUID, sender address, or pathway |
| **Network Graph** | Visual network topology of active cross-chain pathways |
| **Pathway Detail** | Drill-down pathway view with latency timeseries charts |
| **Anomaly Detection** | Z-score-based latency anomaly detection with cold start guards |
| **Real-time Alerts** | WebSocket-powered alert toasts for stuck messages and DVN anomalies |

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Go 1.25+
- Node.js 22+
- At least one EVM RPC URL (Alchemy, Infura, etc.)

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — add your RPC URLs
```

### 2. Run the demo

```bash
just demo
```

This starts PostgreSQL, Redis, runs the historical backfill (7 days), then starts all services. Dashboard opens at http://localhost:5173.

### 3. Development mode

```bash
# Start infrastructure
just infra

# In separate terminals:
just dev-poller      # Go poller with hot reload (air)
just dev-api         # TypeScript API with hot reload (tsx)
just dev-dashboard   # React dashboard with HMR (vite)
```

## Project Structure

```
network-pulse/
├── poller/              # Go — Chain event indexer
│   ├── cmd/poller/      # Live polling service
│   ├── cmd/backfill/    # Historical backfill script
│   └── internal/        # chain, breaker, checkpoint, publisher
├── api/                 # TypeScript — REST API + analytics
│   ├── src/consumer/    # Redis Streams consumer
│   ├── src/correlation/ # Cross-chain event matching
│   ├── src/analytics/   # Latency stats, anomaly detection, health scoring
│   ├── src/audit/       # Config auditor (ethers.js → on-chain)
│   ├── src/routes/      # Fastify REST endpoints
│   └── src/websocket/   # Real-time alert streaming
├── dashboard/           # React — Monitoring UI (8 pages)
│   └── src/pages/       # NetworkPulse, Leaderboard, DVNCompare, Registry,
│                        # Audit, Timeline, Search, NetworkGraph, PathwayDetail
├── schemas/             # JSON Schema event definitions
├── db/                  # PostgreSQL schema + migrations
│   └── migrations/      # Database migration files
├── docs/                # Project documentation
├── scripts/             # Deployment and utility scripts
└── docker-compose.yml   # Full stack orchestration
```

## Design Decisions

### Chain Reorg Handling
Events are only processed N blocks behind the chain head (Ethereum: 12, Arbitrum/Optimism: 64, Polygon: 128, BSC: 15, Base: 64, Mantle: 64). Adds a few minutes of latency but prevents phantom messages from reorged blocks.

### Cross-Chain Event Ordering
`PacketVerified` may arrive before `PacketSent` since different chains are polled at different rates. Unmatched events are buffered in a Redis sorted set, retried every 30 seconds, and expired after 1 hour. Buffer capped at 10K entries.

### Config Auditor Architecture
The TypeScript API calls `getUlnConfig()` directly via ethers.js, scoring configs on 5 factors: DVN count, required threshold, optional strategy, known DVN usage, and confirmation depth.

### Analytics via Raw SQL
PostgreSQL's built-in `percentile_cont()` and `date_bin()` aren't supported by Prisma's query builder. Analytics queries use `$queryRaw` for these aggregate functions; CRUD operations use Prisma's type-safe client.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check |
| GET | `/pathways` | All pathway health summaries |
| GET | `/pathways/:srcEid/:dstEid/health` | Pathway health + latency + anomaly |
| GET | `/pathways/:srcEid/:dstEid/timeseries` | Latency timeseries for charts |
| GET | `/pathways/:srcEid/:dstEid/dvns` | DVN comparison for a pathway |
| GET | `/dvns/registry` | Full DVN provider list with chain coverage |
| GET | `/dvns/leaderboard` | DVN performance rankings |
| GET | `/dvns/compare` | Side-by-side DVN comparison |
| GET | `/dvns/:address/profile` | DVN metadata |
| GET | `/dvns/:address/reliability` | DVN reliability metrics |
| GET | `/dvns/:address/reputation` | Rolling 7/30/90-day reputation scores |
| GET | `/alerts` | Active/historical alerts |
| GET | `/messages/search` | Search by GUID, sender, or pathway |
| GET | `/messages/:guid/timeline` | Message journey timeline |
| POST | `/audit` | Config security audit |
| WS | `/ws` | Real-time alert stream |

## Testing

```bash
just test-poller         # Go unit tests
just test-api            # TypeScript unit tests
just test-integration    # Full pipeline integration tests
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Chain Indexer | Go, go-ethereum v1.17, gobreaker, go-redis |
| API Server | TypeScript, Fastify, Prisma, ioredis |
| Config Auditor | ethers.js v6 |
| Database | PostgreSQL 18 |
| Message Queue | Redis Streams |
| Dashboard | React 19, Vite, TailwindCSS, TanStack Query, Recharts |
| Task Runner | just |
| Containerization | Docker Compose |

## License

[MIT](LICENSE)
