import type { PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";

const Z_THRESHOLD = 3.0;
const MIN_SAMPLES = 10; // need at least 10 data points for meaningful stats
const EPSILON = 1e-10; // div/0 guard for stddev

export interface AnomalyResult {
  isAnomaly: boolean;
  zScore: number;
  currentValue: number;
  mean: number;
  stddev: number;
  sampleSize: number;
}

interface StatsRow {
  avg: number | null;
  stddev: number | null;
  count: bigint;
}

export class AnomalyDetector {
  constructor(
    private prisma: PrismaClient,
    private logger: FastifyBaseLogger,
  ) {}

  // Check if a pathway's recent latency is anomalous compared to its baseline
  async checkPathwayAnomaly(
    srcEid: number,
    dstEid: number,
  ): Promise<AnomalyResult> {
    // Baseline: last 24h stats
    const baseline = await this.prisma.$queryRaw<StatsRow[]>`
      SELECT
        AVG(verification_latency_s) AS avg,
        STDDEV(verification_latency_s) AS stddev,
        COUNT(*) AS count
      FROM dvn_verifications
      WHERE src_eid = ${srcEid}
        AND dst_eid = ${dstEid}
        AND verified_at > NOW() - INTERVAL '24 hours'
    `;

    const stats = baseline[0];
    const sampleSize = Number(stats?.count ?? 0);

    // Cold start guard — not enough data for meaningful anomaly detection
    if (sampleSize < MIN_SAMPLES || stats?.avg == null) {
      return {
        isAnomaly: false,
        zScore: 0,
        currentValue: 0,
        mean: 0,
        stddev: 0,
        sampleSize,
      };
    }

    // Recent value: last 10 minutes average
    const recent = await this.prisma.$queryRaw<{ avg: number | null }[]>`
      SELECT AVG(verification_latency_s) AS avg
      FROM dvn_verifications
      WHERE src_eid = ${srcEid}
        AND dst_eid = ${dstEid}
        AND verified_at > NOW() - INTERVAL '10 minutes'
    `;

    const currentValue = recent[0]?.avg ?? stats.avg;
    const mean = stats.avg;
    const stddev = stats.stddev ?? 0;

    // Z-score with division-by-zero guard
    const z = stddev < EPSILON ? 0 : (currentValue - mean) / stddev;

    const result: AnomalyResult = {
      isAnomaly: Math.abs(z) > Z_THRESHOLD,
      zScore: Math.round(z * 100) / 100,
      currentValue: Math.round(currentValue * 100) / 100,
      mean: Math.round(mean * 100) / 100,
      stddev: Math.round(stddev * 100) / 100,
      sampleSize,
    };

    if (result.isAnomaly) {
      this.logger.warn(
        { srcEid, dstEid, ...result },
        "Pathway latency anomaly detected",
      );
    }

    return result;
  }

  // Check if a specific DVN's latency is anomalous
  async checkDvnAnomaly(dvnAddress: Uint8Array): Promise<AnomalyResult> {
    const baseline = await this.prisma.$queryRaw<StatsRow[]>`
      SELECT
        AVG(verification_latency_s) AS avg,
        STDDEV(verification_latency_s) AS stddev,
        COUNT(*) AS count
      FROM dvn_verifications
      WHERE dvn_address = ${dvnAddress}
        AND verified_at > NOW() - INTERVAL '24 hours'
    `;

    const stats = baseline[0];
    const sampleSize = Number(stats?.count ?? 0);

    if (sampleSize < MIN_SAMPLES || stats?.avg == null) {
      return {
        isAnomaly: false,
        zScore: 0,
        currentValue: 0,
        mean: 0,
        stddev: 0,
        sampleSize,
      };
    }

    const recent = await this.prisma.$queryRaw<{ avg: number | null }[]>`
      SELECT AVG(verification_latency_s) AS avg
      FROM dvn_verifications
      WHERE dvn_address = ${dvnAddress}
        AND verified_at > NOW() - INTERVAL '10 minutes'
    `;

    const currentValue = recent[0]?.avg ?? stats.avg;
    const mean = stats.avg;
    const stddev = stats.stddev ?? 0;
    const z = stddev < EPSILON ? 0 : (currentValue - mean) / stddev;

    return {
      isAnomaly: Math.abs(z) > Z_THRESHOLD,
      zScore: Math.round(z * 100) / 100,
      currentValue: Math.round(currentValue * 100) / 100,
      mean: Math.round(mean * 100) / 100,
      stddev: Math.round(stddev * 100) / 100,
      sampleSize,
    };
  }
}
