import { describe, it, expect } from "vitest";
import { getExplorerTxUrl, getExplorerBlockUrl, getChainByEid } from "./chains.js";

describe("explorer URLs", () => {
  it("returns etherscan URL for Ethereum tx", () => {
    const url = getExplorerTxUrl(30101, "0xabc123");
    expect(url).toBe("https://etherscan.io/tx/0xabc123");
  });

  it("returns arbiscan URL for Arbitrum tx", () => {
    const url = getExplorerTxUrl(30110, "0xdef456");
    expect(url).toBe("https://arbiscan.io/tx/0xdef456");
  });

  it("returns block URL for Ethereum", () => {
    const url = getExplorerBlockUrl(30101, 19234567);
    expect(url).toBe("https://etherscan.io/block/19234567");
  });

  it("returns null for unknown EID", () => {
    const url = getExplorerTxUrl(99999, "0xabc");
    expect(url).toBeNull();
  });

  it("all 7 polled chains have explorer URLs", () => {
    const polledEids = [30101, 30110, 30111, 30109, 30102, 30184, 30181];
    for (const eid of polledEids) {
      const chain = getChainByEid(eid);
      expect(chain?.explorerUrl, `Missing explorerUrl for EID ${eid}`).toBeDefined();
    }
  });
});
