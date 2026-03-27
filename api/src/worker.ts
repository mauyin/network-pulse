/**
 * Background worker process — handles alert delivery and scheduled jobs.
 * Runs as a separate process from the API server to keep HTTP responses fast.
 *
 * Responsibilities:
 * - Alert webhook delivery with retry
 * - Alert subscription evaluation
 */

import { prisma } from "./lib/prisma.js";
import { createRedisClient } from "./lib/redis.js";
import { HealthScorer } from "./analytics/health-scorer.js";
import { createLogger } from "./lib/logger.js";
import crypto from "crypto";

const redis = createRedisClient();
const logger = createLogger("worker");
const healthScorer = new HealthScorer(prisma, redis);

const EVAL_INTERVAL_MS = 60_000; // evaluate subscriptions every 60s
const MAX_WEBHOOK_RETRIES = 3;
const WEBHOOK_TIMEOUT_MS = 10_000;

interface WebhookPayload {
  event: string;
  subscription_id: string;
  threshold_type: string;
  threshold_value: number;
  current_value: number;
  pathway?: { srcEid: number; dstEid: number };
  dvn_address?: string;
  timestamp: string;
}

// ── Alert evaluation loop ───────────────────────────────────

async function evaluateSubscriptions(): Promise<void> {
  const subs = await prisma.alertSubscription.findMany({
    where: { isActive: true },
  });

  if (subs.length === 0) return;

  for (const sub of subs) {
    try {
      let currentValue: number | null = null;

      if (sub.thresholdType === "health_score" && sub.pathwaySrcEid && sub.pathwayDstEid) {
        const health = await healthScorer.getPathwayHealth(sub.pathwaySrcEid, sub.pathwayDstEid);
        currentValue = health.score;
      }

      if (currentValue === null) continue;

      // Check if threshold is breached (score below threshold)
      const breached = currentValue < sub.thresholdValue;

      if (breached) {
        // Rate limit: don't retrigger within 15 minutes
        if (sub.lastTriggeredAt) {
          const elapsed = Date.now() - sub.lastTriggeredAt.getTime();
          if (elapsed < 15 * 60 * 1000) continue;
        }

        const payload: WebhookPayload = {
          event: "threshold_breached",
          subscription_id: sub.id,
          threshold_type: sub.thresholdType,
          threshold_value: sub.thresholdValue,
          current_value: currentValue,
          pathway: sub.pathwaySrcEid && sub.pathwayDstEid
            ? { srcEid: sub.pathwaySrcEid, dstEid: sub.pathwayDstEid }
            : undefined,
          timestamp: new Date().toISOString(),
        };

        await deliverWebhook(sub.webhookUrl, sub.webhookSecret, payload);

        await prisma.alertSubscription.update({
          where: { id: sub.id },
          data: { lastTriggeredAt: new Date() },
        });

        logger.info(
          { subscriptionId: sub.id, currentValue, threshold: sub.thresholdValue },
          "Alert triggered and webhook delivered",
        );
      }
    } catch (err) {
      logger.error({ err, subscriptionId: sub.id }, "Error evaluating subscription");
    }
  }
}

// ── Webhook delivery ────────────────────────────────────────

async function deliverWebhook(
  url: string,
  secret: string | null,
  payload: WebhookPayload,
): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "NetworkPulse/1.0",
  };

  // HMAC signature for webhook verification
  if (secret) {
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    headers["X-Signature-256"] = `sha256=${signature}`;
  }

  for (let attempt = 1; attempt <= MAX_WEBHOOK_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) return;

      logger.warn(
        { url, status: res.status, attempt },
        "Webhook delivery failed, will retry",
      );
    } catch (err) {
      logger.warn(
        { url, attempt, err: err instanceof Error ? err.message : err },
        "Webhook delivery error",
      );
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < MAX_WEBHOOK_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }

  logger.error({ url }, "Webhook delivery failed after max retries");
}

// ── Main loop ───────────────────────────────────────────────

let running = true;

async function main(): Promise<void> {
  logger.info("Worker started");

  while (running) {
    await evaluateSubscriptions();
    await new Promise((r) => setTimeout(r, EVAL_INTERVAL_MS));
  }
}

// ── Graceful shutdown ───────────────────────────────────────

const shutdown = async () => {
  logger.info("Worker shutting down...");
  running = false;
  await prisma.$disconnect();
  redis.disconnect();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch((err) => {
  logger.error({ err }, "Worker crashed");
  process.exit(1);
});
