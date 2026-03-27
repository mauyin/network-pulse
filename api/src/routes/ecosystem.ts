import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { bufferToHex } from "../lib/hex.js";
import { cached, cacheKey } from "../lib/cache.js";
import { wrapResponse } from "../lib/response.js";
import { getChainName } from "../lib/chains.js";

interface OAppRow {
  sender: Uint8Array;
  src_eid: number;
  dst_eid: number;
  message_count: bigint;
  first_seen: Date;
  last_seen: Date;
}

interface ConcentrationRow {
  dvn_address: Uint8Array;
  provider_name: string | null;
  oapp_count: bigint;
  verification_count: bigint;
  pathway_count: bigint;
}

export async function ecosystemRoutes(
  app: FastifyInstance,
  opts: { prisma: PrismaClient; redis: Redis },
): Promise<void> {
  // GET /ecosystem/oapps — discovered OApp addresses from PacketSent senders
  app.get("/ecosystem/oapps", async () => {
    const ck = cacheKey("ecosystem-oapps");
    const oapps = await cached(opts.redis, ck, async () => {
      const rows = await opts.prisma.$queryRaw<OAppRow[]>`
        SELECT
          sender,
          src_eid,
          dst_eid,
          COUNT(*) AS message_count,
          MIN(sent_at) AS first_seen,
          MAX(sent_at) AS last_seen
        FROM messages
        WHERE sent_at > NOW() - INTERVAL '30 days'
        GROUP BY sender, src_eid, dst_eid
        ORDER BY message_count DESC
        LIMIT 500
      `;

      return rows.map((row) => ({
        address: bufferToHex(row.sender),
        srcEid: row.src_eid,
        dstEid: row.dst_eid,
        srcChain: getChainName(row.src_eid),
        dstChain: getChainName(row.dst_eid),
        messageCount: Number(row.message_count),
        firstSeen: row.first_seen.toISOString(),
        lastSeen: row.last_seen.toISOString(),
      }));
    }, 1800); // 30-minute cache

    return wrapResponse(oapps, opts.redis, ck);
  });

  // GET /ecosystem/concentration — DVN concentration per pathway
  app.get("/ecosystem/concentration", async () => {
    const ck = cacheKey("ecosystem-concentration");
    const concentration = await cached(opts.redis, ck, async () => {
      const rows = await opts.prisma.$queryRaw<ConcentrationRow[]>`
        SELECT
          v.dvn_address,
          dp.canonical_name AS provider_name,
          COUNT(DISTINCT m.sender) AS oapp_count,
          COUNT(*) AS verification_count,
          COUNT(DISTINCT (v.src_eid, v.dst_eid)) AS pathway_count
        FROM dvn_verifications v
        JOIN messages m ON m.guid = v.message_guid
        LEFT JOIN dvn_addresses da ON da.address = v.dvn_address
        LEFT JOIN dvn_providers dp ON dp.id = da.provider_id
        WHERE v.verified_at > NOW() - INTERVAL '24 hours'
        GROUP BY v.dvn_address, dp.canonical_name
        ORDER BY oapp_count DESC
      `;

      return rows.map((row) => ({
        dvnAddress: bufferToHex(row.dvn_address),
        name: row.provider_name ?? null,
        oappCount: Number(row.oapp_count),
        verificationCount: Number(row.verification_count),
        pathwayCount: Number(row.pathway_count),
      }));
    }, 1800);

    return wrapResponse(concentration, opts.redis, ck);
  });

  // GET /ecosystem/diversity/:srcEid/:dstEid — diversity score for a pathway
  app.get<{ Params: { srcEid: string; dstEid: string } }>(
    "/ecosystem/diversity/:srcEid/:dstEid",
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
    async (request) => {
      const srcEid = parseInt(request.params.srcEid, 10);
      const dstEid = parseInt(request.params.dstEid, 10);

      const ck = cacheKey("ecosystem-diversity", srcEid, dstEid);
      const diversity = await cached(opts.redis, ck, async () => {
        // Get DVN verification distribution for this pathway
        const rows = await opts.prisma.$queryRaw<
          { dvn_address: Uint8Array; provider_name: string | null; count: bigint }[]
        >`
          SELECT
            v.dvn_address,
            dp.canonical_name AS provider_name,
            COUNT(*) AS count
          FROM dvn_verifications v
          LEFT JOIN dvn_addresses da ON da.address = v.dvn_address
          LEFT JOIN dvn_providers dp ON dp.id = da.provider_id
          WHERE v.src_eid = ${srcEid} AND v.dst_eid = ${dstEid}
            AND v.verified_at > NOW() - INTERVAL '24 hours'
          GROUP BY v.dvn_address, dp.canonical_name
        `;

        if (rows.length === 0) {
          return {
            srcEid,
            dstEid,
            diversityScore: 0,
            dvnCount: 0,
            distribution: [],
            disclaimer: "No verification data available for this pathway",
          };
        }

        // Shannon entropy-based diversity score (0-100)
        const total = rows.reduce((sum, r) => sum + Number(r.count), 0);
        const probabilities = rows.map((r) => Number(r.count) / total);
        const entropy = -probabilities.reduce((sum, p) => sum + (p > 0 ? p * Math.log2(p) : 0), 0);
        const maxEntropy = Math.log2(rows.length);
        const diversityScore = maxEntropy > 0
          ? Math.round((entropy / maxEntropy) * 100)
          : 0;

        return {
          srcEid,
          dstEid,
          diversityScore,
          dvnCount: rows.length,
          distribution: rows.map((r) => ({
            dvnAddress: bufferToHex(r.dvn_address),
            name: r.provider_name ?? null,
            verificationCount: Number(r.count),
            share: Math.round((Number(r.count) / total) * 1000) / 10,
          })),
          disclaimer: `Based on ${total} verifications from ${rows.length} DVNs in the last 24 hours`,
        };
      });

      return wrapResponse(diversity, opts.redis, ck);
    },
  );

  // GET /ecosystem/impact/:dvnAddress — "What if this DVN goes down?"
  app.get<{ Params: { dvnAddress: string } }>(
    "/ecosystem/impact/:dvnAddress",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            dvnAddress: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
          },
          required: ["dvnAddress"],
        },
      },
    },
    async (request) => {
      const { dvnAddress } = request.params;
      const dvnBuf = Buffer.from(dvnAddress.slice(2), "hex") as Uint8Array<ArrayBuffer>;

      const ck = cacheKey("ecosystem-impact", dvnAddress);
      const impact = await cached(opts.redis, ck, async () => {
        // Find all pathways and OApps that rely on this DVN
        const pathways = await opts.prisma.$queryRaw<
          { src_eid: number; dst_eid: number; verification_count: bigint; oapp_count: bigint }[]
        >`
          SELECT
            v.src_eid,
            v.dst_eid,
            COUNT(*) AS verification_count,
            COUNT(DISTINCT m.sender) AS oapp_count
          FROM dvn_verifications v
          JOIN messages m ON m.guid = v.message_guid
          WHERE v.dvn_address = ${dvnBuf}
            AND v.verified_at > NOW() - INTERVAL '24 hours'
          GROUP BY v.src_eid, v.dst_eid
        `;

        const totalAffectedOApps = new Set<string>();
        const affectedPathways = pathways.map((p) => {
          return {
            srcEid: p.src_eid,
            dstEid: p.dst_eid,
            srcChain: getChainName(p.src_eid),
            dstChain: getChainName(p.dst_eid),
            verificationCount: Number(p.verification_count),
            oappCount: Number(p.oapp_count),
          };
        });

        // Count unique OApps via a separate query
        const oappCountResult = await opts.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(DISTINCT m.sender) AS count
          FROM dvn_verifications v
          JOIN messages m ON m.guid = v.message_guid
          WHERE v.dvn_address = ${dvnBuf}
            AND v.verified_at > NOW() - INTERVAL '24 hours'
        `;

        return {
          dvnAddress,
          totalAffectedPathways: affectedPathways.length,
          totalAffectedOApps: Number(oappCountResult[0]?.count ?? 0),
          affectedPathways,
          disclaimer: `Based on verification data from the last 24 hours across ${affectedPathways.length} pathways`,
        };
      });

      return wrapResponse(impact, opts.redis, ck);
    },
  );
}
