import { describe, expect, it, vi, beforeEach } from "vitest";
import { ReputationScorer } from "./reputation-scorer.js";

// ── Mocks ───────────────────────────────────────────────────

const mockPrisma = {
  $queryRaw: vi.fn(),
} as any;

const mockRedis = {
  get: vi.fn().mockResolvedValue(null), // no cache hits
  setex: vi.fn().mockResolvedValue("OK"),
} as any;

function createScorer() {
  vi.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  return new ReputationScorer(mockPrisma, mockRedis);
}

const DVN_BUF = Buffer.from("dd".repeat(20), "hex") as Uint8Array<ArrayBuffer>;

describe("ReputationScorer", () => {
  let scorer: ReputationScorer;

  beforeEach(() => {
    scorer = createScorer();
  });

  it("computes scores for all 3 windows (7/30/90 days)", async () => {
    // Promise.all interleaves: all stats queries fire, then all total queries.
    // Mock order: stats-7, stats-30, stats-90, total-7, total-30, total-90
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([
        { verification_count: 100n, avg_latency: 30, stddev_latency: 5, pathway_count: 3n },
      ]) // 7-day stats
      .mockResolvedValueOnce([
        { verification_count: 400n, avg_latency: 35, stddev_latency: 8, pathway_count: 5n },
      ]) // 30-day stats
      .mockResolvedValueOnce([
        { verification_count: 1200n, avg_latency: 40, stddev_latency: 10, pathway_count: 7n },
      ]) // 90-day stats
      .mockResolvedValueOnce([{ total: 120n }]) // 7-day total messages
      .mockResolvedValueOnce([{ total: 500n }]) // 30-day total messages
      .mockResolvedValueOnce([{ total: 1500n }]); // 90-day total messages

    const result = await scorer.getDvnReputation(DVN_BUF);

    expect(result.scores).toHaveLength(3);
    expect(result.scores[0].windowDays).toBe(7);
    expect(result.scores[1].windowDays).toBe(30);
    expect(result.scores[2].windowDays).toBe(90);

    // All scores should be 0-100
    for (const s of result.scores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }

    expect(result.address).toBe("0x" + "dd".repeat(20));
  });

  it("high reliability DVN gets high score", async () => {
    // DVN verifies almost every message, low latency, consistent
    // Mock order: stats-7, stats-30, stats-90, total-7, total-30, total-90
    const goodStats = { verification_count: 100n, avg_latency: 10, stddev_latency: 2, pathway_count: 8n };
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([goodStats])
      .mockResolvedValueOnce([goodStats])
      .mockResolvedValueOnce([goodStats])
      .mockResolvedValueOnce([{ total: 105n }])
      .mockResolvedValueOnce([{ total: 105n }])
      .mockResolvedValueOnce([{ total: 105n }]);

    const result = await scorer.getDvnReputation(DVN_BUF);

    // reliability = 100/105 ≈ 0.95
    // performance = 1 - min(10/300, 1) ≈ 0.97
    // consistency = 1/(1+2/10) ≈ 0.83
    // coverage = min(8/10, 1) = 0.8
    // score ≈ (0.35*0.95 + 0.30*0.97 + 0.20*0.83 + 0.15*0.8)*100 ≈ 90
    const s7 = result.scores[0];
    expect(s7.score).toBeGreaterThanOrEqual(80);
    expect(s7.reliability).toBeGreaterThan(0.9);
    expect(s7.performance).toBeGreaterThan(0.9);
  });

  it("cold start DVN gets score 0", async () => {
    // No verification data at all
    // Mock order: stats-7, stats-30, stats-90, total-7, total-30, total-90
    const emptyStats = { verification_count: 0n, avg_latency: null, stddev_latency: null, pathway_count: 0n };
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([emptyStats])  // stats-7
      .mockResolvedValueOnce([emptyStats])  // stats-30
      .mockResolvedValueOnce([emptyStats])  // stats-90
      .mockResolvedValueOnce([{ total: 0n }])  // total-7
      .mockResolvedValueOnce([{ total: 0n }])  // total-30
      .mockResolvedValueOnce([{ total: 0n }]);  // total-90

    const result = await scorer.getDvnReputation(DVN_BUF);

    for (const s of result.scores) {
      expect(s.score).toBe(0);
      expect(s.verificationCount).toBe(0);
      expect(s.reliability).toBe(0);
      expect(s.performance).toBe(0);
      expect(s.consistency).toBe(0);
      expect(s.coverage).toBe(0);
    }
  });

  it("trend is 'improving' when 7-day score > 30-day score by >5", async () => {
    // Promise.all interleaves: all stats queries fire, then all total queries.
    // Mock order: stats-7, stats-30, stats-90, total-7, total-30, total-90
    mockPrisma.$queryRaw
      // stats-7: perfect reliability, low latency, good coverage
      .mockResolvedValueOnce([
        { verification_count: 100n, avg_latency: 5, stddev_latency: 1, pathway_count: 10n },
      ])
      // stats-30: poor reliability, high latency, low coverage
      .mockResolvedValueOnce([
        { verification_count: 50n, avg_latency: 200, stddev_latency: 80, pathway_count: 2n },
      ])
      // stats-90: moderate
      .mockResolvedValueOnce([
        { verification_count: 300n, avg_latency: 50, stddev_latency: 20, pathway_count: 5n },
      ])
      // total-7
      .mockResolvedValueOnce([{ total: 100n }])
      // total-30
      .mockResolvedValueOnce([{ total: 500n }])
      // total-90
      .mockResolvedValueOnce([{ total: 600n }]);

    const result = await scorer.getDvnReputation(DVN_BUF);
    // 7-day score should be much higher than 30-day
    expect(result.scores[0].score).toBeGreaterThan(result.scores[1].score + 5);
    expect(result.trend).toBe("improving");
  });

  it("trend is 'declining' when 7-day score < 30-day score by >5", async () => {
    // Promise.all interleaves: all stats queries fire, then all total queries.
    // Mock order: stats-7, stats-30, stats-90, total-7, total-30, total-90
    mockPrisma.$queryRaw
      // stats-7: poor reliability (5/500=1%), very high latency
      .mockResolvedValueOnce([
        { verification_count: 5n, avg_latency: 250, stddev_latency: 100, pathway_count: 1n },
      ])
      // stats-30: excellent reliability (950/1000), low latency
      .mockResolvedValueOnce([
        { verification_count: 950n, avg_latency: 10, stddev_latency: 2, pathway_count: 10n },
      ])
      // stats-90: same as 30-day
      .mockResolvedValueOnce([
        { verification_count: 950n, avg_latency: 10, stddev_latency: 2, pathway_count: 10n },
      ])
      // total-7
      .mockResolvedValueOnce([{ total: 500n }])
      // total-30
      .mockResolvedValueOnce([{ total: 1000n }])
      // total-90
      .mockResolvedValueOnce([{ total: 1000n }]);

    const result = await scorer.getDvnReputation(DVN_BUF);
    // 7-day score should be much lower than 30-day
    expect(result.scores[0].score).toBeLessThan(result.scores[1].score - 5);
    expect(result.trend).toBe("declining");
  });

  it("results are cached with 30-minute TTL", async () => {
    // Mock order: stats-7, stats-30, stats-90, total-7, total-30, total-90
    const stats = { verification_count: 50n, avg_latency: 20, stddev_latency: 5, pathway_count: 3n };
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([stats])  // stats-7
      .mockResolvedValueOnce([stats])  // stats-30
      .mockResolvedValueOnce([stats])  // stats-90
      .mockResolvedValueOnce([{ total: 60n }])  // total-7
      .mockResolvedValueOnce([{ total: 60n }])  // total-30
      .mockResolvedValueOnce([{ total: 60n }]);  // total-90

    await scorer.getDvnReputation(DVN_BUF);

    // Redis setex called with 30min TTL
    expect(mockRedis.setex).toHaveBeenCalledOnce();
    const ttl = mockRedis.setex.mock.calls[0][1];
    expect(ttl).toBe(1800); // 30 minutes
  });
});
