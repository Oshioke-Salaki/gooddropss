// The GoodDrops explorer avatars: 12 characters x 4 skin tones x 4 backgrounds.
//
// A choice is one short string stored on the profile, `ex-c07-t3-b2`
// (character, tone, background), so the existing signed save endpoint and
// profile storage carry it unchanged. Artwork is a transparent bust per
// character and tone in /public/avatars/explorer/cNN-tN.webp; the background
// is drawn by the app, which is why it can be any of the four.
//
// Anyone without a valid choice (never picked, or picked one of the retired
// emoji/3D avatars) gets an explorer chosen from their address: random-looking,
// but always the same one for the same person, so nothing flickers between
// visits and no profile needs rewriting.

export interface AvatarCharacter { id: string; name: string }
export interface AvatarTone { id: string; name: string; swatch: string }
export interface AvatarBackground { id: string; name: string; color: string }

/** Order alternates women and men so any row of the grid looks balanced. */
export const AVATAR_CHARACTERS: AvatarCharacter[] = [
  { id: "c01", name: "Bucket hat" },
  { id: "c02", name: "Green cap" },
  { id: "c03", name: "Braids" },
  { id: "c04", name: "Compass" },
  { id: "c05", name: "Headwrap" },
  { id: "c06", name: "Shades" },
  { id: "c07", name: "Bantu knots" },
  { id: "c08", name: "Red hat" },
  { id: "c09", name: "Backwards cap" },
  { id: "c10", name: "High-top" },
  { id: "c11", name: "Locs" },
  { id: "c12", name: "Safari hat" },
];

export const AVATAR_TONES: AvatarTone[] = [
  { id: "t1", name: "Light", swatch: "#F4CDA5" },
  { id: "t2", name: "Medium", swatch: "#D49A68" },
  { id: "t3", name: "Brown", swatch: "#A2663C" },
  { id: "t4", name: "Deep", swatch: "#5B3620" },
];

export const AVATAR_BACKGROUNDS: AvatarBackground[] = [
  { id: "b1", name: "Blue", color: "#2727E2" },
  { id: "b2", name: "Orange", color: "#FF9825" },
  { id: "b3", name: "Mint", color: "#6FD9B8" },
  { id: "b4", name: "Lilac", color: "#C9A7F5" },
];

export interface AvatarChoice { character: string; tone: string; background: string }

const CHAR_IDS = new Set(AVATAR_CHARACTERS.map((c) => c.id));
const TONE_IDS = new Set(AVATAR_TONES.map((t) => t.id));
const BG_IDS = new Set(AVATAR_BACKGROUNDS.map((b) => b.id));
const ID_RE = /^ex-(c\d{2})-(t\d)-(b\d)$/;

export function avatarId(c: AvatarChoice): string {
  return `ex-${c.character}-${c.tone}-${c.background}`;
}

/** The choice an id stands for, or null if it isn't a current explorer id. */
export function parseAvatarId(id?: string | null): AvatarChoice | null {
  const m = id ? ID_RE.exec(id) : null;
  if (!m || !CHAR_IDS.has(m[1]) || !TONE_IDS.has(m[2]) || !BG_IDS.has(m[3])) return null;
  return { character: m[1], tone: m[2], background: m[3] };
}

export function isValidAvatarId(id: string): boolean {
  return parseAvatarId(id) !== null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A stable, address-derived explorer for anyone without a valid choice. */
export function defaultAvatarFor(address: string): AvatarChoice {
  const h = hash((address || "").toLowerCase());
  return {
    character: AVATAR_CHARACTERS[h % AVATAR_CHARACTERS.length].id,
    tone: AVATAR_TONES[(h >>> 8) % AVATAR_TONES.length].id,
    background: AVATAR_BACKGROUNDS[(h >>> 16) % AVATAR_BACKGROUNDS.length].id,
  };
}

/** What to draw for this person: their choice if valid, else their default. */
export function resolveAvatar(preset: string | null | undefined, address: string): AvatarChoice {
  return parseAvatarId(preset) ?? defaultAvatarFor(address);
}

/**
 * The bust image. Avatars drawn at 64px or less (lists, leaderboards, map
 * markers) use the 128px file, a few KB, instead of the 512px original.
 */
export function avatarSrc(character: string, tone: string, displaySize = 512): string {
  return displaySize <= 64
    ? `/avatars/explorer/sm/${character}-${tone}.webp`
    : `/avatars/explorer/${character}-${tone}.webp`;
}

export function avatarColor(background: string): string {
  return AVATAR_BACKGROUNDS.find((b) => b.id === background)?.color ?? AVATAR_BACKGROUNDS[0].color;
}
