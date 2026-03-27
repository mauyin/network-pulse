import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import type {
  ChainEvent,
  PacketSentEvent,
  PacketVerifiedEvent,
  PacketDeliveredEvent,
} from "../types/events.js";
import { hexToBuffer } from "../lib/hex.js";

const PENDING_KEY = "pending:events";
const PENDING_MAX = 10_000;
const PENDING_TTL_S = 21_600; // 6 hours — cross-chain verifications can take hours on slow chains
const PENDING_EXPIRED_KEY = "metrics:pending_events_expired_total";

export class CorrelationEngine {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private logger: FastifyBaseLogger,
  ) {}

  async processEvent(event: ChainEvent): Promise<void> {
    // Audit trail: persist raw event to chain_events
    await this.prisma.$executeRaw`
      INSERT INTO chain_events (
        chain_id, block_number, tx_hash, log_index, event_type,
        src_eid, dst_eid, sender, nonce, receiver, guid, dvn_address,
        block_timestamp, raw_data
      ) VALUES (
        ${event.chain_id},
        ${event.block_number},
        ${hexToBuffer(event.tx_hash)},
        ${event.log_index},
        ${event.event_type},
        ${event.src_eid},
        ${"dst_eid" in event ? event.dst_eid : null},
        ${hexToBuffer(event.sender)},
        ${BigInt(event.nonce)},
        ${"receiver" in event && event.receiver ? hexToBuffer(event.receiver) : null},
        ${"guid" in event ? hexToBuffer(event.guid) : null},
        ${"dvn_address" in event ? hexToBuffer(event.dvn_address) : null},
        ${new Date(event.block_timestamp * 1000)},
        ${JSON.stringify(event)}::jsonb
      )
      ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
    `;

    switch (event.event_type) {
      case "PacketSent":
        await this.handlePacketSent(event);
        break;
      case "PacketVerified":
        await this.handlePacketVerified(event);
        break;
      case "PacketDelivered":
        await this.handlePacketDelivered(event);
        break;
    }
  }

  // ── PacketSent ──────────────────────────────────────────────

  private async handlePacketSent(event: PacketSentEvent): Promise<void> {
    const guid = hexToBuffer(event.guid);

    await this.prisma.message.upsert({
      where: { guid },
      create: {
        guid,
        srcEid: event.src_eid,
        dstEid: event.dst_eid,
        sender: hexToBuffer(event.sender),
        receiver: hexToBuffer(event.receiver),
        nonce: BigInt(event.nonce),
        status: "sent",
        sentBlockNumber: BigInt(event.block_number),
        sentTxHash: hexToBuffer(event.tx_hash),
        sentAt: new Date(event.block_timestamp * 1000),
      },
      update: {}, // Idempotent — don't overwrite existing message
    });

    this.logger.debug(
      { guid: event.guid, srcEid: event.src_eid, dstEid: event.dst_eid },
      "Stored PacketSent message",
    );
  }

  // ── PacketVerified ──────────────────────────────────────────

  private async handlePacketVerified(event: PacketVerifiedEvent): Promise<void> {
    const matched = await this.matchVerification(event);
    if (!matched) {
      await this.bufferPendingEvent(event);
    }
  }

  private async matchVerification(event: PacketVerifiedEvent): Promise<boolean> {
    const message = await this.findMessageByOrigin(
      event.src_eid,
      event.sender,
      event.nonce,
    );
    if (!message) return false;

    const verifiedAt = new Date(event.block_timestamp * 1000);
    const latencyS = message.sentAt
      ? (verifiedAt.getTime() - message.sentAt.getTime()) / 1000
      : 0;

    await this.prisma.$executeRaw`
      INSERT INTO dvn_verifications (
        message_guid, dvn_address, src_eid, dst_eid,
        verified_at, verification_latency_s, block_number, tx_hash
      ) VALUES (
        ${message.guid}, ${hexToBuffer(event.dvn_address)},
        ${event.src_eid}, ${message.dstEid},
        ${verifiedAt}, ${latencyS},
        ${BigInt(event.block_number)}, ${hexToBuffer(event.tx_hash)}
      )
      ON CONFLICT (message_guid, dvn_address, tx_hash) DO NOTHING
    `;

    // Update message status on first verification
    if (message.status === "sent") {
      await this.prisma.message.update({
        where: { guid: message.guid },
        data: {
          status: "verified",
          firstVerifiedAt: verifiedAt,
          verificationLatencyS: latencyS,
        },
      });
    }

    this.logger.debug(
      { srcEid: event.src_eid, nonce: event.nonce, dvn: event.dvn_address },
      "Matched PacketVerified",
    );
    return true;
  }

  // ── PacketDelivered ─────────────────────────────────────────

  private async handlePacketDelivered(event: PacketDeliveredEvent): Promise<void> {
    const matched = await this.matchDelivery(event);
    if (!matched) {
      await this.bufferPendingEvent(event);
    }
  }

  private async matchDelivery(event: PacketDeliveredEvent): Promise<boolean> {
    const message = await this.findMessageByOrigin(
      event.src_eid,
      event.sender,
      event.nonce,
    );
    if (!message) return false;

    const deliveredAt = new Date(event.block_timestamp * 1000);
    const deliveryLatencyS = message.sentAt
      ? (deliveredAt.getTime() - message.sentAt.getTime()) / 1000
      : 0;

    await this.prisma.message.update({
      where: { guid: message.guid },
      data: {
        status: "delivered",
        deliveredAt,
        deliveredTxHash: hexToBuffer(event.tx_hash),
        deliveryLatencyS,
      },
    });

    this.logger.debug(
      { srcEid: event.src_eid, nonce: event.nonce },
      "Matched PacketDelivered",
    );
    return true;
  }

  // ── Shared query ────────────────────────────────────────────

  private async findMessageByOrigin(srcEid: number, sender: string, nonce: number) {
    return this.prisma.message.findFirst({
      where: {
        srcEid,
        sender: hexToBuffer(sender),
        nonce: BigInt(nonce),
      },
    });
  }

  // ── Pending event buffer ────────────────────────────────────

  private async bufferPendingEvent(event: ChainEvent): Promise<void> {
    const bufferSize = await this.redis.zcard(PENDING_KEY);
    if (bufferSize >= PENDING_MAX) {
      this.logger.warn(
        { bufferSize },
        "Pending event buffer overflow (10K cap) — dropping event",
      );
      return;
    }

    await this.redis.zadd(PENDING_KEY, event.block_timestamp, JSON.stringify(event));

    this.logger.debug(
      { eventType: event.event_type, srcEid: event.src_eid, nonce: event.nonce },
      "Buffered unmatched event",
    );
  }

  async retryPendingEvents(): Promise<void> {
    const events = await this.redis.zrangebyscore(PENDING_KEY, "-inf", "+inf");
    if (events.length === 0) return;

    const now = Math.floor(Date.now() / 1000);
    let matched = 0;
    let expired = 0;

    for (const eventJson of events) {
      const event = JSON.parse(eventJson) as ChainEvent;

      // Remove expired events (older than TTL)
      if (event.block_timestamp < now - PENDING_TTL_S) {
        await this.redis.zrem(PENDING_KEY, eventJson);
        await this.redis.incr(PENDING_EXPIRED_KEY);
        expired++;
        continue;
      }

      // Try to match
      let wasMatched = false;
      if (event.event_type === "PacketVerified") {
        wasMatched = await this.matchVerification(event);
      } else if (event.event_type === "PacketDelivered") {
        wasMatched = await this.matchDelivery(event);
      }

      if (wasMatched) {
        await this.redis.zrem(PENDING_KEY, eventJson);
        matched++;
      }
    }

    if (matched > 0 || expired > 0) {
      this.logger.info(
        { matched, expired, remaining: events.length - matched - expired },
        "Pending event retry cycle complete",
      );
    }
  }

  /** Get the total count of expired pending events (for observability) */
  async getExpiredCount(): Promise<number> {
    const count = await this.redis.get(PENDING_EXPIRED_KEY);
    return count ? parseInt(count, 10) : 0;
  }

  /** Get the current pending buffer size */
  async getPendingCount(): Promise<number> {
    return this.redis.zcard(PENDING_KEY);
  }
}
