import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A stand-in Web Audio engine that records what was played. */
class FakeCtx {
  static last: FakeCtx | null = null;
  state: string;
  currentTime = 0;
  destination = {};
  notes: number[] = [];
  constructor(state = "running") { this.state = state; FakeCtx.last = this; }
  resume = vi.fn(async () => { this.state = "running"; });
  createOscillator() {
    return {
      type: "", frequency: { setValueAtTime: (f: number) => this.notes.push(f) },
      connect: (g: unknown) => g, start: vi.fn(), stop: vi.fn(),
    };
  }
  createGain() {
    return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: (d: unknown) => d };
  }
}
class LockedCtx extends FakeCtx { constructor() { super("suspended"); } }

let listeners: Record<string, () => void>;
function env(AudioContext: unknown, hidden = false) {
  listeners = {};
  vi.stubGlobal("window", {
    AudioContext,
    addEventListener: (e: string, f: () => void) => { listeners[e] = f; },
    removeEventListener: (e: string) => { delete listeners[e]; },
  });
  vi.stubGlobal("document", { hidden });
  vi.stubGlobal("navigator", { vibrate: vi.fn() });
}
beforeEach(() => { vi.resetModules(); FakeCtx.last = null; });
afterEach(() => vi.unstubAllGlobals());

describe("sound", () => {
  it("plays the two-note coin chime (E6 then B6) when audio is running", async () => {
    env(FakeCtx);
    const s = await import("@/lib/sound");
    s.playCoinChime();
    expect(FakeCtx.last?.notes).toEqual([1318.5, 1975.5]);
  });

  it("stays silent while audio is locked, and the first tap unlocks it (listening once)", async () => {
    env(LockedCtx);
    const s = await import("@/lib/sound");
    s.playCoinChime();
    expect(FakeCtx.last?.notes).toEqual([]);
    s.primeAudio();
    s.primeAudio();
    expect(Object.keys(listeners).sort()).toEqual(["keydown", "pointerdown"]);
    listeners.pointerdown();
    expect(FakeCtx.last?.resume).toHaveBeenCalledTimes(1);
    expect(listeners.pointerdown).toBeUndefined();
  });

  it("stays silent in a hidden tab", async () => {
    env(FakeCtx, true);
    const s = await import("@/lib/sound");
    s.playCoinChime();
    expect(FakeCtx.last?.notes ?? []).toEqual([]);
  });

  it("never throws without Web Audio, and buzzes where supported", async () => {
    env(undefined);
    const s = await import("@/lib/sound");
    expect(() => s.playCoinChime()).not.toThrow();
    s.buzz(35);
    expect(navigator.vibrate).toHaveBeenCalledWith(35);
  });
});
