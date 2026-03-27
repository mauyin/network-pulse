import { describe, expect, it, vi } from "vitest";
import { AnomalyDetector } from "./anomaly-detector.js";

const mockPrisma = { $queryRaw: vi.fn() } as any;
const mockLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as any;

function createDetector() {
  vi.clearAllMocks();
  return new AnomalyDetector(mockPrisma, mockLogger);
}

describe("AnomalyDetector.checkPathwayAnomaly", () => {
  it("returns cold start result when count < MIN_SAMPLES", async () => {
    const detector = createDetector();

    // Baseline: count below threshold
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { avg: 100, stddev: 10, count: BigInt(5) },
    ]);

    const result = await detector.checkPathwayAnomaly(30101, 30102);

    expect(result.isAnomaly).toBe(false);
    expect(result.zScore).toBe(0);
    expect(result.currentValue).toBe(0);
    expect(result.mean).toBe(0);
    expect(result.stddev).toBe(0);
    expect(result.sampleSize).toBe(5);
    // Should not have queried for recent data
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns cold start result when avg is null", async () => {
    const detector = createDetector();

    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { avg: null, stddev: null, count: BigInt(20) },
    ]);

    const result = await detector.checkPathwayAnomaly(30101, 30102);

    expect(result.isAnomaly).toBe(false);
    expect(result.zScore).toBe(0);
    expect(result.sampleSize).toBe(20);
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("detects normal (non-anomalous) latency", async () => {
    const detector = createDetector();

    // Baseline: avg=100, stddev=10, count=50
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { avg: 100, stddev: 10, count: BigInt(50) },
    ]);
    // Recent: avg=105 → z = (105-100)/10 = 0.5
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ avg: 105 }]);

    const result = await detector.checkPathwayAnomaly(30101, 30102);

    expect(result.isAnomaly).toBe(false);
    expect(result.zScore).toBe(0.5);
    expect(result.currentValue).toBe(105);
    expect(result.mean).toBe(100);
    expect(result.stddev).toBe(10);
    expect(result.sampleSize).toBe(50);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("detects anomalous high latency", async () => {
    const detector = createDetector();

    // Baseline: avg=100, stddev=10, count=50
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { avg: 100, stddev: 10, count: BigInt(50) },
    ]);
    // Recent: avg=140 → z = (140-100)/10 = 4.0 (> 3.0 threshold)
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ avg: 140 }]);

    const result = await detector.checkPathwayAnomaly(30101, 30102);

    expect(result.isAnomaly).toBe(true);
    expect(result.zScore).toBe(4);
    expect(result.currentValue).toBe(140);
    expect(mockLogger.warn).toHaveBeenCalledOnce();
  });

  it("detects negative anomaly (abnormally low latency)", async () => {
    const detector = createDetector();

    // Baseline: avg=100, stddev=10, count=50
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { avg: 100, stddev: 10, count: BigInt(50) },
    ]);
    // Recent: avg=60 → z = (60-100)/10 = -4.0 (|z| > 3.0)
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ avg: 60 }]);

    const result = await detector.checkPathwayAnomaly(30101, 30102);

    expect(result.isAnomaly).toBe(true);
    expect(result.zScore).toBe(-4);
    expect(result.currentValue).toBe(60);
    expect(mockLogger.warn).toHaveBeenCalledOnce();
  });

  it("handles zero stddev with EPSILON guard (no division by zero)", async () => {
    const detector = createDetector();

    // Baseline: avg=100, stddev=0, count=50
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { avg: 100, stddev: 0, count: BigInt(50) },
    ]);
    // Recent: avg=150 — normally huge z, but stddev < EPSILON → z = 0
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ avg: 150 }]);

    const result = await detector.checkPathwayAnomaly(30101, 30102);

    expect(result.isAnomaly).toBe(false);
    expect(result.zScore).toBe(0);
    expect(result.currentValue).toBe(150);
    expect(result.stddev).toBe(0);
  });

  it("falls back to baseline avg when recent avg is null", async () => {
    const detector = createDetector();

    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { avg: 100, stddev: 10, count: BigInt(50) },
    ]);
    // Recent returns null (no data in last 10 min)
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ avg: null }]);

    const result = await detector.checkPathwayAnomaly(30101, 30102);

    // currentValue falls back to mean → z = 0
    expect(result.isAnomaly).toBe(false);
    expect(result.zScore).toBe(0);
    expect(result.currentValue).toBe(100);
  });
});
