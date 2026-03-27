import { beforeEach, describe, expect, it, vi } from "vitest";
import { CorrelationEngine } from "./correlation-engine.js";
import { hexToBuffer } from "../lib/hex.js";
import type {
  PacketSentEvent,
  PacketVerifiedEvent,
  PacketDeliveredEvent,
} from "../types/events.js";

// ── Test data ───────────────────────────────────────────────

const GUID = "0x" + "ab".repeat(32);
const SENDER = "0x" + "11".repeat(20);
const RECEIVER = "0x" + "22".repeat(20);
const DVN_ADDRESS = "0x" + "dd".repeat(20);
const TX_HASH = "0x" + "ff".repeat(32);

const NOW_S = Math.floor(Date.now() / 1000);

function makeSentEvent(overrides: Partial<PacketSentEvent> = {}): PacketSentEvent {
  return {
    event_type: "PacketSent",
    src_eid: 30101,
    dst_eid: 30110,
    sender: SENDER,
    receiver: RECEIVER,
    nonce: 42,
    guid: GUID,
    block_number: 100_000,
    tx_hash: TX_HASH,
    block_timestamp: NOW_S,
    chain_id: 1,
    log_index: 0,
    ingestion_timestamp: NOW_S + 1,
    ...overrides,
  };
}

function makeVerifiedEvent(
  overrides: Partial<PacketVerifiedEvent> = {},
): PacketVerifiedEvent {
  return {
    event_type: "PacketVerified",
    src_eid: 30101,
    sender: SENDER,
    nonce: 42,
    dvn_address: DVN_ADDRESS,
    block_number: 100_010,
    tx_hash: TX_HASH,
    block_timestamp: NOW_S + 60,
    chain_id: 42161,
    log_index: 1,
    ingestion_timestamp: NOW_S + 61,
    ...overrides,
  };
}

function makeDeliveredEvent(
  overrides: Partial<PacketDeliveredEvent> = {},
): PacketDeliveredEvent {
  return {
    event_type: "PacketDelivered",
    src_eid: 30101,
    sender: SENDER,
    nonce: 42,
    block_number: 100_020,
    tx_hash: TX_HASH,
    block_timestamp: NOW_S + 120,
    chain_id: 42161,
    log_index: 2,
    ingestion_timestamp: NOW_S + 121,
    ...overrides,
  };
}

/** Fake message row returned by prisma.message.findFirst */
function fakeMessage(overrides: Record<string, unknown> = {}) {
  return {
    guid: hexToBuffer(GUID),
    srcEid: 30101,
    dstEid: 30110,
    sender: hexToBuffer(SENDER),
    receiver: hexToBuffer(RECEIVER),
    nonce: BigInt(42),
    status: "sent",
    sentAt: new Date(NOW_S * 1000),
    sentBlockNumber: BigInt(100_000),
    sentTxHash: hexToBuffer(TX_HASH),
    ...overrides,
  };
}

// ── Mocks ───────────────────────────────────────────────────

