/**
 * Factory functions for generating mock data matching all API response types.
 * Each generator produces a single record; scenarios compose them into datasets.
 */

import type {
  PathwayHealth,
  PathwayDetail,
  DVNLeaderboardEntry,
  DVNProvider,
  Alert,
  AuditResult,
  DVNCompareEntry,
  PathwayDvnEntry,
  MessageSearchResult,
  MessageTimeline,
  HealthBreakdown,
} from "../client";

// ── Constants ──────────────────────────────────────────

const CHAIN_EIDS = [30101, 30110, 30111, 30184, 30109, 30106, 30102] as const;

const DVN_REGISTRY: { address: string; name: string; id: string }[] = [
  { address: "0x589dedbd617e0cbcb916a9223f4d1300c294236b", name: "Google Cloud", id: "google-cloud" },
  { address: "0x8ddf05f9a5c488b4973897e278b58895bf87cb24", name: "Polyhedra", id: "polyhedra" },
  { address: "0x2ac038607ead4c5c9eea32b44a4a38f13502f7a4", name: "Animoca Blockdaemon", id: "animoca-blockdaemon" },
  { address: "0xd56e4eab23cb81f43168f9f45211eb027b9ac7cc", name: "LayerZero Labs", id: "layerzero-labs" },
  { address: "0xa59ba433ac34d2927232ece3e12d07510e12aaf6", name: "Nethermind", id: "nethermind" },
  { address: "0x380275805876ff19055ea900cdb2b46a94ecf20d", name: "Stargate", id: "stargate" },
  { address: "0x7fe673201724925b5c477d4e1a4bd3e954688cf5", name: "Horizen Labs", id: "horizen-labs" },
  { address: "0xdd7b5e1db4aafd5c8ec3b764efb8ed265aa5445b", name: "Bware Labs", id: "bware-labs" },
  { address: "0xcd37ca043f8479064e10635020c65ffc005d36f6", name: "USDC (Circle)", id: "usdc-circle" },
  { address: "0x9e059a54699a285714207b43b055483e7808c9c1", name: "Zenrock", id: "zenrock" },
];

// ── Helpers ──────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function randomHex(bytes: number): string {
  return "0x" + Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0"),
  ).join("");
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

// ── Pathway pairs (realistic src→dst) ──────────────

