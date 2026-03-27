import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { cached, cacheKey } from "../lib/cache.js";
import {
  queryVerificationPercentiles,
  type PercentileResult,
} from "../lib/percentiles.js";

export type { PercentileResult as LatencyPercentiles };

export class LatencyStats {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  // Pathway-level latency stats (verification latency for a src→dst pair)
  async getPathwayLatency(
    srcEid: number,
    dstEid: number,
    windowHours = 24,
  ): Promise<PercentileResult> {
    return cached(
      this.redis,
      cacheKey("pathway-latency", srcEid, dstEid, windowHours),
      () =>
        queryVerificationPercentiles(this.prisma, {
          srcEid,
          dstEid,
          windowHours,
        }),
    );
  }

  // DVN-specific latency across all pathways
  async getDvnLatency(
    dvnAddress: Uint8Array,
    windowHours = 24,
  ): Promise<PercentileResult> {
    return cached(
      this.redis,
      cacheKey(
        "dvn-latency",
        Buffer.from(dvnAddress).toString("hex"),
        windowHours,
      ),
      () =>
        queryVerificationPercentiles(this.prisma, {
          dvnAddress,
          windowHours,
        }),
    );
  }

  // Pathway latency over time (for charts)
  async getPathwayLatencyTimeseries(
    srcEid: number,
    dstEid: number,
    bucketMinutes = 60,
    windowHours = 24,
  ) {
    return cached(
      this.redis,
      cacheKey("pathway-ts", srcEid, dstEid, bucketMinutes, windowHours),
      async () => {
        const rows = await this.prisma.$queryRaw<
          { bucket: Date; p50: number; count: bigint }[]
        >`
          SELECT
            date_bin(${bucketMinutes + " minutes"}::INTERVAL, verified_at, '2000-01-01'::TIMESTAMPTZ) AS bucket,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY verification_latency_s) AS p50,
            COUNT(*) AS count
          FROM dvn_verifications
          WHERE src_eid = ${srcEid}
            AND dst_eid = ${dstEid}
            AND verified_at > NOW() - ${windowHours + " hours"}::INTERVAL
          GROUP BY bucket
          ORDER BY bucket
        `;
        return rows.map((r) => ({
          bucket: r.bucket,
          p50: r.p50,
          count: Number(r.count),
        }));
      },
    );
  }
}
