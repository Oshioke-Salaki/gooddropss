import { describe, it, expect, beforeAll } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { draftDigest, eventMessage, type EventAction, type EventDraft, type GdEvent } from "@/lib/events";

// The full event lifecycle through the real HTTP API: submit → review → edits →
// reminders → cancel, plus every guard (bad input, bad/replayed signatures,
// strangers, limits). Wallets are generated per run.

const BASE = process.env.E2E_API_BASE ?? "http://localhost:3105";
if (/gooddrops\.xyz/.test(BASE)) throw new Error("Refusing to run against production");

const org = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const cohost = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
let adminCookie = "";

const now = () => Math.floor(Date.now() / 1000);
const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  title: "Campus Hunt", description: "Bring a friend.", category: "campus", venueName: "Main gate",
  lat: 6.5244, lng: 3.3792, startsAt: now() + 2 * 3600, endsAt: now() + 5 * 3600, budgetG: 500,
  link: "https://lu.ma/campus-hunt", cohosts: [cohost], ...over,
});

async function signed(account: typeof org, action: EventAction, id: string, d: EventDraft | null) {
  const timestamp = Date.now();
  const signature = await account.signMessage({ message: eventMessage(action, id, timestamp, draftDigest(d)) });
  return { address: account.address, signature, timestamp };
}
async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
const admin = (id: string, action: string, reason?: string) =>
  call(`/api/admin/events/${id}`, { method: "POST", headers: { cookie: adminCookie }, json: { action, reason } });
const create = async (d: EventDraft, who = org) => call("/api/events", { method: "POST", json: { draft: d, ...(await signed(who, "create", "new", d)) } });
const edit = async (id: string, d: EventDraft, who = org) => call(`/api/events/${id}`, { method: "PATCH", json: { action: "edit", draft: d, ...(await signed(who, "edit", id, d)) } });

beforeAll(async () => {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new Error("ADMIN_PASSWORD missing (run with --env-file=.env.local)");
  const res = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
  expect(res.status).toBe(200);
  adminCookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  expect(adminCookie).toMatch(/^gd_admin=/);
});

