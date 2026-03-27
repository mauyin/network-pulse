import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { hexToBuffer, bufferToHex, isValidHash, isValidAddress } from "../lib/hex.js";
import { wrapResponse } from "../lib/response.js";

interface MessageParams {
  guid: string;
}

interface SearchQuery {
  q?: string;
  sender?: string;
  srcEid?: string;
  dstEid?: string;
  limit?: string;
}

export async function messageRoutes(
  app: FastifyInstance,
  opts: { prisma: PrismaClient },
): Promise<void> {
  // GET /messages/search — search by GUID, sender address, or pathway
  app.get<{ Querystring: SearchQuery }>(
    "/messages/search",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
            sender: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
            srcEid: { type: "string", pattern: "^\\d+$" },
            dstEid: { type: "string", pattern: "^\\d+$" },
            limit: { type: "string", pattern: "^\\d+$" },
          },
        },
      },
    },
    async (request) => {
      const { q, sender, srcEid, dstEid, limit: limitStr } = request.query;
      const limit = Math.min(parseInt(limitStr ?? "50", 10), 100);

      // Build where clause
      const where: Record<string, unknown> = {};

      if (q) {
        // If it looks like a GUID (0x + 64 hex chars), search by GUID
        if (isValidHash(q)) {
          where.guid = hexToBuffer(q);
        } else if (isValidAddress(q)) {
          // If it looks like an address, search by sender
          where.sender = hexToBuffer(q);
        }
      }

      if (sender) {
        where.sender = hexToBuffer(sender);
      }
      if (srcEid) {
        where.srcEid = parseInt(srcEid, 10);
      }
      if (dstEid) {
        where.dstEid = parseInt(dstEid, 10);
      }

      const messages = await opts.prisma.message.findMany({
        where,
        orderBy: { sentAt: "desc" },
        take: limit,
        include: { verifications: { take: 1 } },
      });

      return wrapResponse(
        messages.map((m) => ({
          guid: bufferToHex(m.guid),
          srcEid: m.srcEid,
          dstEid: m.dstEid,
          sender: bufferToHex(m.sender),
          receiver: bufferToHex(m.receiver),
          nonce: Number(m.nonce),
          status: m.status,
          sentAt: m.sentAt?.toISOString() ?? null,
          verificationLatencyS: m.verificationLatencyS,
          deliveryLatencyS: m.deliveryLatencyS,
          dvnCount: m.verifications.length,
        })),
      );
    },
  );

  // GET /messages/:guid/timeline
  app.get<{ Params: MessageParams }>(
    "/messages/:guid/timeline",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            guid: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
          },
          required: ["guid"],
        },
      },
    },
    async (request, reply) => {
      const { guid } = request.params;
      if (!isValidHash(guid)) {
        return reply.status(400).send({ error: "Invalid GUID format" });
      }

      const guidBuf = hexToBuffer(guid);
      const message = await opts.prisma.message.findUnique({
        where: { guid: guidBuf },
        include: { verifications: true },
      });

      if (!message) {
        return reply.status(404).send({ error: "Message not found" });
      }

      // Build timeline events
      const timeline: {
        event: string;
        timestamp: string | null;
        txHash: string | null;
        chain?: string;
        dvnAddress?: string;
        latencyS?: number;
      }[] = [];

      timeline.push({
        event: "PacketSent",
        timestamp: message.sentAt?.toISOString() ?? null,
        txHash: message.sentTxHash ? bufferToHex(message.sentTxHash) : null,
      });

      for (const v of message.verifications) {
        timeline.push({
          event: "PacketVerified",
          timestamp: v.verifiedAt.toISOString(),
          txHash: bufferToHex(v.txHash),
          dvnAddress: bufferToHex(v.dvnAddress),
          latencyS: v.verificationLatencyS,
        });
      }

      if (message.deliveredAt) {
        timeline.push({
          event: "PacketDelivered",
          timestamp: message.deliveredAt.toISOString(),
          txHash: message.deliveredTxHash ? bufferToHex(message.deliveredTxHash) : null,
          latencyS: message.deliveryLatencyS ?? undefined,
        });
      }

      // Sort by timestamp
      timeline.sort((a, b) => {
        if (!a.timestamp) return -1;
        if (!b.timestamp) return 1;
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });

      return wrapResponse({
        guid,
        srcEid: message.srcEid,
        dstEid: message.dstEid,
        sender: bufferToHex(message.sender),
        receiver: bufferToHex(message.receiver),
        nonce: Number(message.nonce),
        status: message.status,
        verificationLatencyS: message.verificationLatencyS,
        deliveryLatencyS: message.deliveryLatencyS,
        timeline,
      });
    },
  );
}
