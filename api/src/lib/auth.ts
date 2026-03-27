import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { prisma } from "./prisma.js";

const SKIP_AUTH_PATHS = ["/health", "/docs", "/docs/"];

async function authPlugin(app: FastifyInstance) {
  const envApiKey = process.env.API_KEY;

  // If API_KEY is not set and no DB keys configured, skip auth entirely (local dev)
  if (!envApiKey) {
    app.log.warn("API_KEY not set — authentication disabled (local dev mode)");
    return;
  }

  app.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip auth for health, docs, and WebSocket
      if (SKIP_AUTH_PATHS.some((p) => request.url.startsWith(p))) return;
      if (request.url.startsWith("/ws")) return;

      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Missing API key" });
      }

      const token = header.slice(7);

      // Check env-based API key first (admin key)
      if (token === envApiKey) return;

      // Check database-stored API keys
      try {
        const apiKey = await prisma.apiKey.findUnique({
          where: { key: token },
        });

        if (!apiKey || !apiKey.isActive) {
          return reply.code(401).send({ error: "Invalid API key" });
        }

        // Update last used timestamp (fire-and-forget)
        prisma.apiKey
          .update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() },
          })
          .catch(() => {});

        // Store rate limit on request for rate-limit plugin to use
        (request as unknown as Record<string, unknown>).apiKeyRateLimit = apiKey.rateLimit;
      } catch {
        // DB error — fall back to rejecting
        return reply.code(401).send({ error: "Invalid API key" });
      }
    },
  );
}

export default fp(authPlugin, { name: "auth" });
