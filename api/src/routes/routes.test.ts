import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { alertRoutes } from "./alerts.js";
import { messageRoutes } from "./messages.js";
import { auditRoutes } from "./audit.js";
import { pathwayRoutes } from "./pathways.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuf(hexChar: string, bytes = 32): Uint8Array<ArrayBuffer> {
  return Buffer.from(hexChar.repeat(bytes), "hex") as Uint8Array<ArrayBuffer>;
}

function buildApp(mockPrisma: any): FastifyInstance {
  const app = Fastify();
  app.register(alertRoutes, { prisma: mockPrisma });
  app.register(messageRoutes, { prisma: mockPrisma });
  // auditRoutes creates ConfigScorer internally — we only test validation here
  app.register(auditRoutes, { prisma: mockPrisma });
  return app;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    alert: {
      findMany: vi.fn(),
    },
    message: {
      findUnique: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Alert routes — GET /alerts", () => {
  let app: FastifyInstance;
  let prisma: ReturnType<typeof createMockPrisma>;

  afterEach(async () => {
    await app.close();
  });

  it("returns list of alerts with hex-converted addresses and ISO timestamps", async () => {
    prisma = createMockPrisma();
    app = buildApp(prisma);

    const now = new Date("2026-03-17T10:00:00Z");
    const resolvedAt = new Date("2026-03-17T11:00:00Z");

    prisma.alert.findMany.mockResolvedValue([
      {
        id: 1n,
        alertType: "LATENCY_SPIKE",
        severity: "warning",
        srcEid: 30101,
        dstEid: 30110,
        dvnAddress: makeBuf("aa", 20),
        messageGuid: makeBuf("bb"),
        reason: "DVN latency exceeded threshold",
        metadata: { latencyS: 300 },
        isActive: true,
        createdAt: now,
        resolvedAt: null,
      },
      {
        id: 2n,
        alertType: "VERIFICATION_MISS",
        severity: "critical",
        srcEid: 30101,
        dstEid: 30111,
        dvnAddress: null,
        messageGuid: null,
        reason: "Message not verified within SLA",
        metadata: {},
        isActive: false,
        createdAt: now,
        resolvedAt: resolvedAt,
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/alerts" });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    const alerts = body.data;
    expect(alerts).toHaveLength(2);

    // First alert — has dvnAddress and messageGuid buffers
    expect(alerts[0].id).toBe(1);
    expect(alerts[0].alertType).toBe("LATENCY_SPIKE");
    expect(alerts[0].dvnAddress).toBe("0x" + "aa".repeat(20));
    expect(alerts[0].messageGuid).toBe("0x" + "bb".repeat(32));
    expect(alerts[0].createdAt).toBe(now.toISOString());
    expect(alerts[0].resolvedAt).toBeNull();

    // Second alert — null dvnAddress and messageGuid
    expect(alerts[1].id).toBe(2);
    expect(alerts[1].dvnAddress).toBeNull();
    expect(alerts[1].messageGuid).toBeNull();
    expect(alerts[1].resolvedAt).toBe(resolvedAt.toISOString());
  });

  it("filters by active=true", async () => {
    prisma = createMockPrisma();
    app = buildApp(prisma);
    prisma.alert.findMany.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/alerts?active=true" });

    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
  });

  it("filters by severity=critical", async () => {
    prisma = createMockPrisma();
    app = buildApp(prisma);
    prisma.alert.findMany.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/alerts?severity=critical" });

    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ severity: "critical" }),
      }),
    );
  });

  it("respects limit parameter", async () => {
    prisma = createMockPrisma();
    app = buildApp(prisma);
    prisma.alert.findMany.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/alerts?limit=10" });

    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });
});

