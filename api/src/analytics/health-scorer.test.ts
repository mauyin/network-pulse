import { describe, expect, it, vi } from "vitest";
import { HealthScorer } from "./health-scorer.js";

const mockPrisma = { $queryRaw: vi.fn() } as any;
const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  setex: vi.fn().mockResolvedValue("OK"),
} as any;

function createScorer() {
  vi.clearAllMocks();
  // Re-apply default mocks after clearAllMocks
  mockRedis.get.mockResolvedValue(null);
  mockRedis.setex.mockResolvedValue("OK");
  return new HealthScorer(mockPrisma, mockRedis);
}

describe("HealthScorer.getPathwayHealth", () => {
  it("scores a perfect pathway as healthy", async () => {
    const scorer = createScorer();

    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        total: BigInt(100),
        verified: BigInt(100),
        delivered: BigInt(100),
        avg_latency: 10,
        stddev_latency: 2,
      },
    ]);

    const result = await scorer.getPathwayHealth(30101, 30102);

    // availability = 100/100 = 1.0
    // performance = 1 - min(10/300, 1) = 1 - 0.0333 = 0.9667
    // cv = 2/10 = 0.2, consistency = 1/(1+0.2) = 0.8333
    // score = round((0.4*1.0 + 0.3*0.9667 + 0.3*0.8333) * 100)
    //       = round((0.4 + 0.29 + 0.25) * 100) = round(94.0) = 94
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.status).toBe("healthy");
    expect(result.totalMessages).toBe(100);
    expect(result.verifiedMessages).toBe(100);
    expect(result.deliveredMessages).toBe(100);
    expect(result.srcEid).toBe(30101);
    expect(result.dstEid).toBe(30102);
  });

  it("scores a degraded pathway", async () => {
    const scorer = createScorer();

    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        total: BigInt(100),
        verified: BigInt(60),
        delivered: BigInt(50),
        avg_latency: 150,
        stddev_latency: 80,
      },
    ]);

    const result = await scorer.getPathwayHealth(30101, 30110);

    // availability = 60/100 = 0.6
    // performance = 1 - min(150/300, 1) = 1 - 0.5 = 0.5
    // cv = 80/150 = 0.5333, consistency = 1/(1+0.5333) = 0.6522
    // score = round((0.4*0.6 + 0.3*0.5 + 0.3*0.6522) * 100)
    //       = round((0.24 + 0.15 + 0.1957) * 100) = round(58.57) = 59
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThan(80);
    expect(result.status).toBe("degraded");
  });

  it("scores a critical pathway", async () => {
    const scorer = createScorer();

    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        total: BigInt(100),
        verified: BigInt(20),
        delivered: BigInt(10),
        avg_latency: 280,
        stddev_latency: 100,
      },
    ]);

    const result = await scorer.getPathwayHealth(30101, 30111);

    // availability = 20/100 = 0.2
    // performance = 1 - min(280/300, 1) = 1 - 0.9333 = 0.0667
    // cv = 100/280 = 0.3571, consistency = 1/(1+0.3571) = 0.7368
    // score = round((0.4*0.2 + 0.3*0.0667 + 0.3*0.7368) * 100)
    //       = round((0.08 + 0.02 + 0.221) * 100) = round(32.1) = 32
    expect(result.score).toBeLessThan(50);
    expect(result.status).toBe("critical");
  });

  it("returns unknown status with score 0 when total messages is 0", async () => {
    const scorer = createScorer();

    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        total: BigInt(0),
        verified: BigInt(0),
        delivered: BigInt(0),
        avg_latency: null,
        stddev_latency: null,
      },
    ]);

    const result = await scorer.getPathwayHealth(30101, 30112);

    // No messages at all → score 0, status unknown
    expect(result.score).toBe(0);
    expect(result.status).toBe("unknown");
    expect(result.totalMessages).toBe(0);
  });

  it("handles zero latency — performance and consistency are unknown", async () => {
    const scorer = createScorer();

    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        total: BigInt(50),
        verified: BigInt(50),
        delivered: BigInt(50),
        avg_latency: 0,
        stddev_latency: 0,
      },
    ]);

    const result = await scorer.getPathwayHealth(30101, 30113);

    // availability = 50/50 = 1.0
    // hasLatencyData = false (avgLatency is 0)
    // performance = 0, consistency = 0
    // score = round((0.4*1.0 + 0.3*0 + 0.3*0) * 100) = 40
    expect(result.score).toBe(40);
    expect(result.status).toBe("critical");
    expect(result.avgLatencyS).toBe(0);
  });

  it("scores 0 on cold start — messages sent but none verified", async () => {
    const scorer = createScorer();

    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        total: BigInt(50),
        verified: BigInt(0),
        delivered: BigInt(0),
        avg_latency: null,
        stddev_latency: null,
      },
    ]);

    const result = await scorer.getPathwayHealth(30101, 30184);

    // availability = 0/50 = 0, hasLatencyData = false
    // performance = 0, consistency = 0
    // score = round((0.4*0 + 0.3*0 + 0.3*0) * 100) = 0
    expect(result.score).toBe(0);
    expect(result.status).toBe("critical");
    expect(result.totalMessages).toBe(50);
    expect(result.verifiedMessages).toBe(0);
  });

  it("bypasses cache on miss and writes result to cache", async () => {
    const scorer = createScorer();

    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        total: BigInt(10),
        verified: BigInt(10),
        delivered: BigInt(10),
        avg_latency: 50,
        stddev_latency: 5,
      },
    ]);

    await scorer.getPathwayHealth(30101, 30102);

    // Cache miss: redis.get was called and returned null
    expect(mockRedis.get).toHaveBeenCalledOnce();
    // Result was cached via setex
    expect(mockRedis.setex).toHaveBeenCalledOnce();
    expect(mockRedis.setex.mock.calls[0][0]).toContain("pathway-health");
  });
});

