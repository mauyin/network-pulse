# Network Pulse — Roadmap

## v1.0 — Foundation (Shipped)

The core monitoring platform is live at [pulse.kyd3n.com](https://pulse.kyd3n.com).

- [x] Go chain poller — 7 EVM chains, concurrent goroutines, circuit breaker, adaptive polling
- [x] Redis Streams event pipeline with consumer group processing
- [x] Cross-chain correlation engine with out-of-order event handling
- [x] Health scoring — 3-dimension composite (availability, performance, consistency)
- [x] Anomaly detection — Z-score based, self-calibrating per pathway
- [x] DVN leaderboard — first-ever DVN performance ranking
- [x] DVN reputation scoring — rolling 7/30/90-day windows
- [x] Config auditor — 5-factor OApp security scoring via on-chain RPC
- [x] Message timeline — cross-chain message journey visualization
- [x] WebSocket real-time alerts
- [x] Historical backfill tool
- [x] Docker Compose deployment
- [x] Production deploy with Caddy + TLS

---

## v1.1 — Trust & Polish

Make the data verifiable and the UI ecosystem-native. Users should be able to verify every metric and trust the data they see.

### Data Transparency
- [ ] Explorer links — clickable tx hashes linking to Etherscan, Arbiscan, etc.
- [ ] Health score breakdown — show the math (availability %, performance %, consistency %) with raw values
- [ ] Data freshness indicators — "Updated 2 min ago" on all cached data
- [ ] Audit trail — persist raw events to `chain_events` table for independent verification

### Ecosystem-Native UI
- [ ] Chain icons from TrustWallet CDN with colored-circle fallback
- [ ] Design tokens — chain brand colors, Inter + JetBrains Mono fonts
- [ ] Status-grouped pathway cards — critical expanded, degraded medium, healthy compact
- [ ] Notification badge replacing toast stack — bell icon with alert drawer

### Responsive & Mobile
- [ ] Hamburger menu for mobile navigation
- [ ] Responsive pathway cards and tables
- [ ] Content overflow fixes for small screens

### Activate Disabled Pages
- [ ] DVN Leaderboard page
- [ ] DVN Compare page
- [ ] Config Audit page
- [ ] Message Search page
- [ ] Message Timeline page
- [ ] Network Graph page

---

## v2.0 — Differentiation

Features that make Network Pulse indispensable to LayerZero builders. Turn monitoring data into actionable decisions.

### OApp Security Configurator
Interactive DVN configuration builder. Developers select source and destination chains, see all available DVNs with live performance data, drag-and-drop to build a required/optional DVN config, and get a real-time security score with estimated verification latency. Outputs a ready-to-use `setSendLibrary` config snippet.

### Executor Monitoring
Track the second half of message delivery (Verified → Delivered). Index executor activity, build an executor leaderboard (speed, reliability, gas efficiency), and pinpoint whether the DVN or executor is the bottleneck for slow messages.

### DVN Concentration Risk Dashboard
Ecosystem-wide systemic risk view. Heatmap showing DVN dependency concentration per pathway — "85% of OApps on ETH→ARB use the same 2 DVNs." Diversity scores per chain pair to surface single points of failure.

### Alerts-as-a-Service
Subscribe to specific pathways or DVNs and receive notifications when anomalies occur. Delivery channels: Telegram bot, Discord webhook, Slack integration, custom webhooks. Configurable thresholds and alert types.

### Chain Expansion
Expand from 7 to 15+ monitored chains. Priority additions: Avalanche, Linea, Scroll, zkSync Era, Fantom, Gnosis, Celo, Moonbeam.

---

## v3.0 — Platform

Evolve from a monitoring tool into the operational intelligence platform for LayerZero V2.

### OApp Registry & Comparison
Index all OApps using LayerZero on monitored chains. Show which DVNs each OApp uses, their message volume and frequency, and enable comparison — "3 of 5 lending protocols on this pathway use DVN X, you don't."

### Cross-Chain Cost Analytics
DVN verification has real costs. Show cost per verification per DVN per pathway from on-chain gas data. Cost-to-security ratio analysis — find DVNs that are both cheap and reliable. Historical gas trends per pathway.

### Historical Trend Analysis
Long-term DVN performance trends. Weekly/monthly reliability reports. DVN reputation evolution over time. Seasonal pattern detection (weekend vs weekday, gas spike correlation).

### Message Simulator
"What happens if I send a message from Ethereum to Base right now?" Predicted verification time from historical data, which DVNs would verify, estimated cost, and current pathway health.

### Incident Timeline
Searchable historical view of DVN failures, latency spikes, and chain outages. Root cause tags (chain RPC issue, DVN downtime, gas spike). Useful for post-mortems and due diligence when selecting DVNs.

### Community DVN Reviews
Developer ratings and written feedback for DVN providers. Verified reviews from OApp operators. Complements quantitative metrics with qualitative experience.

### Embeddable SDK
JavaScript SDK that lets other protocols embed DVN health widgets in their own UIs. Pre-built components: pathway health badge, DVN status indicator, mini leaderboard.

---

## Contributing

Network Pulse is open source. If you're interested in contributing to any roadmap item, open an issue on [GitHub](https://github.com/mauyin/network-pulse) to discuss the approach before submitting a PR.
