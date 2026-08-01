import { describe, it, expect } from "vitest";
import { cleanTask, isValidTask, approveMessage, newNonce, TASK_MAX_LEN } from "./taskLock";

describe("taskLock helpers", () => {
  it("cleans task text to one trimmed line, capped", () => {
    expect(cleanTask("  Buy   any\n\ncoffee  ")).toBe("Buy any coffee");
    expect(cleanTask("x".repeat(200)).length).toBe(TASK_MAX_LEN);
  });

  it("validates task length", () => {
    expect(isValidTask("Buy a coffee")).toBe(true);
    expect(isValidTask("  hi ")).toBe(false);   // < 3 chars after trim
    expect(isValidTask("")).toBe(false);
    expect(isValidTask("ok")).toBe(false);
    expect(isValidTask("yes")).toBe(true);
  });

  it("binds the approval message to the nonce", () => {
    expect(approveMessage("abc123")).toBe("GOODDROPS_TASK_APPROVE:abc123");
    expect(approveMessage("abc123")).not.toBe(approveMessage("abc124"));
  });

  it("mints a 32-hex-char single-use nonce, unique each time", () => {
    const a = newNonce(), b = newNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