describe("Message routes — GET /messages/:guid/timeline", () => {
  let app: FastifyInstance;
  let prisma: ReturnType<typeof createMockPrisma>;

  afterEach(async () => {
    await app.close();
  });

  it("returns timeline with Sent, Verified, and Delivered events sorted by timestamp", async () => {
    prisma = createMockPrisma();
    app = buildApp(prisma);

    const guidHex = "ab".repeat(32);
    const guidWithPrefix = "0x" + guidHex;

    const sentAt = new Date("2026-03-17T10:00:00Z");
    const verifiedAt = new Date("2026-03-17T10:00:45Z");
    const deliveredAt = new Date("2026-03-17T10:02:00Z");

    prisma.message.findUnique.mockResolvedValue({
      guid: makeBuf("ab"),
      srcEid: 30101,
      dstEid: 30110,
      sender: makeBuf("cc"),
      receiver: makeBuf("dd"),
      nonce: 42n,
      status: "DELIVERED",
      sentAt,
      sentBlockNumber: 12345678n,
      sentTxHash: makeBuf("ee"),
      firstVerifiedAt: verifiedAt,
      verificationLatencyS: 45,
      deliveredAt,
      deliveredTxHash: makeBuf("ff"),
      deliveryLatencyS: 120,
      verifications: [
        {
          verifiedAt,
          txHash: makeBuf("11"),
          dvnAddress: makeBuf("22", 20),
          verificationLatencyS: 45,
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/messages/${guidWithPrefix}/timeline`,
    });

    expect(res.statusCode).toBe(200);

    const body = res.json().data;
    expect(body.guid).toBe(guidWithPrefix);
    expect(body.srcEid).toBe(30101);
    expect(body.dstEid).toBe(30110);
    expect(body.sender).toBe("0x" + "cc".repeat(32));
    expect(body.receiver).toBe("0x" + "dd".repeat(32));
    expect(body.nonce).toBe(42);
    expect(body.status).toBe("DELIVERED");

    // Timeline should have 3 events sorted by timestamp
    expect(body.timeline).toHaveLength(3);
    expect(body.timeline[0].event).toBe("PacketSent");
    expect(body.timeline[0].timestamp).toBe(sentAt.toISOString());
    expect(body.timeline[0].txHash).toBe("0x" + "ee".repeat(32));

    expect(body.timeline[1].event).toBe("PacketVerified");
    expect(body.timeline[1].timestamp).toBe(verifiedAt.toISOString());
    expect(body.timeline[1].txHash).toBe("0x" + "11".repeat(32));
    expect(body.timeline[1].dvnAddress).toBe("0x" + "22".repeat(20));
    expect(body.timeline[1].latencyS).toBe(45);

    expect(body.timeline[2].event).toBe("PacketDelivered");
    expect(body.timeline[2].timestamp).toBe(deliveredAt.toISOString());
    expect(body.timeline[2].latencyS).toBe(120);
  });

  it("returns 404 for unknown message GUID", async () => {
    prisma = createMockPrisma();
    app = buildApp(prisma);
    prisma.message.findUnique.mockResolvedValue(null);

    const unknownGuid = "0x" + "00".repeat(32);
    const res = await app.inject({
      method: "GET",
      url: `/messages/${unknownGuid}/timeline`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Message not found" });
  });

  it("returns 400 for invalid GUID format", async () => {
    prisma = createMockPrisma();
    app = buildApp(prisma);

    const res = await app.inject({
      method: "GET",
      url: "/messages/not-a-hex-guid/timeline",
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("Audit routes — POST /audit", () => {
  let app: FastifyInstance;
  let prisma: ReturnType<typeof createMockPrisma>;

  afterEach(async () => {
    await app.close();
  });

  it("returns 400 for invalid oappAddress format", async () => {
    prisma = createMockPrisma();
    app = buildApp(prisma);

    const res = await app.inject({
      method: "POST",
      url: "/audit",
      payload: {
        oappAddress: "not-an-address",
        srcEid: 30101,
        dstEid: 30110,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid OApp address format" });
  });

  it("returns 400 for unsupported srcEid", async () => {
    prisma = createMockPrisma();
    app = buildApp(prisma);

    const res = await app.inject({
      method: "POST",
      url: "/audit",
      payload: {
        oappAddress: "0x" + "ab".repeat(20),
        srcEid: 99999,
        dstEid: 30110,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Unsupported source EID: 99999" });
  });

  it("returns 400 for missing required fields", async () => {
    prisma = createMockPrisma();
    app = buildApp(prisma);

    const res = await app.inject({
      method: "POST",
      url: "/audit",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("Pathway routes — GET /pathways/:srcEid/:dstEid/dvns", () => {
  let app: FastifyInstance;
  let prisma: any;
  let redis: any;

  afterEach(async () => {
    await app.close();
  });

  function buildPathwayApp(mockPrisma: any, mockRedis: any): FastifyInstance {
    const a = Fastify();
    a.register(pathwayRoutes, { prisma: mockPrisma, redis: mockRedis });
    return a;
  }

  function createMockRedis() {
    return {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue("OK"),
    };
  }

  it("returns DVN list with correct shape", async () => {
    prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          dvn_address: makeBuf("aa", 20),
          name: "LayerZero Labs",
          verification_count: 150,
          avg_latency: 42.567,
          p50: 38.2,
          p95: 95.7,
          last_seen: new Date("2026-03-17T12:00:00Z"),
        },
        {
          dvn_address: makeBuf("bb", 20),
          name: null,
          verification_count: 80,
          avg_latency: 55.123,
          p50: 50.0,
          p95: 120.3,
          last_seen: new Date("2026-03-17T11:30:00Z"),
        },
      ]),
    };
    redis = createMockRedis();
    app = buildPathwayApp(prisma, redis);

    const res = await app.inject({
      method: "GET",
      url: "/pathways/30101/30110/dvns",
    });

    expect(res.statusCode).toBe(200);

    const body = res.json().data;
    expect(body).toHaveLength(2);

    expect(body[0].address).toBe("0x" + "aa".repeat(20));
    expect(body[0].name).toBe("LayerZero Labs");
    expect(body[0].verificationCount).toBe(150);
    expect(body[0].avgLatencyS).toBe(42.57);
    expect(body[0].p50LatencyS).toBe(38.2);
    expect(body[0].p95LatencyS).toBe(95.7);
    expect(body[0].lastSeen).toBe("2026-03-17T12:00:00.000Z");

    expect(body[1].address).toBe("0x" + "bb".repeat(20));
    expect(body[1].name).toBeNull();
  });

  it("returns 400 for unsupported EID", async () => {
    prisma = { $queryRaw: vi.fn() };
    redis = createMockRedis();
    app = buildPathwayApp(prisma, redis);

    const res = await app.inject({
      method: "GET",
      url: "/pathways/99999/30110/dvns",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Unsupported EID" });
  });

  it("returns empty array when no DVN data exists", async () => {
    prisma = { $queryRaw: vi.fn().mockResolvedValue([]) };
    redis = createMockRedis();
    app = buildPathwayApp(prisma, redis);

    const res = await app.inject({
      method: "GET",
      url: "/pathways/30101/30110/dvns",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("GET /pathways returns pathway list with breakdown fields", async () => {
    prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          src_eid: 30101,
          dst_eid: 30110,
          total: BigInt(100),
          verified: BigInt(90),
          delivered: BigInt(80),
          avg_latency: 42.5,
          stddev_latency: 8.5,
          newest_message: new Date(),
        },
      ]),
    };
    redis = createMockRedis();
    app = buildPathwayApp(prisma, redis);

    const res = await app.inject({
      method: "GET",
      url: "/pathways",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body).toHaveLength(1);
    expect(body[0].breakdown).toBeDefined();
    expect(body[0].breakdown.availability).toHaveProperty("value");
    expect(body[0].breakdown.availability).toHaveProperty("raw");
    expect(body[0].breakdown.availability).toHaveProperty("weight");
    expect(body[0].breakdown.performance).toBeDefined();
    expect(body[0].breakdown.consistency).toBeDefined();
    expect(body[0].sampleSize).toBeTypeOf("number");
    expect(body[0].windowHours).toBe(24);
    expect(body[0].confidence).toBeDefined();
    expect(body[0].confidence.level).toBeTypeOf("string");
  });

  it("returns cached result on second call", async () => {
    const cachedData = JSON.stringify({
      data: [
        {
          address: "0x" + "aa".repeat(20),
          name: "LayerZero Labs",
          verificationCount: 150,
          avgLatencyS: 42.57,
          p50LatencyS: 38.2,
          p95LatencyS: 95.7,
          lastSeen: "2026-03-17T12:00:00.000Z",
        },
      ],
      cachedAt: "2026-03-17T12:00:00.000Z",
    });

    prisma = { $queryRaw: vi.fn() };
    redis = {
      get: vi.fn().mockResolvedValue(cachedData),
      setex: vi.fn(),
    };
    app = buildPathwayApp(prisma, redis);

    const res = await app.inject({
      method: "GET",
      url: "/pathways/30101/30110/dvns",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    // DB should NOT have been called — cache hit
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
