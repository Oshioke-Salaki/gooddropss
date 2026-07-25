import { describe, it, expect } from "vitest";
import { evaluateSpoofSignals, IP_HARD_KM, IP_SOFT_KM } from "@/lib/antispoof";

const clean = { ipDistanceKm: 20, proxyOrHosting: false, accuracyM: 15, fixAgeMs: 3_000 };

describe("evaluateSpoofSignals", () => {
  it("passes a clean nearby claim", () => {
    const v = evaluateSpoofSignals(clean);
    expect(v.block).toBe(false);
    expect(v.suspicious).toBe(false);
  });

  it("blocks VPN / datacenter IPs with a user-facing message", () => {
    const v = evaluateSpoofSignals({ ...clean, proxyOrHosting: true });
    expect(v.block).toBe(true);
    expect(v.userMessage).toMatch(/VPN/i);
  });

  it("blocks an IP a continent away from the GPS position", () => {
    const v = evaluateSpoofSignals({ ...clean, ipDistanceKm: IP_HARD_KM + 500 });
    expect(v.block).toBe(true);
  });

  it("only logs (never blocks) a moderately distant IP — mobile carriers wander", () => {
    const v = evaluateSpoofSignals({ ...clean, ipDistanceKm: IP_SOFT_KM + 100 });
    expect(v.block).toBe(false);
    expect(v.suspicious).toBe(true);
  });

  it("treats unknown IP distance as not suspicious (geo outage must not punish)", () => {
    const v = evaluateSpoofSignals({ ...clean, ipDistanceKm: null });
    expect(v.block).toBe(false);
    expect(v.suspicious).toBe(false);
  });

  it("soft signals (bad accuracy, stale fix) log but never block", () => {
    const v = evaluateSpoofSignals({ ...clean, accuracyM: 900, fixAgeMs: 600_000 });
    expect(v.block).toBe(false);
    expect(v.suspicious).toBe(true);
    expect(v.reasons.join()).toMatch(/low_accuracy/);
    expect(v.reasons.join()).toMatch(/stale_fix/);
  });

  it("missing device signals (old clients) are fully ignored", () => {
    const v = evaluateSpoofSignals({ ipDistanceKm: 10, proxyOrHosting: false, accuracyM: null, fixAgeMs: null });
    expect(v.suspicious).toBe(false);
  });
});
