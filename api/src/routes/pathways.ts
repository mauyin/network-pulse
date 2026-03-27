import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { LatencyStats } from "../analytics/latency-stats.js";
import { AnomalyDetector } from "../analytics/anomaly-detector.js";
import { HealthScorer } from "../analytics/health-scorer.js";
import { SUPPORTED_EIDS, getChainByEid } from "../lib/chains.js";
import { bufferToHex } from "../lib/hex.js";
import { cached, cacheKey } from "../lib/cache.js";
import { wrapResponse } from "../lib/response.js";

interface PathwayParams {
  srcEid: string;
  dstEid: string;
}

export async function pathwayRoutes(
  app: FastifyInstance,
  opts: { prisma: PrismaClient; redis: Redis },
): Promise<void> {
  const latencyStats = new LatencyStats(opts.prisma, opts.redis);
  const anomalyDetector = new AnomalyDetector(opts.prisma, app.log);
  const healthScorer = new HealthScorer(opts.prisma, opts.redis);

  // GET /pathways — list all active pathways
  app.get("/pathways", async () => {
    const health = await healthScorer.getAllPathwaysHealth();
    return wrapResponse(health, opts.redis, cacheKey("all-pathways"));
  });

  // GET /pathways/:srcEid/:dstEid/health
  app.get<{ Params: PathwayParams }>(
    "/pathways/:srcEid/:dstEid/health",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            srcEid: { type: "string", pattern: "^\\d+$" },
            dstEid: { type: "string", pattern: "^\\d+$" },
          },
          required: ["srcEid", "dstEid"],
        },
      },
    },
    async (request, reply) => {
      const srcEid = parseInt(request.params.srcEid, 10);
      const dstEid = parseInt(request.params.dstEid, 10);

      if (!SUPPORTED_EIDS.includes(srcEid) || !SUPPORTED_EIDS.includes(dstEid)) {
        return reply.status(400).send({ error: "Unsupported EID" });
      }

      const [health, latency, anomaly] = await Promise.all([
        healthScorer.getPathwayHealth(srcEid, dstEid),
        latencyStats.getPathwayLatency(srcEid, dstEid),
        anomalyDetector.checkPathwayAnomaly(srcEid, dstEid),
      ]);

      return wrapResponse(
        {
          ...health,
          latency,
          anomaly,
          srcChain: getChainByEid(srcEid)?.name,
          dstChain: getChainByEid(dstEid)?.name,
        },
        opts.redis,
        cacheKey("pathway-health", srcEid, dstEid),
      );
    },
  );

  // GET /pathways/:srcEid/:dstEid/timeseries — latency time-series for trend charts
  app.get<{ Params: PathwayParams }>(
    "/pathways/:srcEid/:dstEid/timeseries",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            srcEid: { type: "string", pattern: "^\\d+$" },
            dstEid: { type: "string", pattern: "^\\d+$" },
          },
          required: ["srcEid", "dstEid"],
        },
      },
    },
    async (request, reply) => {
      const srcEid = parseInt(request.params.srcEid, 10);
      const dstEid = parseInt(request.params.dstEid, 10);

      if (!SUPPORTED_EIDS.includes(srcEid) || !SUPPORTED_EIDS.includes(dstEid)) {
        return reply.status(400).send({ error: "Unsupported EID" });
      }

      const buckets = await latencyStats.getPathwayLatencyTimeseries(srcEid, dstEid);
      return wrapResponse(
        buckets.map((b) => ({
          bucket: b.bucket,
          p50: Math.round(b.p50 * 100) / 100,
          count: b.count,
        })),
      );
    },
  );

  // GET /pathways/:srcEid/:dstEid/dvns — DVN comparison for a specific pathway
  app.get<{ Params: PathwayParams }>(
    "/pathways/:srcEid/:dstEid/dvns",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            srcEid: { type: "string", pattern: "^\\d+$" },
            dstEid: { type: "string", pattern: "^\\d+$" },
          },
          required: ["srcEid", "dstEid"],
        },
      },
    },
    async (request, reply) => {
      const srcEid = parseInt(request.params.srcEid, 10);
      const dstEid = parseInt(request.params.dstEid, 10);

      if (!SUPPORTED_EIDS.includes(srcEid) || !SUPPORTED_EIDS.includes(dstEid)) {
        return reply.status(400).send({ error: "Unsupported EID" });
      }

      const ck = cacheKey("pathway-dvns", srcEid, dstEid);
      const dvns = await cached(opts.redis, ck, async () => {
        const rows = await opts.prisma.$queryRaw<PathwayDvnRow[]>`
          SELECT
            v.dvn_address,
            dp.canonical_name AS name,
            COUNT(*)::int AS verification_count,
            AVG(v.verification_latency_s) AS avg_latency,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY v.verification_latency_s) AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY v.verification_latency_s) AS p95,
            MAX(v.verified_at) AS last_seen
          FROM dvn_verifications v
          LEFT JOIN dvn_addresses da ON da.address = v.dvn_address
          LEFT JOIN dvn_providers dp ON dp.id = da.provider_id
          WHERE v.src_eid = ${srcEid} AND v.dst_eid = ${dstEid}
            AND v.verified_at > NOW() - INTERVAL '24 hours'
          GROUP BY v.dvn_address, dp.canonical_name
          ORDER BY verification_count DESC
        `;

        return rows.map((row) => ({
          address: bufferToHex(row.dvn_address),
          name: row.name ?? null,
          verificationCount: Number(row.verification_count),
          avgLatencyS: Math.round(row.avg_latency * 100) / 100,
          p50LatencyS: Math.round(row.p50 * 100) / 100,
          p95LatencyS: Math.round(row.p95 * 100) / 100,
          lastSeen: row.last_seen.toISOString(),
        }));
      });
      return wrapResponse(dvns, opts.redis, ck);
    },
  );
}

interface PathwayDvnRow {
  dvn_address: Uint8Array;
  name: string | null;
  verification_count: number;
  avg_latency: number;
  p50: number;
  p95: number;
  last_seen: Date;
}
