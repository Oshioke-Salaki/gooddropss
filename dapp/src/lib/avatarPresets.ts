// Preset avatars — a curated, niche, very-online set. Each is a gradient + a
// glyph, so there are NO uploads, NO hosting, and NO moderation surface: the
// user just picks a vibe. The chosen preset id is stored on the profile (tiny
// string in Redis); Avatar renders it, falling back to the generated monogram.

export interface AvatarPreset {
  id: string;      // stable kebab id stored on the profile
  name: string;    // the vibe (shown in the picker)
  emoji: string;   // the glyph
  from: string;    // gradient start
  to: string;      // gradient end
  dark?: boolean;  // true when the gradient is dark (glyph gets a light halo)
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "delulu",         name: "delulu",         emoji: "🦋", from: "#FBC2EB", to: "#A6C1EE" },
  { id: "rizz",           name: "rizz",           emoji: "😎", from: "#FFA17F", to: "#FF6A88" },
  { id: "main-character", name: "main character", emoji: "🌟", from: "#F7971E", to: "#FFD200" },
  { id: "touch-grass",    name: "touch grass",    emoji: "🌱", from: "#A8E063", to: "#56AB2F" },
  { id: "no-thoughts",    name: "no thoughts",    emoji: "🫧", from: "#A1C4FD", to: "#C2E9FB" },
  { id: "slay",           name: "slay",           emoji: "💅", from: "#F857A6", to: "#FF5858" },
  { id: "its-giving",     name: "it's giving",    emoji: "🔥", from: "#BFFD00", to: "#0F0F0F", dark: true },
  { id: "menace",         name: "menace",         emoji: "😈", from: "#E53935", to: "#1A1A1A", dark: true },
  { id: "npc",            name: "npc",            emoji: "🤖", from: "#BDC3C7", to: "#2C3E50", dark: true },
  { id: "aura",           name: "aura +1000",     emoji: "🌀", from: "#8E2DE2", to: "#4A00E0", dark: true },
  { id: "bestie",         name: "bestie",         emoji: "🫶", from: "#FFDEE9", to: "#B5FFFC" },
  { id: "unbothered",     name: "unbothered",     emoji: "🕶️", from: "#43C6AC", to: "#191654", dark: true },
  { id: "moonchild",      name: "moonchild",      emoji: "🌙", from: "#141E30", to: "#243B55", dark: true },
  { id: "goblin-mode",    name: "goblin mode",    emoji: "🍄", from: "#5A7247", to: "#1B2E1B", dark: true },
  { id: "hyperpop",       name: "hyperpop",       emoji: "🩷", from: "#FF00CC", to: "#00FFF0" },
  { id: "based",          name: "based",          emoji: "🐸", from: "#76B852", to: "#8DC26F" },
  { id: "sigma",          name: "sigma",          emoji: "🐺", from: "#757F9A", to: "#D7DDE8" },
  { id: "matcha",         name: "matcha",         emoji: "🍵", from: "#83B87B", to: "#4A7C59" },
  { id: "y2k",            name: "y2k",            emoji: "🪩", from: "#FBAB7E", to: "#F7CE68" },
  { id: "glowup",         name: "glowup",         emoji: "✨", from: "#F6D365", to: "#FDA085" },
  { id: "opps",           name: "on demon time",  emoji: "👹", from: "#870000", to: "#190A05", dark: true },
  { id: "cozy",           name: "cozy core",      emoji: "🧸", from: "#E6B980", to: "#EACDA3" },
  { id: "cyber",          name: "cybercore",      emoji: "👾", from: "#00F5A0", to: "#00D9F5", },
  { id: "ethereal",       name: "ethereal",       emoji: "🧚", from: "#C9D6FF", to: "#E2C2FF" },
];

const MAP = new Map(AVATAR_PRESETS.map((p) => [p.id, p]));

export function getAvatarPreset(id?: string | null): AvatarPreset | null {
  return id ? MAP.get(id) ?? null : null;
}

export function isValidAvatarPreset(id: string): boolean {
  return MAP.has(id);
}
