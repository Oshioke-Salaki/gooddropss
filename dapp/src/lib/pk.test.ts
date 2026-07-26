import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { normalizePk } from "./pk";

// A real, valid secp256k1 key body (Hardhat test account #1), no 0x prefix.
const HEX64 = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("normalizePk", () => {
  it("adds the 0x prefix when missing", () => {
    expect(normalizePk(HEX64)).toBe(`0x${HEX64}`);
  });

  it("keeps an already-prefixed key (idempotent)", () => {
    expect(normalizePk(`0x${HEX64}`)).toBe(`0x${HEX64}`);
  });

  it("lower-cases and trims surrounding whitespace", () => {
    expect(normalizePk(`  0X${HEX64.toUpperCase()}  `)).toBe(`0x${HEX64}`);
  });

  it("returns undefined for missing / malformed values", () => {
    expect(normalizePk(undefined)).toBeUndefined();
    expect(normalizePk(null)).toBeUndefined();
    expect(normalizePk("")).toBeUndefined();
    expect(normalizePk("0xdeadbeef")).toBeUndefined();       // too short
    expect(normalizePk(`${HEX64}zz`)).toBeUndefined();        // non-hex
  });

  it("produces a key viem accepts, prefix or not", () => {
    const a = privateKeyToAccount(normalizePk(HEX64)!);
    const b = privateKeyToAccount(normalizePk(`0x${HEX64}`)!);
    expect(a.address).toBe(b.address);
  });
});
