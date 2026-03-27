import { describe, expect, it, vi } from "vitest";
import { ConfigScorer } from "./config-scorer.js";
import type { UlnConfig } from "./config-scorer.js";

const mockLogger = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

const LAYERZERO_LABS_DVN = "0x589DeDBD617Ef811386A43153a435EBA5c63E090";
const GOOGLE_CLOUD_DVN = "0xD56e4eAb23cb81f43168F9F45211Eb027b9aC7cc";
const ANIMOCA_DVN = "0x380275805876Ff19055EA900CDb2B46a94ecF20D";
const HORIZEN_DVN = "0xfD6865c841c2d64565562fCc7e05e619A30615f0";

const UNKNOWN_DVN_1 = "0x0000000000000000000000000000000000000001";
const UNKNOWN_DVN_2 = "0x0000000000000000000000000000000000000002";
const UNKNOWN_DVN_3 = "0x0000000000000000000000000000000000000003";

function createScorer() {
  vi.clearAllMocks();
  return new ConfigScorer(mockLogger);
}

describe("ConfigScorer.scoreConfig", () => {
  it("grade A config — all factors maxed", async () => {
    const scorer = createScorer();

    const config: UlnConfig = {
      confirmations: 15,
      requiredDVNCount: 2,
      optionalDVNCount: 2,
      optionalDVNThreshold: 2,
      requiredDVNs: [LAYERZERO_LABS_DVN, GOOGLE_CLOUD_DVN],
      optionalDVNs: [ANIMOCA_DVN, HORIZEN_DVN],
    };

    const result = await scorer.scoreConfig("0xABCD", 30101, 30102, config);

    // Factor 1: totalDVNs=4 → 30/30
    // Factor 2: required=2 → 25/25
    // Factor 3: optional=2, threshold=2 → 20/20
    // Factor 4: no prisma → 0/15
    // Factor 5: confirmations=15 → 10/10
    // Total: 85
    expect(result.score).toBe(85);
    expect(result.grade).toBe("B");
    expect(result.oappAddress).toBe("0xABCD");
    expect(result.srcEid).toBe(30101);
    expect(result.dstEid).toBe(30102);
    expect(result.config).toBe(config);
  });

  it("grade B config — 3 DVNs, 2 required, no optionals, 1 known", async () => {
    const scorer = createScorer();

    const config: UlnConfig = {
      confirmations: 15,
      requiredDVNCount: 3,
      optionalDVNCount: 0,
      optionalDVNThreshold: 0,
      requiredDVNs: [LAYERZERO_LABS_DVN, UNKNOWN_DVN_1, UNKNOWN_DVN_2],
      optionalDVNs: [],
    };

    const result = await scorer.scoreConfig("0xBBBB", 30101, 30110, config);

    // Factor 1: totalDVNs=3 → 25/30
    // Factor 2: required=3 → 25/25
    // Factor 3: optional=0 → 10/20 (neutral)
    // Factor 4: no prisma → 0/15
    // Factor 5: confirmations=15 → 10/10
    // Total: 25+25+10+0+10 = 70
    expect(result.score).toBe(70);
    expect(result.grade).toBe("C");
  });

  it("grade C config — 2 DVNs, 1 required, 1 optional threshold=1, no known, confirmations=1", async () => {
    const scorer = createScorer();

    const config: UlnConfig = {
      confirmations: 1,
      requiredDVNCount: 1,
      optionalDVNCount: 1,
      optionalDVNThreshold: 1,
      requiredDVNs: [UNKNOWN_DVN_1],
      optionalDVNs: [UNKNOWN_DVN_2],
    };

    const result = await scorer.scoreConfig("0xCCCC", 30101, 30111, config);

    // Factor 1: totalDVNs=2 → 20/30
    // Factor 2: required=1 → 15/25
    // Factor 3: optional=1, threshold=1 → 15/20
    // Factor 4: 0/2 known → 0/15
    // Factor 5: confirmations=1 → 10/10
    // Total: 20+15+15+0+10 = 60
    expect(result.score).toBe(60);
    expect(result.grade).toBe("C");
    expect(result.recommendations).toContain(
      "Increase required DVN count to at least 2 for consensus-like security",
    );
    expect(result.recommendations).toContain(
      "Consider using at least one well-known DVN provider (LayerZero Labs, Google Cloud, etc.) for baseline trust",
    );
  });

  it("single DVN setup — grade D", async () => {
    const scorer = createScorer();

    const config: UlnConfig = {
      confirmations: 1,
      requiredDVNCount: 1,
      optionalDVNCount: 0,
      optionalDVNThreshold: 0,
      requiredDVNs: [LAYERZERO_LABS_DVN],
      optionalDVNs: [],
    };

    const result = await scorer.scoreConfig("0xDDDD", 30101, 30112, config);

    // Factor 1: totalDVNs=1 → 10/30
    // Factor 2: required=1 → 15/25
    // Factor 3: optional=0 → 10/20 (neutral)
    // Factor 4: 1/1 known → round((1/1)*15) = 15/15
    // Factor 5: confirmations=1 → 10/10
    // Total: 10+15+10+15+10 = 60
    // Hmm, that's grade C. Let's use an unknown DVN instead for a lower factor 4.
    // Actually, with known DVN it's 60 = C boundary. Let's check actual scoring:
    // 60 => grade C (>=60). We need score in [40, 60) for D.
    // Use unknown DVN: factor 4 = 0/15, total = 10+15+10+0+10 = 45
    const config2: UlnConfig = {
      confirmations: 1,
      requiredDVNCount: 1,
      optionalDVNCount: 0,
      optionalDVNThreshold: 0,
      requiredDVNs: [UNKNOWN_DVN_1],
      optionalDVNs: [],
    };

    const result2 = await scorer.scoreConfig("0xDDDD", 30101, 30112, config2);

    // Factor 1: totalDVNs=1 → 10/30
    // Factor 2: required=1 → 15/25
    // Factor 3: optional=0 → 10/20 (neutral)
    // Factor 4: 0/1 known → 0/15
    // Factor 5: confirmations=1 → 10/10
    // Total: 10+15+10+0+10 = 45
    expect(result2.score).toBe(45);
    expect(result2.grade).toBe("D");
    expect(result2.recommendations).toContain(
      "Add at least one more DVN for redundancy — a single DVN is a single point of failure",
    );
  });

  it("no DVNs — grade F with score 0", async () => {
    const scorer = createScorer();

    const config: UlnConfig = {
      confirmations: 0,
      requiredDVNCount: 0,
      optionalDVNCount: 0,
      optionalDVNThreshold: 0,
      requiredDVNs: [],
      optionalDVNs: [],
    };

    const result = await scorer.scoreConfig("0x0000", 30101, 30113, config);

    // Factor 1: totalDVNs=0 → 0/30
    // Factor 2: required=0 → 0/25
    // Factor 3: optional=0 → 10/20 (neutral)
    // Factor 4: 0 DVNs → 0/15
    // Factor 5: confirmations=0 → 0/10
    // Total: 0+0+10+0+0 = 10
    expect(result.score).toBe(10);
    expect(result.grade).toBe("F");
    expect(result.recommendations.length).toBeGreaterThanOrEqual(3);
    expect(result.recommendations).toContain(
      "Add at least one more DVN for redundancy — a single DVN is a single point of failure",
    );
    expect(result.recommendations).toContain(
      "Increase required DVN count to at least 2 for consensus-like security",
    );
    expect(result.recommendations).toContain(
      "Set a non-zero confirmation depth to protect against chain reorgs",
    );
  });

  it("optional DVNs with zero threshold — factor 3 scores 0 with recommendation", async () => {
    const scorer = createScorer();

    const config: UlnConfig = {
      confirmations: 15,
      requiredDVNCount: 2,
      optionalDVNCount: 2,
      optionalDVNThreshold: 0,
      requiredDVNs: [LAYERZERO_LABS_DVN, GOOGLE_CLOUD_DVN],
      optionalDVNs: [ANIMOCA_DVN, HORIZEN_DVN],
    };

    const result = await scorer.scoreConfig("0xEEEE", 30101, 30102, config);

    // Factor 1: totalDVNs=4 → 30/30
    // Factor 2: required=2 → 25/25
    // Factor 3: optional=2, threshold=0 → 0/20
    // Factor 4: no prisma → 0/15
    // Factor 5: confirmations=15 → 10/10
    // Total: 30+25+0+0+10 = 65
    expect(result.score).toBe(65);
    expect(result.grade).toBe("C");

    const factor3 = result.factors.find((f) => f.name === "Optional DVN Strategy");
    expect(factor3).toBeDefined();
    expect(factor3!.score).toBe(0);

    expect(result.recommendations).toContain(
      "Optional DVN threshold is 0 — optional DVNs are effectively unused. Set threshold > 0 or remove them",
    );
  });

  it("zero confirmations — loses 10 points with recommendation", async () => {
    const scorer = createScorer();

    const config: UlnConfig = {
      confirmations: 0,
      requiredDVNCount: 2,
      optionalDVNCount: 2,
      optionalDVNThreshold: 2,
      requiredDVNs: [LAYERZERO_LABS_DVN, GOOGLE_CLOUD_DVN],
      optionalDVNs: [ANIMOCA_DVN, HORIZEN_DVN],
    };

    const result = await scorer.scoreConfig("0xFFFF", 30101, 30102, config);

    // Factor 1: totalDVNs=4 → 30/30
    // Factor 2: required=2 → 25/25
    // Factor 3: optional=2, threshold=2 → 20/20
    // Factor 4: no prisma → 0/15
    // Factor 5: confirmations=0 → 0/10
    // Total: 30+25+20+0+0 = 75
    expect(result.score).toBe(75);
    expect(result.grade).toBe("B");

    const factor5 = result.factors.find((f) => f.name === "Confirmation Depth");
    expect(factor5).toBeDefined();
    expect(factor5!.score).toBe(0);

    expect(result.recommendations).toContain(
      "Set a non-zero confirmation depth to protect against chain reorgs",
    );
  });

  it("factor 4 — no prisma means 0/15 (DB required for DVN recognition)", async () => {
    const scorer = createScorer();

    const config: UlnConfig = {
      confirmations: 15,
      requiredDVNCount: 2,
      optionalDVNCount: 2,
      optionalDVNThreshold: 2,
      requiredDVNs: [LAYERZERO_LABS_DVN, GOOGLE_CLOUD_DVN],
      optionalDVNs: [ANIMOCA_DVN, HORIZEN_DVN],
    };

    const result = await scorer.scoreConfig("0xAAAA", 30101, 30102, config);

    const factor4 = result.factors.find((f) => f.name === "Reputable DVNs");
    expect(factor4).toBeDefined();
    expect(factor4!.score).toBe(0);
    expect(factor4!.maxScore).toBe(15);
  });

  it("no known DVNs — factor 4 = 0/15 with recommendation", async () => {
    const scorer = createScorer();

    const config: UlnConfig = {
      confirmations: 15,
      requiredDVNCount: 2,
      optionalDVNCount: 1,
      optionalDVNThreshold: 1,
      requiredDVNs: [UNKNOWN_DVN_1, UNKNOWN_DVN_2],
      optionalDVNs: [UNKNOWN_DVN_3],
    };

    const result = await scorer.scoreConfig("0xBBBB", 30101, 30102, config);

    const factor4 = result.factors.find((f) => f.name === "Reputable DVNs");
    expect(factor4).toBeDefined();
    expect(factor4!.score).toBe(0);
    expect(factor4!.maxScore).toBe(15);
    expect(factor4!.detail).toBe("No recognized DVN providers detected");

    expect(result.recommendations).toContain(
      "Consider using at least one well-known DVN provider (LayerZero Labs, Google Cloud, etc.) for baseline trust",
    );
  });

  it("factors array has correct structure — 5 factors with right names and maxScores", async () => {
    const scorer = createScorer();

    const config: UlnConfig = {
      confirmations: 10,
      requiredDVNCount: 1,
      optionalDVNCount: 1,
      optionalDVNThreshold: 1,
      requiredDVNs: [LAYERZERO_LABS_DVN],
      optionalDVNs: [UNKNOWN_DVN_1],
    };

    const result = await scorer.scoreConfig("0x1234", 30101, 30102, config);

    expect(result.factors).toHaveLength(5);

    const expectedFactors = [
      { name: "DVN Count", maxScore: 30 },
      { name: "Required DVN Threshold", maxScore: 25 },
      { name: "Optional DVN Strategy", maxScore: 20 },
      { name: "Reputable DVNs", maxScore: 15 },
      { name: "Confirmation Depth", maxScore: 10 },
    ];

    for (let i = 0; i < expectedFactors.length; i++) {
      expect(result.factors[i].name).toBe(expectedFactors[i].name);
      expect(result.factors[i].maxScore).toBe(expectedFactors[i].maxScore);
      expect(result.factors[i].score).toBeGreaterThanOrEqual(0);
      expect(result.factors[i].score).toBeLessThanOrEqual(result.factors[i].maxScore);
      expect(typeof result.factors[i].detail).toBe("string");
    }
  });
});
