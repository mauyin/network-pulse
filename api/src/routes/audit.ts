import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ConfigScorer } from "../audit/config-scorer.js";
import { isValidAddress } from "../lib/hex.js";
import { SUPPORTED_EIDS } from "../lib/chains.js";
import { wrapResponse } from "../lib/response.js";

interface AuditBody {
  oappAddress: string;
  srcEid: number;
  dstEid: number;
}

export async function auditRoutes(
  app: FastifyInstance,
  opts: { prisma: PrismaClient },
): Promise<void> {
  const configScorer = new ConfigScorer(app.log, opts.prisma);

  // POST /audit
  app.post<{ Body: AuditBody }>(
    "/audit",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            oappAddress: { type: "string" },
            srcEid: { type: "integer" },
            dstEid: { type: "integer" },
          },
          required: ["oappAddress", "srcEid", "dstEid"],
        },
      },
    },
    async (request, reply) => {
      const { oappAddress, srcEid, dstEid } = request.body;

      if (!isValidAddress(oappAddress)) {
        return reply.status(400).send({ error: "Invalid OApp address format" });
      }
      if (!SUPPORTED_EIDS.includes(srcEid)) {
        return reply.status(400).send({ error: `Unsupported source EID: ${srcEid}` });
      }
      if (!SUPPORTED_EIDS.includes(dstEid)) {
        return reply.status(400).send({ error: `Unsupported destination EID: ${dstEid}` });
      }

      try {
        const result = await configScorer.audit(oappAddress, srcEid, dstEid);
        return wrapResponse(result);
      } catch (err) {
        app.log.error({ err, oappAddress, srcEid, dstEid }, "Config audit failed");
        return reply.status(503).send({
          error: "Failed to fetch config from chain",
          detail: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
  );
}
