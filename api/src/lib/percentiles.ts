import type { PrismaClient } from "@prisma/client";

export interface PercentileResult {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  count: number;
}

interface RawPercentileRow {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  avg: number | null;
  count: bigint;
}

/**
 * Query verification latency percentiles from dvn_verifications table.
 * Shared across pathway latency, DVN latency, leaderboard, and reputation scoring.
 */
export async function queryVerificationPercentiles(
  prisma: PrismaClient,
  opts: {
    srcEid?: number;
    dstEid?: number;
    dvnAddress?: Uint8Array;
    windowHours?: number;
  },
): Promise<PercentileResult> {
  const { srcEid, dstEid, dvnAddress, windowHours = 24 } = opts;

  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    throw new Error("windowHours must be a finite positive number");
  }

  // Build dynamic WHERE conditions
  const conditions: string[] = [
    `verified_at > NOW() - '${windowHours} hours'::INTERVAL`,
  ];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (srcEid !== undefined) {
    conditions.push(`src_eid = $${paramIdx++}`);
    params.push(srcEid);
  }
  if (dstEid !== undefined) {
    conditions.push(`dst_eid = $${paramIdx++}`);
    params.push(dstEid);
  }
  if (dvnAddress !== undefined) {
    conditions.push(`dvn_address = $${paramIdx++}`);
    params.push(dvnAddress);
  }

  const whereClause = conditions.join(" AND ");

  const rows = await prisma.$queryRawUnsafe<RawPercentileRow[]>(
    `SELECT
      percentile_cont(0.50) WITHIN GROUP (ORDER BY verification_latency_s) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY verification_latency_s) AS p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY verification_latency_s) AS p99,
      AVG(verification_latency_s) AS avg,
      COUNT(*) AS count
    FROM dvn_verifications
    WHERE ${whereClause}`,
    ...params,
  );

  const row = rows[0];
  return {
    p50: row?.p50 ?? 0,
    p95: row?.p95 ?? 0,
    p99: row?.p99 ?? 0,
    avg: row?.avg ?? 0,
    count: Number(row?.count ?? 0),
  };
}
