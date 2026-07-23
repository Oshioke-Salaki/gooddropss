import type { LandmarkCategory } from "@/types";

// Category metadata - single source of truth for icon + color, used by the map
// labels, the admin creator, and the management page.
export const LANDMARK_CATEGORIES: {
  id: LandmarkCategory; label: string; icon: string; color: string;
}[] = [
  { id: "landmark",  label: "Landmark",  icon: "📍", color: "#BFFD00" },
  { id: "campus",    label: "Campus",    icon: "🎓", color: "#7C9CFF" },
  { id: "school",    label: "School",    icon: "🏫", color: "#7C9CFF" },
  { id: "market",    label: "Market",    icon: "🛒", color: "#FFB84D" },
  { id: "worship",   label: "Worship",   icon: "🕌", color: "#C9A0FF" },
  { id: "junction",  label: "Junction",  icon: "🚦", color: "#FF8A8A" },
  { id: "estate",    label: "Estate",    icon: "🏘️", color: "#66D9C2" },
  { id: "park",      label: "Park",      icon: "🌳", color: "#7FE07F" },
  { id: "transport", label: "Transport", icon: "🚉", color: "#FFD166" },
];

export const LANDMARK_CATEGORY_IDS = LANDMARK_CATEGORIES.map((c) => c.id);

const CAT_MAP = new Map(LANDMARK_CATEGORIES.map((c) => [c.id, c]));

export function landmarkMeta(cat: string) {
  return CAT_MAP.get(cat as LandmarkCategory) ?? CAT_MAP.get("landmark")!;
}

export function isLandmarkCategory(v: unknown): v is LandmarkCategory {
  return typeof v === "string" && CAT_MAP.has(v as LandmarkCategory);
}

// Validation
export const LANDMARK_NAME_MIN = 2;
export const LANDMARK_NAME_MAX = 48;
export const LANDMARK_NOTE_MAX = 120;
// Two landmarks closer than this with a similar name are almost certainly dupes.
export const LANDMARK_DEDUPE_M = 120;

// Drop control chars, collapse whitespace, cap length - so names stay clean.
export function cleanLandmarkName(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 32 && c !== 127) out += ch; // skip C0 controls + DEL
  }
  return out.replace(/\s+/g, " ").trim();
}

// Signed-message builders - the client signs, the server verifies the SAME
// string. Coordinates are fixed to 6 dp so both sides produce a byte-identical
// message regardless of float formatting.
export function landmarkCreateMessage(p: {
  id: string; name: string; category: string; lat: number; lng: number; timestamp: number;
}): string {
  return [
    "GoodDrops landmark:create",
    p.id,
    p.name,
    p.category,
    p.lat.toFixed(6),
    p.lng.toFixed(6),
    String(p.timestamp),
  ].join(":");
}

export function landmarkActionMessage(action: "update" | "delete", id: string, timestamp: number): string {
  return `GoodDrops landmark:${action}:${id}:${timestamp}`;
}

// Client-side id so create is idempotent on retry/replay (same id overwrites,
// never duplicates).
export function newLandmarkId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
export const LANDMARK_ID_RE = /^[a-z0-9]+-[a-z0-9]+$/i;

// ── Drop-hint clue integration ────────────────────────────────────────────────
// Only landmarks within this radius of a drop are offered as clue shortcuts —
// beyond it a place is no help pinpointing the drop.
export const LANDMARK_CLUE_RADIUS_M = 500;

// Merge a "Near <place>" reference into a drop's clue text. Idempotent (won't
// double-add a place already named), non-destructive (keeps what the dropper
// wrote), and capped to maxLen so it can never overflow the on-chain hint.
export function addLandmarkClue(hint: string, placeName: string, maxLen: number): string {
  const name = placeName.trim();
  if (!name) return hint;
  const base = hint.trim();
  if (base.toLowerCase().includes(name.toLowerCase())) return base.slice(0, maxLen);
  const combined = base ? `Near ${name} — ${base}` : `Near ${name}`;
  return combined.slice(0, maxLen);
}
