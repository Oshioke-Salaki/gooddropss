import { describe, it, expect } from "vitest";
import { normalizeWebhook, readField } from "@/lib/webhookNormalize";

describe("normalizeWebhook — Goldsky Mirror (entity diff) shape", () => {
  it("treats an INSERT as a created drop and exposes the new row", () => {
    const r = normalizeWebhook({
      op: "INSERT",
      entity: "Drop",
      data: { new: { dropId: "42", dropper: "0xabc", status: 0, lat: 1, lng: 2 }, old: null },
    });
    expect(r.created).toBe(true);
    expect(r.claimed).toBe(false);
    expect(r.fields.dropId).toBe("42");
  });

  it("treats an UPDATE to status 1 as a claim", () => {
    const r = normalizeWebhook({
      op: "UPDATE",
      data: { new: { dropId: "42", status: 1 }, old: { dropId: "42", status: 0 } },
    });
    expect(r.claimed).toBe(true);
    expect(r.created).toBe(false);
  });

  it("does NOT re-fire a claim when the row was already claimed", () => {
    const r = normalizeWebhook({
      op: "UPDATE",
      data: { new: { status: 1 }, old: { status: 1 } },
    });
    expect(r.claimed).toBe(false);
  });

  it("lowercases/uppercases op robustly", () => {
    const r = normalizeWebhook({ op: "insert", data: { new: { status: 0 } } });
    expect(r.created).toBe(true);
  });

  it("an expiry/reclaim UPDATE (status 2) is neither created nor claimed", () => {
    const r = normalizeWebhook({
      op: "UPDATE",
      data: { new: { status: 2 }, old: { status: 0 } },
    });
    expect(r.created).toBe(false);
    expect(r.claimed).toBe(false);
  });
});

describe("normalizeWebhook — generic event shape", () => {
  it("detects DropCreated from type", () => {
    const r = normalizeWebhook({ type: "DropCreated", data: { dropId: "7", lat: 1, lng: 2 } });
    expect(r.created).toBe(true);
    expect(r.fields.dropId).toBe("7");
  });

  it("detects DropClaimed from event + status", () => {
    expect(normalizeWebhook({ event: "DropClaimed", data: {} }).claimed).toBe(true);
    expect(normalizeWebhook({ type: "x", data: { status: 1 } }).claimed).toBe(true);
    expect(normalizeWebhook({ type: "x", payload: { status: 0 } }).claimed).toBe(false);
  });
});

describe("normalizeWebhook — hardening", () => {
  it("never throws on empty / null / garbage input", () => {
    expect(() => normalizeWebhook(null)).not.toThrow();
    expect(() => normalizeWebhook(undefined)).not.toThrow();
    expect(() => normalizeWebhook({})).not.toThrow();
    const r = normalizeWebhook({});
    expect(r.created).toBe(false);
    expect(r.claimed).toBe(false);
  });
});

describe("readField", () => {
  it("reads a top-level field", () => {
    expect(readField({ lat: 5 }, "lat")).toBe(5);
  });
  it("falls back to a nested `fields` wrapper", () => {
    expect(readField({ fields: { lat: 9 } }, "lat")).toBe(9);
  });
  it("prefers the top-level value over the nested one", () => {
    expect(readField({ lat: 1, fields: { lat: 2 } }, "lat")).toBe(1);
  });
});
