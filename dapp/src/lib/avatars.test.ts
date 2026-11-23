import { describe, it, expect } from "vitest";
import {
  AVATAR_BACKGROUNDS, AVATAR_CHARACTERS, AVATAR_TONES, avatarColor, avatarId, avatarSrc,
  defaultAvatarFor, isValidAvatarId, parseAvatarId, resolveAvatar,
} from "./avatars";

describe("avatar ids", () => {
  it("round-trips every combination", () => {
    for (const c of AVATAR_CHARACTERS) for (const t of AVATAR_TONES) for (const b of AVATAR_BACKGROUNDS) {
      const id = avatarId({ character: c.id, tone: t.id, background: b.id });
      expect(parseAvatarId(id)).toEqual({ character: c.id, tone: t.id, background: b.id });
      expect(isValidAvatarId(id)).toBe(true);
    }
  });

  it("rejects retired presets, unknown parts and junk", () => {
    for (const bad of ["face-01", "delulu", "", "ex-c13-t1-b1", "ex-c01-t5-b1", "ex-c01-t1-b9", "ex-c01-t1", "EX-C01-T1-B1", "ex-c01-t1-b1 "]) {
      expect(isValidAvatarId(bad)).toBe(false);
    }
    expect(parseAvatarId(null)).toBeNull();
    expect(parseAvatarId(undefined)).toBeNull();
  });
});

describe("defaults for people without a valid choice", () => {
  const a = "0x8f3a52f3dbe6f0f0b6b5a0e0d48b3a1ac0f2cd8f";

  it("is stable for an address, and case-insensitive", () => {
    expect(defaultAvatarFor(a)).toEqual(defaultAvatarFor(a.toUpperCase().replace("0X", "0x")));
    expect(isValidAvatarId(avatarId(defaultAvatarFor(a)))).toBe(true);
  });

  it("spreads people across characters, tones and backgrounds", () => {
    const seen = { c: new Set<string>(), t: new Set<string>(), b: new Set<string>() };
    for (let i = 0; i < 400; i++) {
      const d = defaultAvatarFor(`0x${i.toString(16).padStart(40, "0")}`);
      seen.c.add(d.character); seen.t.add(d.tone); seen.b.add(d.background);
    }
    expect(seen.c.size).toBe(AVATAR_CHARACTERS.length);
    expect(seen.t.size).toBe(AVATAR_TONES.length);
    expect(seen.b.size).toBe(AVATAR_BACKGROUNDS.length);
  });

  it("a retired preset resolves to the address default; a valid one is kept", () => {
    expect(resolveAvatar("face-03", a)).toEqual(defaultAvatarFor(a));
    expect(resolveAvatar("rizz", a)).toEqual(defaultAvatarFor(a));
    expect(resolveAvatar("", a)).toEqual(defaultAvatarFor(a));
    expect(resolveAvatar("ex-c05-t2-b3", a)).toEqual({ character: "c05", tone: "t2", background: "b3" });
  });
});

describe("assets", () => {
  it("builds the image path and colour", () => {
    expect(avatarSrc("c07", "t3")).toBe("/avatars/explorer/c07-t3.webp");
    expect(avatarSrc("c07", "t3", 48)).toBe("/avatars/explorer/sm/c07-t3.webp");
    expect(avatarSrc("c07", "t3", 100)).toBe("/avatars/explorer/c07-t3.webp");
    expect(avatarColor("b2")).toBe("#FF9825");
    expect(avatarColor("nope")).toBe(AVATAR_BACKGROUNDS[0].color);
  });
});
