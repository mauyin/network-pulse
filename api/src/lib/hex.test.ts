import { describe, expect, it } from "vitest";
import {
  hexToBuffer,
  bufferToHex,
  isValidAddress,
  isValidHash,
} from "./hex.js";

describe("hexToBuffer", () => {
  it("converts hex string with 0x prefix", () => {
    const buf = hexToBuffer("0xdeadbeef");
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(buf).toString("hex")).toBe("deadbeef");
  });

  it("converts hex string without 0x prefix", () => {
    const buf = hexToBuffer("cafebabe");
    expect(Buffer.from(buf).toString("hex")).toBe("cafebabe");
  });

  it("roundtrips with bufferToHex", () => {
    const original = "0x00112233aabbccdd";
    const buf = hexToBuffer(original);
    const hex = bufferToHex(buf);
    expect(hex).toBe(original);
  });
});

describe("bufferToHex", () => {
  it("returns 0x-prefixed hex string", () => {
    const buf = Buffer.from("ff00ab", "hex");
    expect(bufferToHex(buf)).toBe("0xff00ab");
  });

  it("handles empty buffer", () => {
    const buf = Buffer.alloc(0);
    expect(bufferToHex(buf)).toBe("0x");
  });
});

describe("isValidAddress", () => {
  it("accepts a valid 20-byte address", () => {
    expect(isValidAddress("0x" + "a".repeat(40))).toBe(true);
  });

  it("accepts mixed-case address", () => {
    expect(isValidAddress("0xAbCdEf0123456789AbCdEf0123456789AbCdEf01")).toBe(true);
  });

  it("rejects address that is too short", () => {
    expect(isValidAddress("0x" + "a".repeat(39))).toBe(false);
  });

  it("rejects address that is too long", () => {
    expect(isValidAddress("0x" + "a".repeat(41))).toBe(false);
  });

  it("rejects address without 0x prefix", () => {
    expect(isValidAddress("a".repeat(40))).toBe(false);
  });

  it("rejects address with non-hex characters", () => {
    expect(isValidAddress("0x" + "g".repeat(40))).toBe(false);
  });
});

describe("isValidHash", () => {
  it("accepts a valid 32-byte hash", () => {
    expect(isValidHash("0x" + "b".repeat(64))).toBe(true);
  });

  it("rejects hash that is too short", () => {
    expect(isValidHash("0x" + "b".repeat(63))).toBe(false);
  });

  it("rejects hash that is too long", () => {
    expect(isValidHash("0x" + "b".repeat(65))).toBe(false);
  });

  it("rejects hash without 0x prefix", () => {
    expect(isValidHash("b".repeat(64))).toBe(false);
  });
});
