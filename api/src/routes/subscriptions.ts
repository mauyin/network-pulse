import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { wrapResponse } from "../lib/response.js";
import { hexToBuffer, bufferToHex } from "../lib/hex.js";

interface CreateSubscriptionBody {
  pathwaySrcEid?: number;
  pathwayDstEid?: number;
  dvnAddress?: string;
  thresholdType: string;
  thresholdValue: number;
  webhookUrl: string;
  webhookSecret?: string;
}

export async function subscriptionRoutes(
  app: FastifyInstance,
  opts: { prisma: PrismaClient },
): Promise<void> {
  // POST /subscriptions — create a new alert subscription
  app.post<{ Body: CreateSubscriptionBody }>(
    "/subscriptions",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            pathwaySrcEid: { type: "integer" },
            pathwayDstEid: { type: "integer" },
            dvnAddress: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
            thresholdType: {
              type: "string",
              enum: ["health_score", "latency", "stuck_message"],
            },
            thresholdValue: { type: "number" },
            webhookUrl: { type: "string", format: "uri" },
            webhookSecret: { type: "string" },
          },
          required: ["thresholdType", "thresholdValue", "webhookUrl"],
        },
      },
    },
    async (request) => {
      const { pathwaySrcEid, pathwayDstEid, dvnAddress, thresholdType, thresholdValue, webhookUrl, webhookSecret } = request.body;

      const sub = await opts.prisma.alertSubscription.create({
        data: {
          pathwaySrcEid: pathwaySrcEid ?? null,
          pathwayDstEid: pathwayDstEid ?? null,
          dvnAddress: dvnAddress ? hexToBuffer(dvnAddress) : null,
          thresholdType,
          thresholdValue,
          webhookUrl,
          webhookSecret: webhookSecret ?? null,
        },
      });

      return wrapResponse({
        id: sub.id,
        thresholdType: sub.thresholdType,
        thresholdValue: sub.thresholdValue,
        webhookUrl: sub.webhookUrl,
        isActive: sub.isActive,
        createdAt: sub.createdAt.toISOString(),
      });
    },
  );

  // GET /subscriptions — list all subscriptions
  app.get("/subscriptions", async () => {
    const subs = await opts.prisma.alertSubscription.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });

    return wrapResponse(
      subs.map((s) => ({
        id: s.id,
        pathwaySrcEid: s.pathwaySrcEid,
        pathwayDstEid: s.pathwayDstEid,
        dvnAddress: s.dvnAddress ? bufferToHex(s.dvnAddress) : null,
        thresholdType: s.thresholdType,
        thresholdValue: s.thresholdValue,
        webhookUrl: s.webhookUrl,
        isActive: s.isActive,
        lastTriggeredAt: s.lastTriggeredAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
      })),
    );
  });

  // DELETE /subscriptions/:id — deactivate a subscription
  app.delete<{ Params: { id: string } }>(
    "/subscriptions/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      try {
        await opts.prisma.alertSubscription.update({
          where: { id: request.params.id },
          data: { isActive: false },
        });
        return wrapResponse({ deleted: true });
      } catch {
        return reply.status(404).send({ error: "Subscription not found" });
      }
    },
  );
}
