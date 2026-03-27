import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { bufferToHex } from "../lib/hex.js";
import { wrapResponse } from "../lib/response.js";

interface AlertsQuery {
  active?: string;
  severity?: string;
  limit?: string;
}

export async function alertRoutes(
  app: FastifyInstance,
  opts: { prisma: PrismaClient },
): Promise<void> {
  // GET /alerts
  app.get<{ Querystring: AlertsQuery }>(
    "/alerts",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            active: { type: "string", enum: ["true", "false"] },
            severity: { type: "string", enum: ["info", "warning", "critical"] },
            limit: { type: "string", pattern: "^\\d+$" },
          },
        },
      },
    },
    async (request) => {
      const { active, severity, limit } = request.query;

      const where: Record<string, unknown> = {};
      if (active !== undefined) where.isActive = active === "true";
      if (severity) where.severity = severity;

      const alerts = await opts.prisma.alert.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: Math.min(parseInt(limit ?? "50", 10), 200),
      });

      return wrapResponse(
        alerts.map((a) => ({
          id: Number(a.id),
          alertType: a.alertType,
          severity: a.severity,
          srcEid: a.srcEid,
          dstEid: a.dstEid,
          dvnAddress: a.dvnAddress ? bufferToHex(a.dvnAddress) : null,
          messageGuid: a.messageGuid ? bufferToHex(a.messageGuid) : null,
          reason: a.reason,
          metadata: a.metadata,
          isActive: a.isActive,
          createdAt: a.createdAt.toISOString(),
          resolvedAt: a.resolvedAt?.toISOString() ?? null,
        })),
      );
    },
  );
}
