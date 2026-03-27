import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { cached, cacheKey } from "../lib/cache.js";
import { bufferToHex } from "../lib/hex.js";

// Reputation score weights
const W_RELIABILITY = 0.35; // verification success rate
const W_PERFORMANCE = 0.30; // inverse normalized latency
const W_CONSISTENCY = 0.20; // low variance = high consistency
const W_COVERAGE = 0.15; // pathway coverage breadth

// Time windows for rolling scores
export const WINDOWS = [7, 30, 90] as const;
export type WindowDays = (typeof WINDOWS)[number];

export interface ReputationScore {
  windowDays: number;
  score: number; // 0-100
  reliability: number; // 0-1
  performance: number; // 0-1
  consistency: number; // 0-1
  coverage: number; // 0-1
  verificationCount: number;
  totalPathwayMessages: number;
  avgLatencyS: number;
  pathwayCount: number;
}

export interface DvnReputation {
  address: string;
  scores: ReputationScore[];
  trend: "improving" | "stable" | "declining";
}

interface ReputationStatsRow {
  verification_count: bigint;
  avg_latency: number | null;
  stddev_latency: number | null;
  pathway_count: bigint;
}

interface TotalMessagesRow {
  total: bigint;
}

export class ReputationScorer {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  async getDvnReputation(dvnAddress: Uint8Array): Promise<DvnReputation> {
    const hex = bufferToHex(dvnAddress);

    return cached(
      this.redis,
      cacheKey("dvn-reputation", hex),
      async () => {
        const scores = await Promise.all(
          WINDOWS.map((w) => this.computeWindowScore(dvnAddress, w)),
        );

        // Determine trend by comparing 7-day vs 30-day scores
        const s7 = scores.find((s) => s.windowDays === 7);
        const s30 = scores.find((s) => s.windowDays === 30);
        let trend: DvnReputation["trend"] = "stable";
        if (s7 && s30 && s7.score > 0 && s30.score > 0) {
          const delta = s7.score - s30.score;
          if (delta > 5) trend = "improving";
          else if (delta < -5) trend = "declining";
        }

        return { address: hex, scores, trend };
      },
      1800, // 30-minute cache — rolling scores don't change quickly
    );
  }

  private async computeWindowScore(
    dvnAddress: Uint8Array,
    windowDays: number,
  ): Promise<ReputationScore> {
    // Query DVN verification stats for the window
    const stats = await this.prisma.$queryRaw<ReputationStatsRow[]>`
      SELECT
        COUNT(*) AS verification_count,
        AVG(verification_latency_s) AS avg_latency,
        STDDEV(verification_latency_s) AS stddev_latency,
        COUNT(DISTINCT (src_eid, dst_eid)) AS pathway_count
      FROM dvn_verifications
      WHERE dvn_address = ${dvnAddress}
        AND verified_at > NOW() - ${windowDays + " days"}::INTERVAL
    `;

    const row = stats[0];
    const verificationCount = Number(row?.verification_count ?? 0);
    const avgLatency = row?.avg_latency ?? 0;
    const stddevLatency = row?.stddev_latency ?? 0;
    const pathwayCount = Number(row?.pathway_count ?? 0);

    // Total messages on pathways this DVN operates on (for reliability calculation)
    const totalRows = await this.prisma.$queryRaw<TotalMessagesRow[]>`
      SELECT COUNT(*) AS total
      FROM messages m
      JOIN (
        SELECT DISTINCT src_eid, dst_eid
        FROM dvn_verifications
        WHERE dvn_address = ${dvnAddress}
          AND verified_at > NOW() - ${windowDays + " days"}::INTERVAL
      ) paths ON paths.src_eid = m.src_eid AND paths.dst_eid = m.dst_eid
      WHERE m.sent_at > NOW() - ${windowDays + " days"}::INTERVAL
    `;
    const totalPathwayMessages = Number(totalRows[0]?.total ?? 0);

    // Compute component scores (0-1)
    const reliability =
      totalPathwayMessages > 0 ? verificationCount / totalPathwayMessages : 0;

    // Performance: inverse normalized latency (300s = worst case)
    const hasLatency = verificationCount > 0 && avgLatency > 0;
    const performance = hasLatency ? 1 - Math.min(avgLatency / 300, 1) : 0;

    // Consistency: inverse coefficient of variation
    const cv =
      hasLatency && avgLatency > 0
        ? stddevLatency / (avgLatency + Number.EPSILON)
        : 0;
    const consistency = hasLatency ? 1 / (1 + cv) : 0;

    // Coverage: normalized pathway count (10 pathways = maximum score)
    const coverage = Math.min(pathwayCount / 10, 1);

    const score = Math.round(
      (W_RELIABILITY * reliability +
        W_PERFORMANCE * performance +
        W_CONSISTENCY * consistency +
        W_COVERAGE * coverage) *
        100,
    );

    return {
      windowDays,
      score,
      reliability: Math.round(reliability * 1000) / 1000,
      performance: Math.round(performance * 1000) / 1000,
      consistency: Math.round(consistency * 1000) / 1000,
      coverage: Math.round(coverage * 1000) / 1000,
      verificationCount,
      totalPathwayMessages,
      avgLatencyS: Math.round(avgLatency * 100) / 100,
      pathwayCount,
    };
  }
}