describe("events lifecycle", () => {
  let id = "";
  let d = draft();

  it("rejects bad input and bad signatures", async () => {
    expect((await create(draft({ title: "x" }))).status).toBe(400);
    expect((await create(draft({ endsAt: now() + 3600, startsAt: now() + 7200 }))).status).toBe(400);
    const sig = await signed(org, "create", "new", draft({ title: "Something else" }));
    expect((await call("/api/events", { method: "POST", json: { draft: d, ...sig } })).status).toBe(401); // signed different content
    const old = { ...(await signed(org, "create", "new", d)), timestamp: Date.now() - 11 * 60 * 1000 };
    expect((await call("/api/events", { method: "POST", json: { draft: d, ...old } })).status).toBe(401); // expired
  });

  it("submits as pending, invisible to the public, visible to hosts", async () => {
    const sig = await signed(org, "create", "new", d);
    const r = await call("/api/events", { method: "POST", json: { draft: d, ...sig } });
    expect(r.status).toBe(201);
    id = (r.body.event as GdEvent).id;
    expect(r.body.event.status).toBe("pending");

    // Replaying the same signature can't create a duplicate.
    expect((await call("/api/events", { method: "POST", json: { draft: d, ...sig } })).status).toBe(401);

    const pub = await call("/api/events");
    expect(JSON.stringify(pub.body)).not.toContain(id);
    expect((await call(`/api/events/${id}?viewer=${stranger.address}`)).status).toBe(404);
    expect((await call(`/api/events/${id}?viewer=${org.address}`)).status).toBe(200);
    expect((await call(`/api/events/${id}?viewer=${cohost}`)).body.viewer.isHost).toBe(true);
    const mine = await call(`/api/events?host=${org.address}`);
    expect(mine.body.events.map((x: { event: GdEvent }) => x.event.id)).toContain(id);
    const theirs = await call(`/api/events?host=${cohost}`);
    expect(theirs.body.events.map((x: { event: GdEvent }) => x.event.id)).toContain(id);
  });

  it("only the organizer can edit; a pending edit replaces the submission", async () => {
    expect((await edit(id, draft({ title: "Hijack" }), stranger)).status).toBe(403);
    d = draft({ title: "Campus Hunt 2026" });
    const r = await edit(id, d);
    expect(r.status).toBe(200);
    expect(r.body.event).toMatchObject({ title: "Campus Hunt 2026", status: "pending" });
  });

  it("admin actions need the admin session and a reason to reject", async () => {
    expect((await call(`/api/admin/events/${id}`, { method: "POST", json: { action: "approve" } })).status).toBe(401);
    expect((await admin(id, "reject")).status).toBe(409);
    const r = await admin(id, "reject", "Add the exact gate");
    expect(r.body.event).toMatchObject({ status: "rejected", rejectReason: "Add the exact gate" });
    const mine = await call(`/api/events/${id}?viewer=${org.address}`);
    expect(mine.body.event.rejectReason).toBe("Add the exact gate");
  });

  it("resubmitting a rejected event clears the reason and goes back to review", async () => {
    d = draft({ title: "Campus Hunt 2026", venueName: "Main gate (north)" });
    const r = await edit(id, d);
    expect(r.body.event).toMatchObject({ status: "pending", venueName: "Main gate (north)" });
    expect(r.body.event.rejectReason).toBeUndefined();
  });

  it("approval makes it public as upcoming, with zeroed live stats", async () => {
    expect((await admin(id, "approve")).body.event.status).toBe("approved");
    const pub = await call("/api/events");
    const row = pub.body.upcoming.find((x: { event: GdEvent }) => x.event.id === id);
    expect(row).toBeTruthy();
    expect(row.stats).toMatchObject({ drops: 0, claims: 0, hunters: 0 });
    const detail = await call(`/api/events/${id}`);
    expect(detail.body.phase).toBe("upcoming");
    expect("pendingEdit" in detail.body.event).toBe(false);
    expect((await admin(id, "approve")).status).toBe(409); // can't approve twice
  });

  it("Remind me toggles and counts", async () => {
    const on = await call(`/api/events/${id}/interest`, { method: "POST", json: { address: stranger.address, on: true } });
    expect(on.body).toMatchObject({ on: true, interested: 1 });
    expect((await call(`/api/events/${id}/interest`, { method: "POST", json: { address: stranger.address } })).body.interested).toBe(1); // idempotent
    expect((await call(`/api/events/${id}?viewer=${stranger.address}`)).body.viewer.interested).toBe(true);
    expect((await call(`/api/events/${id}/interest`, { method: "POST", json: { address: stranger.address, on: false } })).body.interested).toBe(0);
    expect((await call(`/api/events/${id}/interest`, { method: "POST", json: { address: "nope" } })).status).toBe(401);
  });

  it("edits to a live-approved event wait for review while the old version stays up", async () => {
    const next = { ...d, title: "Campus Hunt — Finals" };
    expect((await edit(id, next)).body.event.pendingEdit.title).toBe("Campus Hunt — Finals");
    expect((await call(`/api/events/${id}`)).body.event.title).toBe("Campus Hunt 2026");
    expect((await admin(id, "approveEdit")).body.event).toMatchObject({ title: "Campus Hunt — Finals", pendingEdit: null });
    d = next;
  });

  it("caps open events per organizer", async () => {
    expect((await create(draft({ title: "Second" }))).status).toBe(201);
    expect((await create(draft({ title: "Third" }))).status).toBe(201);
    const fourth = await create(draft({ title: "Fourth" }));
    expect(fourth.status).toBe(429);
  });

  it("cancelling hides it from the list but keeps the page, and freezes it", async () => {
    const r = await call(`/api/events/${id}`, { method: "PATCH", json: { action: "cancel", ...(await signed(org, "cancel", id, null)) } });
    expect(r.body.event.status).toBe("cancelled");
    expect(JSON.stringify((await call("/api/events")).body)).not.toContain(id);
    expect((await call(`/api/events/${id}`)).body.event.status).toBe("cancelled");
    expect((await edit(id, d)).status).toBe(409);
  });

  it("the reminder cron is locked without its secret", async () => {
    expect((await call("/api/cron/events")).status).toBe(401);
    const secret = process.env.CRON_SECRET;
    if (secret) expect((await call(`/api/cron/events?dry=1&key=${secret}`)).body.ok).toBe(true);
  });
});