describe("health score breakdown", () => {
  it("includes breakdown components in response", async () => {
    const scorer = createScorer();
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        total: BigInt(100),
        verified: BigInt(100),
        delivered: BigInt(100),
        avg_latency: 10,
        stddev_latency: 2,
      },
    ]);

    const result = await scorer.getPathwayHealth(30101, 30110);
    expect(result.breakdown).toBeDefined();
    expect(result.breakdown.availability).toHaveProperty("value");
    expect(result.breakdown.availability).toHaveProperty("raw");
    expect(result.breakdown.availability).toHaveProperty("weight");
    expect(result.breakdown.performance).toHaveProperty("value");
    expect(result.breakdown.consistency).toHaveProperty("value");
  });

  it("returns correct breakdown values for known data", async () => {
    const scorer = createScorer();
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        total: BigInt(10),
        verified: BigInt(8),
        delivered: BigInt(6),
        avg_latency: 60,
        stddev_latency: 10,
      },
    ]);

    const result = await scorer.getPathwayHealth(30101, 30110);
    expect(result.breakdown.availability.value).toBe(80);
    expect(result.breakdown.availability.raw).toBe("8/10");
    expect(result.sampleSize).toBe(10);
    expect(result.windowHours).toBe(24);
  });

  it("returns zero breakdown for pathway with no messages", async () => {
    const scorer = createScorer();
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        total: BigInt(0),
        verified: BigInt(0),
        delivered: BigInt(0),
        avg_latency: null,
        stddev_latency: null,
      },
    ]);

    const result = await scorer.getPathwayHealth(30101, 30102);
    expect(result.breakdown.availability.value).toBe(0);
    expect(result.breakdown.performance.value).toBe(0);
    expect(result.breakdown.consistency.value).toBe(0);
    expect(result.sampleSize).toBe(0);
  });
});
