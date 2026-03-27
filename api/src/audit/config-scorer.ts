import { ethers } from "ethers";
import type { PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { getRpcUrl, getChainByEid } from "../lib/chains.js";

const ENDPOINT_ABI = [
  "function getSendLibrary(address _sender, uint32 _dstEid) view returns (address lib)",
];

const SEND_LIB_ABI = [
  "function getUlnConfig(address _oapp, uint32 _remoteEid) view returns (tuple(uint64 confirmations, uint8 requiredDVNCount, uint8 optionalDVNCount, uint8 optionalDVNThreshold, address[] requiredDVNs, address[] optionalDVNs))",
];

export interface UlnConfig {
  confirmations: number;
  requiredDVNCount: number;
  optionalDVNCount: number;
  optionalDVNThreshold: number;
  requiredDVNs: string[];
  optionalDVNs: string[];
}

export interface AuditResult {
  oappAddress: string;
  srcEid: number;
  dstEid: number;
  config: UlnConfig;
  score: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  factors: AuditFactor[];
  recommendations: string[];
}

interface AuditFactor {
  name: string;
  score: number;
  maxScore: number;
  detail: string;
}

export class ConfigScorer {
  constructor(
    private logger: FastifyBaseLogger,
    private prisma?: PrismaClient,
  ) {}

  async audit(
    oappAddress: string,
    srcEid: number,
    dstEid: number,
  ): Promise<AuditResult> {
    const config = await this.fetchUlnConfig(oappAddress, srcEid, dstEid);
    return await this.scoreConfig(oappAddress, srcEid, dstEid, config);
  }

  private async fetchUlnConfig(
    oappAddress: string,
    srcEid: number,
    dstEid: number,
  ): Promise<UlnConfig> {
    const chain = getChainByEid(srcEid);
    if (!chain) throw new Error(`Unsupported source EID: ${srcEid}`);

    const rpcUrl = getRpcUrl(srcEid);
    if (!rpcUrl) throw new Error(`No RPC URL configured for ${chain.name}`);

    const connection = new ethers.FetchRequest(rpcUrl);
    connection.timeout = 15_000; // 15 seconds
    const provider = new ethers.JsonRpcProvider(connection);

    try {
      // Step 1: Get the send library for this OApp + destination
      const endpoint = new ethers.Contract(chain.endpointV2, ENDPOINT_ABI, provider);
      const sendLib: string = await endpoint.getSendLibrary(oappAddress, dstEid);

      // Step 2: Get the ULN config from the send library
      const sendLibContract = new ethers.Contract(sendLib, SEND_LIB_ABI, provider);
      const raw = await sendLibContract.getUlnConfig(oappAddress, dstEid);

      return {
        confirmations: Number(raw.confirmations),
        requiredDVNCount: Number(raw.requiredDVNCount),
        optionalDVNCount: Number(raw.optionalDVNCount),
        optionalDVNThreshold: Number(raw.optionalDVNThreshold),
        requiredDVNs: [...raw.requiredDVNs],
        optionalDVNs: [...raw.optionalDVNs],
      };
    } catch (err) {
      const isTimeout =
        err instanceof Error &&
        (err.message.includes("timeout") || err.message.includes("TIMEOUT"));

      if (isTimeout) {
        this.logger.warn({ oappAddress, srcEid, dstEid }, "RPC request timed out after 15s");
        throw new Error("RPC request timed out — please try again");
      }

      this.logger.error({ err, oappAddress, srcEid, dstEid }, "Failed to fetch ULN config");
      throw new Error("Failed to fetch ULN config from chain — the address may not be a valid OApp");
    } finally {
      provider.destroy();
    }
  }

  /**
   * Resolve DVN addresses to provider names via the registry DB.
   * Falls back to empty map if prisma is not available.
   */
  private async resolveKnownDvns(
    addresses: string[],
    srcEid: number,
  ): Promise<Record<string, string>> {
    if (!this.prisma || addresses.length === 0) return {};

    // Batch query: single DB call instead of N queries (fixes N+1)
    const checksummed = addresses.map((addr) => ethers.getAddress(addr));
    const buffers = checksummed.map(
      (addr) => Buffer.from(addr.slice(2), "hex") as Uint8Array<ArrayBuffer>,
    );

    const rows = await this.prisma.dvnAddress.findMany({
      where: { address: { in: buffers }, eid: srcEid },
      include: { provider: { select: { canonicalName: true } } },
    });

    const result: Record<string, string> = {};
    for (const row of rows) {
      const hex = "0x" + Buffer.from(row.address).toString("hex");
      const addr = ethers.getAddress(hex);
      result[addr] = row.provider.canonicalName;
    }
    return result;
  }

  async scoreConfig(
    oappAddress: string,
    srcEid: number,
    dstEid: number,
    config: UlnConfig,
  ): Promise<AuditResult> {
    const factors: AuditFactor[] = [];
    const recommendations: string[] = [];
    const totalDVNs = config.requiredDVNCount + config.optionalDVNCount;

    // Factor 1: DVN count (max 30 points)
    {
      let score: number;
      if (totalDVNs >= 4) score = 30;
      else if (totalDVNs >= 3) score = 25;
      else if (totalDVNs >= 2) score = 20;
      else if (totalDVNs >= 1) score = 10;
      else score = 0;

      factors.push({
        name: "DVN Count",
        score,
        maxScore: 30,
        detail: `${totalDVNs} total DVNs (${config.requiredDVNCount} required, ${config.optionalDVNCount} optional)`,
      });

      if (totalDVNs < 2) {
        recommendations.push("Add at least one more DVN for redundancy — a single DVN is a single point of failure");
      }
    }

    // Factor 2: Required DVN threshold (max 25 points)
    {
      let score: number;
      if (config.requiredDVNCount >= 2) score = 25;
      else if (config.requiredDVNCount === 1) score = 15;
      else score = 0;

      factors.push({
        name: "Required DVN Threshold",
        score,
        maxScore: 25,
        detail: `${config.requiredDVNCount} required DVNs must verify every message`,
      });

      if (config.requiredDVNCount < 2) {
        recommendations.push("Increase required DVN count to at least 2 for consensus-like security");
      }
    }

    // Factor 3: Optional DVN threshold utilization (max 20 points)
    {
      let score: number;
      if (config.optionalDVNCount === 0) {
        score = 10; // no optional DVNs is neutral, not bad
      } else if (config.optionalDVNThreshold > 0) {
        score = config.optionalDVNThreshold >= 2 ? 20 : 15;
      } else {
        score = 0; // has optional DVNs but threshold is 0 = useless
      }

      factors.push({
        name: "Optional DVN Strategy",
        score,
        maxScore: 20,
        detail: config.optionalDVNCount > 0
          ? `${config.optionalDVNThreshold}/${config.optionalDVNCount} optional DVN threshold`
          : "No optional DVNs configured",
      });

      if (config.optionalDVNCount > 0 && config.optionalDVNThreshold === 0) {
        recommendations.push("Optional DVN threshold is 0 — optional DVNs are effectively unused. Set threshold > 0 or remove them");
      }
    }

    // Factor 4: Known/reputable DVN usage (max 15 points)
    {
      const allDvns = [...config.requiredDVNs, ...config.optionalDVNs];
      const knownDvns = await this.resolveKnownDvns(allDvns, srcEid);
      const knownCount = allDvns.filter((addr) =>
        knownDvns[ethers.getAddress(addr)] !== undefined
      ).length;

      const score = totalDVNs > 0 ? Math.round((knownCount / totalDVNs) * 15) : 0;

      const knownNames = allDvns
        .map((addr) => knownDvns[ethers.getAddress(addr)])
        .filter(Boolean);

      factors.push({
        name: "Reputable DVNs",
        score,
        maxScore: 15,
        detail: knownCount > 0
          ? `${knownCount}/${totalDVNs} known DVNs: ${knownNames.join(", ")}`
          : "No recognized DVN providers detected",
      });

      if (knownCount === 0 && totalDVNs > 0) {
        recommendations.push("Consider using at least one well-known DVN provider (LayerZero Labs, Google Cloud, etc.) for baseline trust");
      }
    }

    // Factor 5: Confirmation depth (max 10 points)
    {
      const score = config.confirmations >= 1 ? 10 : 0;

      factors.push({
        name: "Confirmation Depth",
        score,
        maxScore: 10,
        detail: `${config.confirmations} block confirmations required`,
      });

      if (config.confirmations === 0) {
        recommendations.push("Set a non-zero confirmation depth to protect against chain reorgs");
      }
    }

    const totalScore = factors.reduce((sum, f) => sum + f.score, 0);

    let grade: AuditResult["grade"];
    if (totalScore >= 90) grade = "A";
    else if (totalScore >= 75) grade = "B";
    else if (totalScore >= 60) grade = "C";
    else if (totalScore >= 40) grade = "D";
    else grade = "F";

    if (recommendations.length === 0) {
      recommendations.push("Configuration looks solid. No immediate improvements recommended.");
    }

    return {
      oappAddress,
      srcEid,
      dstEid,
      config,
      score: totalScore,
      grade,
      factors,
      recommendations,
    };
  }
}
