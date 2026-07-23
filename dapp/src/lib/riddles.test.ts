import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import {
  riddleTokenMessage, newRiddleToken, RIDDLE_TOKEN_RE,
  normalizeAnswer, hashAnswer, hashesEqual,
} from "@/lib/riddles";

describe("riddle token", () => {
  it("newRiddleToken produces a token matching RIDDLE_TOKEN_RE", () => {
    for (let i = 0; i < 20; i++) expect(RIDDLE_TOKEN_RE.test(newRiddleToken())).toBe(true);
  });
  it("RIDDLE_TOKEN_RE rejects junk / injection", () => {
    for (const bad of ["", "short", "has space", "0x" + "a".repeat(40), "a".repeat(100), "semi;colon"])
      expect(RIDDLE_TOKEN_RE.test(bad)).toBe(false);
  });
});

describe("riddle token ownership round-trip", () => {
  // The dropper signs the token BEFORE the drop exists; the store route recovers
  // the signer as `owner`. Bind later checks owner === on-chain dropper.
  const account = privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  );

  it("server recovers the exact signer from the token message", async () => {
    const token = newRiddleToken();
    const message = riddleTokenMessage(token);
    const signature = await account.signMessage({ message });
    const recovered = await recoverMessageAddress({ message, signature });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("a different token in the rebuilt message breaks recovery (no replay to another token)", async () => {
    const signed = await account.signMessage({ message: riddleTokenMessage("aaaaaaaaaaaaaaaa") });
    const recovered = await recoverMessageAddress({
      message: riddleTokenMessage("bbbbbbbbbbbbbbbb"),
      signature: signed,
    });
    expect(recovered.toLowerCase()).not.toBe(account.address.toLowerCase());
  });
});

describe("answer normalisation & hashing", () => {
  it("compares on meaning, not keystrokes", () => {
    expect(normalizeAnswer("The Red Bench!")).toBe(normalizeAnswer("red bench"));
    expect(normalizeAnswer("  a  Café ")).toBe(normalizeAnswer("cafe"));
  });
  it("an all-punctuation answer normalises to empty", () => {
    expect(normalizeAnswer("???")).toBe("");
  });
  it("hashAnswer is deterministic per salt and matches via hashesEqual", async () => {
    const salt = "fixed-salt";
    const a = await hashAnswer("Red Bench", salt);
    const b = await hashAnswer("the red bench", salt);
    expect(hashesEqual(a, b)).toBe(true);
  });
  it("different salts yield different hashes for the same answer", async () => {
    const a = await hashAnswer("red bench", "salt-1");
    const b = await hashAnswer("red bench", "salt-2");
    expect(hashesEqual(a, b)).toBe(false);
  });
});