export function generatePathwayPairs(count: number): [number, number][] {
  const pairs: [number, number][] = [];
  const seen = new Set<string>();

  // Generate realistic cross-chain pairs
  for (let i = 0; i < CHAIN_EIDS.length && pairs.length < count; i++) {
    for (let j = 0; j < CHAIN_EIDS.length && pairs.length < count; j++) {
      if (i === j) continue;
      const key = `${CHAIN_EIDS[i]}-${CHAIN_EIDS[j]}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push([CHAIN_EIDS[i], CHAIN_EIDS[j]]);
      }
    }
  }

  return pairs.slice(0, count);
}

// ── Generators ──────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "critical" | "unknown";

export function generateBreakdown(status: HealthStatus): HealthBreakdown {
  const ranges: Record<HealthStatus, [number, number]> = {
    healthy: [80, 100],
    degraded: [45, 79],
    critical: [10, 44],
    unknown: [0, 30],
  };
  const [min, max] = ranges[status];

  const availability = randInt(min, max);
  const performance = randInt(min, max);
  const consistency = randInt(min, max);

  return {
    availability: { value: availability, raw: `${randInt(90, 100)}% delivery rate`, weight: 0.4 },
    performance: { value: performance, raw: `P95 ${rand(20, 180).toFixed(1)}s`, weight: 0.3 },
    consistency: { value: consistency, raw: `σ = ${rand(2, 40).toFixed(1)}s`, weight: 0.3 },
  };
}

export function generatePathwayHealth(
  srcEid: number,
  dstEid: number,
  status: HealthStatus = "healthy",
): PathwayHealth {
  const scoreRanges: Record<HealthStatus, [number, number]> = {
    healthy: [80, 98],
    degraded: [50, 79],
    critical: [12, 49],
    unknown: [0, 0],
  };
  const [min, max] = scoreRanges[status];
  const score = status === "unknown" ? 0 : randInt(min, max);
  const totalMessages = status === "unknown" ? 0 : randInt(50, 8000);
  const deliveryRate = status === "healthy" ? rand(0.92, 1.0) : status === "degraded" ? rand(0.7, 0.92) : rand(0.3, 0.7);

  const delta24h = status === "unknown" ? {
    totalMessages: null,
    avgLatencyS: null,
    availability: null,
    anomalyCount: null,
  } : {
    totalMessages: Number(rand(-15, 25).toFixed(1)),
    avgLatencyS: Number(rand(-20, 30).toFixed(1)),
    availability: Number(rand(-2, 2).toFixed(1)),
    anomalyCount: null, // only meaningful at aggregate level
  };

  return {
    srcEid,
    dstEid,
    score,
    status,
    totalMessages,
    verifiedMessages: Math.floor(totalMessages * rand(0.85, 1.0)),
    deliveredMessages: Math.floor(totalMessages * deliveryRate),
    avgLatencyS: status === "unknown" ? 0 : Number(rand(15, 180).toFixed(1)),
    breakdown: generateBreakdown(status),
    sampleSize: totalMessages,
    windowHours: 24,
    cachedAt: minutesAgo(randInt(1, 15)),
    delta24h,
  };
}

export function generatePathwayDetail(
  srcEid: number,
  dstEid: number,
  status: HealthStatus = "healthy",
): PathwayDetail {
  const base = generatePathwayHealth(srcEid, dstEid, status);
  const p50 = Number(rand(15, 60).toFixed(1));
  const isAnomaly = status === "critical" && Math.random() > 0.5;

  return {
    ...base,
    srcChain: `Chain ${srcEid}`,
    dstChain: `Chain ${dstEid}`,
    latency: {
      p50,
      p95: Number((p50 * rand(1.8, 3.0)).toFixed(1)),
      p99: Number((p50 * rand(3.0, 5.0)).toFixed(1)),
      avg: Number((p50 * rand(1.1, 1.5)).toFixed(1)),
      count: randInt(100, 5000),
    },
    anomaly: {
      isAnomaly,
      zScore: Number(isAnomaly ? rand(2.5, 5.0).toFixed(2) : rand(-1.5, 1.5).toFixed(2)),
      currentValue: Number(rand(20, 120).toFixed(1)),
      mean: Number(rand(30, 60).toFixed(1)),
      stddev: Number(rand(5, 25).toFixed(1)),
      sampleSize: base.sampleSize,
    },
  };
}

export function generatePathwayDvns(count = 3): PathwayDvnEntry[] {
  const selected = DVN_REGISTRY.slice(0, count);
  return selected.map((dvn) => ({
    address: dvn.address,
    name: dvn.name,
    verificationCount: randInt(200, 6000),
    avgLatencyS: Number(rand(20, 90).toFixed(1)),
    p50LatencyS: Number(rand(15, 60).toFixed(1)),
    p95LatencyS: Number(rand(60, 180).toFixed(1)),
    lastSeen: minutesAgo(randInt(1, 30)),
  }));
}

export function generateTimeseries(hours = 24): { bucket: string; p50: number; count: number }[] {
  const points: { bucket: string; p50: number; count: number }[] = [];
  const now = Date.now();
  const baseLatency = rand(25, 50);

  for (let i = hours; i >= 0; i--) {
    const t = new Date(now - i * 3_600_000);
    points.push({
      bucket: t.toISOString(),
      p50: Number((baseLatency + rand(-10, 15)).toFixed(1)),
      count: randInt(5, 120),
    });
  }
  return points;
}

export function generateDvnLeaderboard(count = 8): DVNLeaderboardEntry[] {
  return DVN_REGISTRY.slice(0, count).map((dvn, i) => ({
    rank: i + 1,
    address: dvn.address,
    name: dvn.name,
    providerId: dvn.id,
    verificationCount: randInt(3000, 50000) - i * 2000,
    avgLatencyS: Number(rand(20, 80).toFixed(1)),
    p50LatencyS: Number(rand(15, 50).toFixed(1)),
    coveragePathways: randInt(5, 42),
  }));
}

export function generateDvnRegistry(): DVNProvider[] {
  return DVN_REGISTRY.map((dvn) => ({
    id: dvn.id,
    name: dvn.name,
    deprecated: false,
    lzReadCompatible: Math.random() > 0.3,
    chains: CHAIN_EIDS.slice(0, randInt(3, CHAIN_EIDS.length)).map((eid) => ({
      address: dvn.address,
      eid,
    })),
  }));
}

export function generateDvnCompare(addressA: string, addressB: string): { dvns: [DVNCompareEntry, DVNCompareEntry] } {
  function makeDvn(address: string): DVNCompareEntry {
    const p50 = Number(rand(15, 50).toFixed(1));
    return {
      address,
      score: randInt(50, 98),
      verificationCount: randInt(1000, 30000),
      avgLatencyS: Number(rand(20, 70).toFixed(1)),
      p50LatencyS: p50,
      coveragePathways: randInt(5, 42),
      availability: Number(rand(0.9, 1.0).toFixed(4)),
      latency: {
        p50,
        p95: Number((p50 * rand(1.8, 3)).toFixed(1)),
        p99: Number((p50 * rand(3, 5)).toFixed(1)),
        avg: Number((p50 * rand(1.1, 1.5)).toFixed(1)),
        count: randInt(500, 10000),
      },
    };
  }
  return { dvns: [makeDvn(addressA), makeDvn(addressB)] };
}

export function generateAuditResult(oappAddress: string, srcEid: number, dstEid: number): AuditResult {
  const score = randInt(40, 95);
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  const dvnCount = randInt(1, 4);
  const requiredDVNs = DVN_REGISTRY.slice(0, dvnCount).map((d) => d.address);
  const optionalDVNs = DVN_REGISTRY.slice(dvnCount, dvnCount + randInt(0, 2)).map((d) => d.address);

  return {
    oappAddress,
    srcEid,
    dstEid,
    config: {
      confirmations: pick([1, 6, 12, 15, 64]),
      requiredDVNCount: requiredDVNs.length,
      optionalDVNCount: optionalDVNs.length,
      optionalDVNThreshold: optionalDVNs.length > 0 ? 1 : 0,
      requiredDVNs,
      optionalDVNs,
    },
    score,
    grade: grade as AuditResult["grade"],
    factors: [
      { name: "DVN Diversity", score: randInt(5, 25), maxScore: 25, detail: `${dvnCount} required DVN(s), ${optionalDVNs.length} optional` },
      { name: "Confirmation Depth", score: randInt(10, 25), maxScore: 25, detail: `${pick([1, 6, 12, 15])} block confirmations` },
      { name: "DVN Reputation", score: randInt(10, 25), maxScore: 25, detail: "Based on historical verification success rate" },
      { name: "Pathway Coverage", score: randInt(10, 25), maxScore: 25, detail: `DVNs cover ${randInt(5, 30)} pathways` },
    ],
    recommendations: [
      "Consider adding at least 2 required DVNs for redundancy",
      "Add optional DVNs with a threshold of 1 for additional security",
      "Increase confirmation depth for high-value transfers",
      ...(score < 70 ? ["Review DVN selection — some operators have limited track record"] : []),
    ].slice(0, randInt(2, 4)),
  };
}

export function generateAlerts(count = 5): Alert[] {
  const types = ["latency_spike", "delivery_failure", "dvn_offline", "anomaly_detected", "health_degraded"];
  const severities = ["critical", "warning", "info"];

  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    alertType: pick(types),
    severity: pick(severities),
    srcEid: pick(CHAIN_EIDS),
    dstEid: pick(CHAIN_EIDS),
    dvnAddress: Math.random() > 0.5 ? pick(DVN_REGISTRY).address : null,
    reason: pick([
      "P95 verification latency exceeded 120s threshold",
      "Message delivery rate dropped below 80%",
      "DVN has not verified any messages for 30 minutes",
      "Latency anomaly detected (z-score 3.2)",
      "Pathway health score dropped below 50",
      "DVN coverage gap on Ethereum → Arbitrum pathway",
    ]),
    metadata: {},
    isActive: i < 3,
    createdAt: minutesAgo(randInt(1, 120)),
  }));
}

export function generatePathwayMessages(srcEid: number, dstEid: number, count = 8): MessageSearchResult[] {
  const statuses = ["delivered", "verified", "sent", "inflight"];

  return Array.from({ length: count }, () => {
    const status = pick(statuses);
    return {
      guid: randomHex(32),
      srcEid,
      dstEid,
      sender: randomHex(20),
      status,
      sentAt: minutesAgo(rand(1, 120)),
      verificationLatencyS: status !== "sent" ? Number(rand(15, 120).toFixed(1)) : null,
    };
  }).sort((a, b) => {
    // Most recent first
    if (!a.sentAt || !b.sentAt) return 0;
    return new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime();
  });
}

export function generateMessageSearch(count = 10): MessageSearchResult[] {
  const statuses = ["delivered", "verified", "sent", "inflight"];

  return Array.from({ length: count }, () => {
    const status = pick(statuses);
    return {
      guid: randomHex(32),
      srcEid: pick(CHAIN_EIDS),
      dstEid: pick(CHAIN_EIDS),
      sender: randomHex(20),
      status,
      sentAt: hoursAgo(rand(0.1, 24)),
      verificationLatencyS: status !== "sent" ? Number(rand(15, 120).toFixed(1)) : null,
    };
  });
}

export function generateMessageTimeline(guid?: string): MessageTimeline {
  const srcEid = pick(CHAIN_EIDS);
  const dstEid = pick(CHAIN_EIDS.filter((e) => e !== srcEid));
  const sentTime = new Date(Date.now() - randInt(60, 7200) * 1000);
  const verifyDelay = rand(20, 90);
  const deliverDelay = rand(5, 30);

  return {
    guid: guid ?? randomHex(32),
    srcEid,
    dstEid,
    sender: randomHex(20),
    receiver: randomHex(20),
    nonce: randInt(1, 10000),
    status: "delivered",
    verificationLatencyS: Number(verifyDelay.toFixed(1)),
    deliveryLatencyS: Number(deliverDelay.toFixed(1)),
    timeline: [
      {
        event: "PacketSent",
        timestamp: sentTime.toISOString(),
        txHash: randomHex(32),
      },
      {
        event: "PacketVerified",
        timestamp: new Date(sentTime.getTime() + verifyDelay * 1000).toISOString(),
        txHash: randomHex(32),
        dvnAddress: pick(DVN_REGISTRY).address,
        latencyS: Number(verifyDelay.toFixed(1)),
      },
      {
        event: "PacketDelivered",
        timestamp: new Date(sentTime.getTime() + (verifyDelay + deliverDelay) * 1000).toISOString(),
        txHash: randomHex(32),
        latencyS: Number(deliverDelay.toFixed(1)),
      },
    ],
  };
}
