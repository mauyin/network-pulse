import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { LatencyStats } from "../analytics/latency-stats.js";
import { AnomalyDetector } from "../analytics/anomaly-detector.js";
import { HealthScorer } from "../analytics/health-scorer.js";
import { ReputationScorer } from "../analytics/reputation-scorer.js";
import { hexToBuffer, bufferToHex, isValidAddress } from "../lib/hex.js";
import { cached, cacheKey } from "../lib/cache.js";
import { wrapResponse } from "../lib/response.js";

interface DvnParams {
  address: string;
}

interface LeaderboardRow {
  dvn_address: Uint8Array;
  verification_count: bigint;
  avg_latency: number;
  p50: number;
  pathways: bigint;
  provider_name: string | null;
  provider_id: string | null;
}

export async function dvnRoutes(
  app: FastifyInstance,
  opts: { prisma: PrismaClient; redis: Redis },
): Promise<void> {
  const latencyStats = new LatencyStats(opts.prisma, opts.redis);
  const anomalyDetector = new AnomalyDetector(opts.prisma, app.log);
  const healthScorer = new HealthScorer(opts.prisma, opts.redis);
  const reputationScorer = new ReputationScorer(opts.prisma, opts.redis);

  // GET /dvns/:address/reputation — rolling 7/30/90-day reputation scores
  app.get<{ Params: DvnParams }>(
    "/dvns/:address/reputation",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
          },
          required: ["address"],
        },
      },
    },
    async (request, reply) => {
      const { address } = request.params;
      if (!isValidAddress(address)) {
        return reply.status(400).send({ error: "Invalid Ethereum address" });
      }

      const rep = await reputationScorer.getDvnReputation(hexToBuffer(address));
      return wrapResponse(rep, opts.redis, cacheKey("dvn-reputation", address));
    },
  );

  // GET /dvns/:address/reliability
  app.get<{ Params: DvnParams }>(
    "/dvns/:address/reliability",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
          },
          required: ["address"],
        },
      },
    },
    async (request, reply) => {
      const { address } = request.params;
      if (!isValidAddress(address)) {
        return reply.status(400).send({ error: "Invalid Ethereum address" });
      }

      const dvnBuf = hexToBuffer(address);
      const [health, latency, anomaly] = await Promise.all([
        healthScorer.getDvnHealth(dvnBuf),
        latencyStats.getDvnLatency(dvnBuf),
        anomalyDetector.checkDvnAnomaly(dvnBuf),
      ]);

      return wrapResponse(
        { ...health, latency, anomaly },
        opts.redis,
        cacheKey("dvn-health", address),
      );
    },
  );

  // GET /dvns/compare — side-by-side comparison of two DVNs
  app.get<{ Querystring: { a: string; b: string } }>(
    "/dvns/compare",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            a: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
            b: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
          },
          required: ["a", "b"],
        },
      },
    },
    async (request, reply) => {
      const { a, b } = request.query;
      if (!isValidAddress(a) || !isValidAddress(b)) {
        return reply.status(400).send({ error: "Invalid Ethereum address" });
      }

      const bufA = hexToBuffer(a);
      const bufB = hexToBuffer(b);

      const [healthA, healthB, latencyA, latencyB] = await Promise.all([
        healthScorer.getDvnHealth(bufA),
        healthScorer.getDvnHealth(bufB),
        latencyStats.getDvnLatency(bufA),
        latencyStats.getDvnLatency(bufB),
      ]);

      return wrapResponse({
        dvns: [
          { ...healthA, latency: latencyA },
          { ...healthB, latency: latencyB },
        ],
      });
    },
  );

  // GET /dvns/registry — full DVN provider list with chain coverage
  app.get("/dvns/registry", async () => {
    const ck = cacheKey("dvn-registry");
    const registry = await cached(opts.redis, ck, async () => {
      const providers = await opts.prisma.dvnProvider.findMany({
        include: { addresses: { select: { address: true, eid: true } } },
        orderBy: { canonicalName: "asc" },
      });

      return providers.map((p) => ({
        id: p.id,
        name: p.canonicalName,
        deprecated: p.deprecated,
        lzReadCompatible: p.lzReadCompatible,
        chains: p.addresses.map((a) => ({
          address: bufferToHex(a.address),
          eid: a.eid,
        })),
      }));
    }, 3600); // cache 1 hour
    return wrapResponse(registry, opts.redis, ck);
  });

  // GET /dvns/:address/profile — metadata for a specific DVN address
  app.get<{ Params: DvnParams }>(
    "/dvns/:address/profile",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
          },
          required: ["address"],
        },
      },
    },
    async (request, reply) => {
      const { address } = request.params;
      if (!isValidAddress(address)) {
        return reply.status(400).send({ error: "Invalid address" });
      }

      const addrBuf = hexToBuffer(address);
      const dvnAddr = await opts.prisma.dvnAddress.findFirst({
        where: { address: addrBuf },
        include: {
          provider: {
            include: { addresses: { select: { address: true, eid: true } } },
          },
        },
      });

      if (!dvnAddr) {
        return reply.status(404).send({ error: "DVN address not found in registry" });
      }

      return wrapResponse({
        address,
        name: dvnAddr.provider.canonicalName,
        providerId: dvnAddr.provider.id,
        deprecated: dvnAddr.provider.deprecated,
        lzReadCompatible: dvnAddr.provider.lzReadCompatible,
        chains: dvnAddr.provider.addresses.map((a) => ({
          address: bufferToHex(a.address),
          eid: a.eid,
        })),
      });
    },
  );

  // GET /dvns/leaderboard
  app.get("/dvns/leaderboard", async () => {
    const ck = cacheKey("dvn-leaderboard");
    const leaderboard = await cached(opts.redis, ck, async () => {
      const rows = await opts.prisma.$queryRaw<LeaderboardRow[]>`
        SELECT
          v.dvn_address,
          dp.canonical_name AS provider_name,
          dp.id AS provider_id,
          COUNT(*) AS verification_count,
          AVG(v.verification_latency_s) AS avg_latency,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY v.verification_latency_s) AS p50,
          COUNT(DISTINCT (v.src_eid, v.dst_eid)) AS pathways
        FROM dvn_verifications v
        LEFT JOIN dvn_addresses da ON da.address = v.dvn_address
        LEFT JOIN dvn_providers dp ON dp.id = da.provider_id
        WHERE v.verified_at > NOW() - INTERVAL '24 hours'
        GROUP BY v.dvn_address, dp.canonical_name, dp.id
        ORDER BY verification_count DESC
      `;

      return rows.map((row, index) => ({
        rank: index + 1,
        address: bufferToHex(row.dvn_address),
        name: row.provider_name ?? null,
        providerId: row.provider_id ?? null,
        verificationCount: Number(row.verification_count),
        avgLatencyS: Math.round(row.avg_latency * 100) / 100,
        p50LatencyS: Math.round(row.p50 * 100) / 100,
        coveragePathways: Number(row.pathways),
      }));
    });
    return wrapResponse(leaderboard, opts.redis, ck);
  });
}
