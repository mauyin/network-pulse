import type Redis from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import type { CorrelationEngine } from "../correlation/correlation-engine.js";
import type { ChainEvent } from "../types/events.js";

const STREAM_KEY = "stream:chain_events";
const GROUP_NAME = "api-consumer";
const CONSUMER_NAME = `api-${process.pid}`;
const BATCH_SIZE = 100;
const BLOCK_MS = 5000;
const RETRY_INTERVAL_MS = 30_000;
const CLAIM_INTERVAL_MS = 60_000;
const DLQ_STREAM = "stream:dead_letters";
const RETRY_COUNT_KEY = "consumer:retry_counts";
const MAX_RETRIES = 3;
const CLAIM_MIN_IDLE_MS = 60_000; // claim messages idle for >60s

export class EventConsumer {
  private running = false;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private claimTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private redis: Redis,
    private correlationEngine: CorrelationEngine,
    private logger: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    // Create consumer group (idempotent — BUSYGROUP means it already exists)
    try {
      await this.redis.xgroup("CREATE", STREAM_KEY, GROUP_NAME, "0", "MKSTREAM");
      this.logger.info("Created consumer group %s", GROUP_NAME);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("BUSYGROUP")) throw err;
    }

    this.running = true;

    // Start consuming in background
    this.consumeLoop();

    // Retry pending (unmatched correlation) events every 30s
    this.retryTimer = setInterval(() => {
      this.correlationEngine.retryPendingEvents().catch((err) => {
        this.logger.error({ err }, "Error retrying pending events");
      });
    }, RETRY_INTERVAL_MS);

    // Claim and retry unACKed PEL messages every 60s
    this.claimTimer = setInterval(() => {
      this.claimPendingMessages().catch((err) => {
        this.logger.error({ err }, "Error claiming pending messages");
      });
    }, CLAIM_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.claimTimer) {
      clearInterval(this.claimTimer);
      this.claimTimer = null;
    }
  }

  private async consumeLoop(): Promise<void> {
    while (this.running) {
      try {
        const results = await this.redis.xreadgroup(
          "GROUP",
          GROUP_NAME,
          CONSUMER_NAME,
          "COUNT",
          BATCH_SIZE,
          "BLOCK",
          BLOCK_MS,
          "STREAMS",
          STREAM_KEY,
          ">",
        );

        if (!results) continue;

        // ioredis xreadgroup returns: [[streamKey, [[msgId, fields[]], ...]], ...]
        const streams = results as [string, [string, string[]][]][];
        for (const [, messages] of streams) {
          for (const [id, fields] of messages) {
            await this.processMessage(id, fields);
          }
        }
      } catch (err) {
        if (!this.running) break;
        this.logger.error({ err }, "Error reading from stream");
        await sleep(1000);
      }
    }
  }

  private async processMessage(id: string, fields: string[]): Promise<void> {
    try {
      const event = this.parseEvent(fields);
      await this.correlationEngine.processEvent(event);
      // ACK only after successful DB write
      await this.redis.xack(STREAM_KEY, GROUP_NAME, id);
      // Clear retry count on success
      await this.redis.hdel(RETRY_COUNT_KEY, id);
    } catch (err) {
      // Do NOT ACK — message stays in PEL for claimPendingMessages() to retry
      const retries = await this.redis.hincrby(RETRY_COUNT_KEY, id, 1);
      this.logger.error(
        { err, messageId: id, retryCount: retries },
        "Error processing stream message — left in PEL for retry",
      );

      if (retries >= MAX_RETRIES) {
        await this.moveToDeadLetter(id, fields, err);
      }
    }
  }

  /**
   * Claim messages stuck in PEL (unACKed for >60s) and re-process them.
   * This catches messages that failed on first attempt.
   */
  private async claimPendingMessages(): Promise<void> {
    try {
      // XAUTOCLAIM: atomically claim idle messages from any consumer in the group
      const result = await this.redis.xautoclaim(
        STREAM_KEY,
        GROUP_NAME,
        CONSUMER_NAME,
        CLAIM_MIN_IDLE_MS,
        "0-0",
        "COUNT",
        BATCH_SIZE,
      );

      // xautoclaim returns [nextStartId, [[id, fields], ...], deletedIds]
      const claimed = result[1] as [string, string[]][];
      if (!claimed || claimed.length === 0) return;

      this.logger.info(
        { count: claimed.length },
        "Claimed pending messages from PEL for retry",
      );

      for (const [id, fields] of claimed) {
        if (!fields || fields.length === 0) {
          // Message was deleted from stream but still in PEL — just ACK it
          await this.redis.xack(STREAM_KEY, GROUP_NAME, id);
          await this.redis.hdel(RETRY_COUNT_KEY, id);
          continue;
        }
        await this.processMessage(id, fields);
      }
    } catch (err) {
      this.logger.error({ err }, "Failed to claim pending messages");
    }
  }

  /**
   * Move a permanently failing message to the dead-letter queue and ACK it
   * to prevent infinite retries.
   */
  private async moveToDeadLetter(
    id: string,
    fields: string[],
    error: unknown,
  ): Promise<void> {
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.redis.xadd(
        DLQ_STREAM,
        "*",
        "original_id", id,
        "data", this.extractData(fields),
        "error", errorMessage,
        "failed_at", new Date().toISOString(),
      );
      // ACK the original message so it leaves the PEL
      await this.redis.xack(STREAM_KEY, GROUP_NAME, id);
      await this.redis.hdel(RETRY_COUNT_KEY, id);
      this.logger.warn(
        { messageId: id, error: errorMessage },
        "Message moved to dead-letter queue after max retries",
      );
    } catch (dlqErr) {
      this.logger.error(
        { err: dlqErr, messageId: id },
        "Failed to move message to dead-letter queue",
      );
    }
  }

  private extractData(fields: string[]): string {
    for (let i = 0; i < fields.length; i += 2) {
      if (fields[i] === "data") return fields[i + 1];
    }
    return "{}";
  }

  private parseEvent(fields: string[]): ChainEvent {
    // Redis stream fields come as flat array: [key1, val1, key2, val2, ...]
    // Go poller publishes: { "data": "<json>" }
    for (let i = 0; i < fields.length; i += 2) {
      if (fields[i] === "data") {
        return JSON.parse(fields[i + 1]) as ChainEvent;
      }
    }
    throw new Error("Stream message missing 'data' field");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
