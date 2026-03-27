import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { Prisma } from "@prisma/client";
import { cached, cacheKey } from "../lib/cache.js";
import { bufferToHex } from "../lib/hex.js";
import { SUPPORTED_EIDS } from "../lib/chains.js";

// Weights for the composite health score
const W_AVAILABILITY = 0.4;
const W_PERFORMANCE = 0.3;
const W_CONSISTENCY = 0.3;

export interface HealthBreakdownComponent {
  value: number;
  raw: string;
  weight: number;
}

export interface HealthBreakdown {
  availability: HealthBreakdownComponent;
  performance: HealthBreakdownComponent;
  consistency: HealthBreakdownComponent;
}

export interface DataConfidence {
  level: "high" | "medium" | "low" | "insufficient";
  sampleSizeOk: boolean; // true if sample_size >= 10
  dataFresh: boolean; // true if newest message < 1hr old
  captureRate: number; // 0-1, ratio of verified/total
  tooltip: string;
}

export interface PathwayHealth {
  srcEid: number;
  dstEid: number;
  score: number; // 0-100
  status: "healthy" | "degraded" | "critical" | "unknown";
  totalMessages: number;
  verifiedMessages: number;
  deliveredMessages: number;
  avgLatencyS: number;
  breakdown: HealthBreakdown;
  sampleSize: number;
  windowHours: number;
  confidence: DataConfidence;
}

export interface DvnHealth {
  address: string;
  score: number; // 0-100
  verificationCount: number;
  avgLatencyS: number;
  p50LatencyS: number;
  coveragePathways: number;
  availability: number;
}

interface PathwayStatsRow {
  total: bigint;
  verified: bigint;
  delivered: bigint;
  avg_latency: number | null;
  stddev_latency: number | null;
  newest_message: Date | null;
}

interface AllPathwayStatsRow extends PathwayStatsRow {
  src_eid: number;
  dst_eid: number;
}

export class HealthScorer {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  async getPathwayHealth(srcEid: number, dstEid: number): Promise<PathwayHealth> {
    return cached(
      this.redis,
      cacheKey("pathway-health", srcEid, dstEid),
      async () => {
        const rows = await this.prisma.$queryRaw<PathwayStatsRow[]>`
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status IN ('verified', 'delivered')) AS verified,
            COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
            AVG(verification_latency_s) AS avg_latency,
            STDDEV(verification_latency_s) AS stddev_latency,
            MAX(sent_at) AS newest_message
          FROM messages
          WHERE src_eid = ${srcEid}
            AND dst_eid = ${dstEid}
            AND sent_at > NOW() - INTERVAL '24 hours'
        `;

        return this.computePathwayHealth(srcEid, dstEid, rows[0]);
      },
    );
  }

  private computePathwayHealth(
    srcEid: number,
    dstEid: number,
    stats: PathwayStatsRow | undefined,
  ): PathwayHealth {
    const total = Number(stats?.total ?? 0);
    const verified = Number(stats?.verified ?? 0);
    const delivered = Number(stats?.delivered ?? 0);
    const avgLatency = stats?.avg_latency ?? 0;
    const stddevLatency = stats?.stddev_latency ?? 0;

    // Availability: % of messages that got verified
    const availability = total > 0 ? verified / total : 0;

    // Performance and consistency are only meaningful with real verification data.
    // Without it, these should be 0 (unknown), not 1.0 (perfect).
    const hasLatencyData = verified > 0 && avgLatency > 0;
    const normalizedLatency = hasLatencyData ? Math.min(avgLatency / 300, 1) : 1;
    const performance = 1 - normalizedLatency;

    const cv = hasLatencyData && avgLatency > 0 ? stddevLatency / avgLatency : 0;
    const consistency = hasLatencyData ? 1 / (1 + cv) : 0;

    const score = Math.round(
      (W_AVAILABILITY * availability + W_PERFORMANCE * performance + W_CONSISTENCY * consistency) * 100,
    );

    let status: PathwayHealth["status"];
    if (total === 0) status = "unknown";
    else if (score >= 80) status = "healthy";
    else if (score >= 50) status = "degraded";
    else status = "critical";

    // Data confidence indicator
    const sampleSizeOk = total >= 10;
    const newestMessage = stats?.newest_message;
    const dataFresh = newestMessage
      ? Date.now() - new Date(newestMessage).getTime() < 3_600_000
      : false;
    const captureRate = total > 0 ? verified / total : 0;

    let confidenceLevel: DataConfidence["level"];
    if (total === 0) confidenceLevel = "insufficient";
    else if (sampleSizeOk && dataFresh && captureRate >= 0.8) confidenceLevel = "high";
    else if (sampleSizeOk && dataFresh) confidenceLevel = "medium";
    else confidenceLevel = "low";

    const confidenceParts: string[] = [];
    if (!sampleSizeOk) confidenceParts.push(`small sample (${total} messages)`);
    if (!dataFresh) confidenceParts.push("data may be stale (>1hr since last message)");
    if (captureRate < 0.8 && total > 0) confidenceParts.push(`${Math.round(captureRate * 100)}% capture rate`);

    const confidence: DataConfidence = {
      level: confidenceLevel,
      sampleSizeOk,
      dataFresh,
      captureRate: Math.round(captureRate * 1000) / 1000,
      tooltip: confidenceParts.length > 0
        ? confidenceParts.join("; ")
        : "High confidence: sufficient sample size, fresh data, good capture rate",
    };

    return {
      srcEid,
      dstEid,
      score,
      status,
      totalMessages: total,
      verifiedMessages: verified,
      deliveredMessages: delivered,
      avgLatencyS: Math.round(avgLatency * 100) / 100,
      breakdown: {
        availability: {
          value: Math.round(availability * 100),
          raw: `${verified}/${total}`,
          weight: W_AVAILABILITY,
        },
        performance: {
          value: Math.round(performance * 100),
          raw: hasLatencyData ? `${Math.round(avgLatency)}s/300s` : "N/A",
          weight: W_PERFORMANCE,
        },
        consistency: {
          value: Math.round(consistency * 100),
          raw: hasLatencyData ? `CV:${cv.toFixed(2)}` : "N/A",
          weight: W_CONSISTENCY,
        },
      },
      sampleSize: total,
      windowHours: 24,
      confidence,
    };
  }

