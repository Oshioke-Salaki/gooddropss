import { describe, it, expect } from "vitest";
import { parseDropHint, buildTaskHint, buildRiddleHint } from "./utils";

describe("task-locked drop hint encoding", () => {
  it("round-trips a plain task drop", () => {
    const raw = buildTaskHint("Buy any coffee", "acme-cafe");
    expect(raw).toBe("[T:acme-cafe]Buy any coffee");
    const p = parseDropHint(raw);
    expect(p.taskMerchantId).toBe("acme-cafe");
    expect(p.hint).toBe("Buy any coffee");
    expect(p.isPrivate).toBe(false);
    expect(p.campaignId).toBeNull();
  });

  it("a normal drop has no task", () => {
    expect(parseDropHint("under the red bench").taskMerchantId).toBeNull();
    expect(parseDropHint("[C:promo1]sponsored").taskMerchantId).toBeNull();
  });

  it("a private drop is never treated as a task (task drops must be public)", () => {
    // [P:] takes precedence; the [T:...] then lives inside the (private) body and
    // is NOT parsed as a task gate — so it can't hide a task drop off the map.
    const p = parseDropHint("[P:0xabc][T:acme]secret");
    expect(p.isPrivate).toBe(true);
    expect(p.taskMerchantId).toBeNull();
  });

  it("composes with a riddle (task + riddle)", () => {
    const raw = buildRiddleHint(buildTaskHint("Buy a pastry", "bakery"));
    const p = parseDropHint(raw);
    expect(p.hasRiddle).toBe(true);
    expect(p.taskMerchantId).toBe("bakery");
    expect(p.hint).toBe("Buy a pastry");
  });

  it("merchant ids with dashes/numbers survive", () => {
    expect(parseDropHint("[T:spot-42_kaduna]do it").taskMerchantId).toBe("spot-42_kaduna");
  });
});