const mockPrisma = {
  $executeRaw: vi.fn().mockResolvedValue(1),
  message: {
    upsert: vi.fn().mockResolvedValue({}),
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
} as any;

const mockRedis = {
  zcard: vi.fn().mockResolvedValue(0),
  zadd: vi.fn().mockResolvedValue(1),
  zrangebyscore: vi.fn().mockResolvedValue([]),
  zrem: vi.fn().mockResolvedValue(1),
  incr: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
} as any;

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any;

// ── Tests ───────────────────────────────────────────────────

describe("CorrelationEngine", () => {
  let engine: CorrelationEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.message.findFirst.mockResolvedValue(null);
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.zrangebyscore.mockResolvedValue([]);
    engine = new CorrelationEngine(mockPrisma, mockRedis, mockLogger);
  });

  // ── Audit trail ────────────────────────────────────────

  it("inserts raw event into chain_events table", async () => {
    const event = makeSentEvent();
    await engine.processEvent(event);

    expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
  });

  // ── PacketSent ──────────────────────────────────────────

  it("PacketSent creates message via upsert", async () => {
    const event = makeSentEvent();
    await engine.processEvent(event);

    expect(mockPrisma.message.upsert).toHaveBeenCalledOnce();
    const call = mockPrisma.message.upsert.mock.calls[0][0];

    // where key uses guid as buffer
    expect(Buffer.from(call.where.guid).toString("hex")).toBe("ab".repeat(32));

    // create payload
    expect(call.create.status).toBe("sent");
    expect(call.create.srcEid).toBe(30101);
    expect(call.create.dstEid).toBe(30110);
    expect(call.create.nonce).toBe(BigInt(42));
    expect(Buffer.from(call.create.sender).toString("hex")).toBe("11".repeat(20));
    expect(Buffer.from(call.create.receiver).toString("hex")).toBe("22".repeat(20));
    expect(call.create.sentBlockNumber).toBe(BigInt(100_000));
    expect(call.create.sentAt).toEqual(new Date(NOW_S * 1000));
    expect(Buffer.from(call.create.sentTxHash).toString("hex")).toBe("ff".repeat(32));

    // update is empty (idempotent)
    expect(call.update).toEqual({});
  });

  // ── PacketVerified ────────────────────────────────────────

  it("PacketVerified matches existing message", async () => {
    const msg = fakeMessage();
    mockPrisma.message.findFirst.mockResolvedValue(msg);

    const event = makeVerifiedEvent();
    await engine.processEvent(event);

    // chain_events INSERT + dvn_verification INSERT = 2 raw SQL calls
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);

    // Updates message status to "verified"
    expect(mockPrisma.message.update).toHaveBeenCalledOnce();
    const updateArgs = mockPrisma.message.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe("verified");
    expect(updateArgs.data.firstVerifiedAt).toEqual(
      new Date(event.block_timestamp * 1000),
    );
    expect(updateArgs.data.verificationLatencyS).toBe(60);

    // Should NOT buffer
    expect(mockRedis.zadd).not.toHaveBeenCalled();
  });

  it("PacketVerified buffers when no matching message", async () => {
    mockPrisma.message.findFirst.mockResolvedValue(null);

    const event = makeVerifiedEvent();
    await engine.processEvent(event);

    expect(mockRedis.zadd).toHaveBeenCalledOnce();
    expect(mockRedis.zadd).toHaveBeenCalledWith(
      "pending:events",
      event.block_timestamp,
      JSON.stringify(event),
    );

    // Only chain_events INSERT, no dvn_verification INSERT
    expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
  });

  it("PacketVerified does not update status if already verified", async () => {
    const msg = fakeMessage({ status: "verified" });
    mockPrisma.message.findFirst.mockResolvedValue(msg);

    const event = makeVerifiedEvent();
    await engine.processEvent(event);

    // dvn_verification INSERT still happens (multiple DVNs can verify)
    // chain_events INSERT + dvn_verification INSERT = 2 raw SQL calls
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);

    // But message status update should NOT happen
    expect(mockPrisma.message.update).not.toHaveBeenCalled();
  });

  // ── PacketDelivered ───────────────────────────────────────

  it("PacketDelivered matches existing message", async () => {
    const msg = fakeMessage();
    mockPrisma.message.findFirst.mockResolvedValue(msg);

    const event = makeDeliveredEvent();
    await engine.processEvent(event);

    expect(mockPrisma.message.update).toHaveBeenCalledOnce();
    const updateArgs = mockPrisma.message.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe("delivered");
    expect(updateArgs.data.deliveredAt).toEqual(
      new Date(event.block_timestamp * 1000),
    );
    expect(updateArgs.data.deliveryLatencyS).toBe(120); // 120s difference
    expect(Buffer.from(updateArgs.data.deliveredTxHash).toString("hex")).toBe(
      "ff".repeat(32),
    );

    // Should NOT buffer
    expect(mockRedis.zadd).not.toHaveBeenCalled();
  });

  it("PacketDelivered buffers when no matching message", async () => {
    mockPrisma.message.findFirst.mockResolvedValue(null);

    const event = makeDeliveredEvent();
    await engine.processEvent(event);

    expect(mockRedis.zadd).toHaveBeenCalledOnce();
    expect(mockRedis.zadd).toHaveBeenCalledWith(
      "pending:events",
      event.block_timestamp,
      JSON.stringify(event),
    );

    expect(mockPrisma.message.update).not.toHaveBeenCalled();
  });

  // ── Buffer overflow ───────────────────────────────────────

  it("buffer respects 10K cap", async () => {
    mockRedis.zcard.mockResolvedValue(10_000);
    mockPrisma.message.findFirst.mockResolvedValue(null);

    const event = makeVerifiedEvent();
    await engine.processEvent(event);

    expect(mockRedis.zadd).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    expect(mockLogger.warn.mock.calls[0][1]).toMatch(/overflow/i);
  });

  // ── retryPendingEvents ────────────────────────────────────

  it("retryPendingEvents matches previously buffered event", async () => {
    const event = makeVerifiedEvent();
    const eventJson = JSON.stringify(event);
    mockRedis.zrangebyscore.mockResolvedValue([eventJson]);

    const msg = fakeMessage();
    mockPrisma.message.findFirst.mockResolvedValue(msg);

    await engine.retryPendingEvents();

    // Should have matched the verification (dvn_verification INSERT via $executeRaw)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();

    // Should have removed from the pending set
    expect(mockRedis.zrem).toHaveBeenCalledWith("pending:events", eventJson);
  });

  it("retryPendingEvents expires old events", async () => {
    const oldTimestamp = NOW_S - 21_601; // older than 6 hours (PENDING_TTL_S)
    const event = makeVerifiedEvent({ block_timestamp: oldTimestamp });
    const eventJson = JSON.stringify(event);
    mockRedis.zrangebyscore.mockResolvedValue([eventJson]);

    await engine.retryPendingEvents();

    // Expired event removed from set
    expect(mockRedis.zrem).toHaveBeenCalledWith("pending:events", eventJson);

    // No match attempted — no prisma calls for this event
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.message.findFirst).not.toHaveBeenCalled();
  });
});