  async getDvnHealth(dvnAddress: Uint8Array): Promise<DvnHealth> {
    const hex = bufferToHex(dvnAddress);
    return cached(
      this.redis,
      cacheKey("dvn-health", hex),
      async () => {
        const stats = await this.prisma.$queryRaw<
          { count: bigint; avg_latency: number | null; p50: number | null; pathways: bigint }[]
        >`
          SELECT
            COUNT(*) AS count,
            AVG(verification_latency_s) AS avg_latency,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY verification_latency_s) AS p50,
            COUNT(DISTINCT (src_eid, dst_eid)) AS pathways
          FROM dvn_verifications
          WHERE dvn_address = ${dvnAddress}
            AND verified_at > NOW() - INTERVAL '24 hours'
        `;

        // Availability: how many messages this DVN verified vs total on its pathways
        const totalOnPathways = await this.prisma.$queryRaw<{ total: bigint }[]>`
          SELECT COUNT(*) AS total
          FROM messages m
          JOIN (
            SELECT DISTINCT src_eid, dst_eid
            FROM dvn_verifications
            WHERE dvn_address = ${dvnAddress}
              AND verified_at > NOW() - INTERVAL '24 hours'
          ) paths ON paths.src_eid = m.src_eid AND paths.dst_eid = m.dst_eid
          WHERE m.sent_at > NOW() - INTERVAL '24 hours'
        `;

        const row = stats[0];
        const verificationCount = Number(row?.count ?? 0);
        const totalMsgs = Number(totalOnPathways[0]?.total ?? 0);
        const availability = totalMsgs > 0 ? verificationCount / totalMsgs : 0;

        const score = Math.round(availability * 100);

        return {
          address: hex,
          score,
          verificationCount,
          avgLatencyS: Math.round((row?.avg_latency ?? 0) * 100) / 100,
          p50LatencyS: Math.round((row?.p50 ?? 0) * 100) / 100,
          coveragePathways: Number(row?.pathways ?? 0),
          availability: Math.round(availability * 1000) / 1000,
        };
      },
    );
  }

  // All pathways health summary (for Network Pulse)
  async getAllPathwaysHealth(): Promise<PathwayHealth[]> {
    return cached(this.redis, cacheKey("all-pathways"), async () => {
      const eids = SUPPORTED_EIDS;
      const rows = await this.prisma.$queryRaw<AllPathwayStatsRow[]>`
        SELECT
          src_eid, dst_eid,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status IN ('verified', 'delivered')) AS verified,
          COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
          AVG(verification_latency_s) AS avg_latency,
          STDDEV(verification_latency_s) AS stddev_latency,
          MAX(sent_at) AS newest_message
        FROM messages
        WHERE sent_at > NOW() - INTERVAL '24 hours'
          AND src_eid IN (${Prisma.join(eids)})
          AND dst_eid IN (${Prisma.join(eids)})
        GROUP BY src_eid, dst_eid
        ORDER BY src_eid, dst_eid
      `;

      return rows.map((row) =>
        this.computePathwayHealth(row.src_eid, row.dst_eid, row),
      );
    });
  }
}
