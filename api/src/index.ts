import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import { prisma } from "./lib/prisma.js";
import { createRedisClient } from "./lib/redis.js";
import { EventConsumer } from "./consumer/event-consumer.js";
import { CorrelationEngine } from "./correlation/correlation-engine.js";
import { StuckDetector } from "./analytics/stuck-detector.js";
import { DvnMetadataSync } from "./sync/dvn-metadata-sync.js";
import { AlertStream } from "./websocket/alert-stream.js";
import { pathwayRoutes } from "./routes/pathways.js";
import { dvnRoutes } from "./routes/dvns.js";
import { alertRoutes } from "./routes/alerts.js";
import { messageRoutes } from "./routes/messages.js";
import { auditRoutes } from "./routes/audit.js";
import { subscriptionRoutes } from "./routes/subscriptions.js";
import { badgeRoutes } from "./routes/badges.js";
import { ecosystemRoutes } from "./routes/ecosystem.js";
import authPlugin from "./lib/auth.js";

const app = Fastify({ logger: true });
const redis = createRedisClient();

// ── Plugins ─────────────────────────────────────────────────

const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());
await app.register(cors, {
  origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
});
await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
await app.register(authPlugin);
await app.register(websocket);

// ── OpenAPI / Swagger ───────────────────────────────────────

await app.register(swagger, {
  openapi: {
    info: {
      title: "Network Pulse API",
      description: "DVN performance monitoring for LayerZero V2 cross-chain pathways",
      version: "1.0.0",
    },
    servers: [
      { url: "https://pulse.kyd3n.com", description: "Production" },
      { url: "http://localhost:3000", description: "Local development" },
    ],
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "API key (Bearer token)",
        },
      },
    },
  },
});

await app.register(swaggerUI, {
  routePrefix: "/docs",
  uiConfig: { docExpansion: "list", deepLinking: true },
});

// ── Health ──────────────────────────────────────────────────

app.get("/health", async () => {
  const redisOk = redis.status === "ready";
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    // db unreachable
  }

  return {
    status: redisOk && dbOk ? "healthy" : "degraded",
    components: {
      database: dbOk ? "up" : "down",
      redis: redisOk ? "up" : "down",
    },
    timestamp: new Date().toISOString(),
  };
});

// ── Routes ──────────────────────────────────────────────────

await app.register(pathwayRoutes, { prisma, redis });
await app.register(dvnRoutes, { prisma, redis });
await app.register(alertRoutes, { prisma });
await app.register(messageRoutes, { prisma });
await app.register(auditRoutes, { prisma });
await app.register(subscriptionRoutes, { prisma });
await app.register(badgeRoutes, { prisma, redis });
await app.register(ecosystemRoutes, { prisma, redis });

// ── WebSocket ───────────────────────────────────────────────

const alertStream = new AlertStream(prisma);
alertStream.register(app);

// ── Background services ─────────────────────────────────────

const correlationEngine = new CorrelationEngine(prisma, redis, app.log);
const consumer = new EventConsumer(redis, correlationEngine, app.log);
await consumer.start();
app.log.info("Event consumer started");

const stuckDetector = new StuckDetector(prisma, app.log);
stuckDetector.setAlertHandler((messages) => {
  for (const msg of messages) {
    alertStream.broadcast({
      alertType: "stuck_message",
      severity: msg.minutesStuck > 30 ? "critical" : "warning",
      srcEid: msg.srcEid,
      dstEid: msg.dstEid,
      guid: msg.guid,
      reason: `Message stuck for ${msg.minutesStuck} minutes`,
    });
  }
});
stuckDetector.start();

const dvnSync = new DvnMetadataSync(prisma, app.log);
dvnSync.start();

// ── Graceful shutdown ───────────────────────────────────────

const shutdown = async () => {
  app.log.info("Shutting down...");
  dvnSync.stop();
  stuckDetector.stop();
  alertStream.stop();
  await consumer.stop();
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ── Start ───────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? "3000", 10);
await app.listen({ port, host: "0.0.0.0" });
