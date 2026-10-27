import { formatG$, parseDropHint, isFlashDrop } from "@/lib/utils";
import { DROP_STATUS, type Drop } from "@/types";

// Marker markup for the map. These build HTML STRINGS rather than JSX because
// MapLibre markers take DOM elements — mounting a React root per marker would
// cost one reconciler per chest, and there can be hundreds on screen. Tailwind
// classes still work (markers are ordinary DOM) and the scanner reads them out
// of these template literals, so the pills keep the design tokens and `lg:`
// variants for free.

// ── Value tiers ───────────────────────────────────────────────────────────────
// Banded by whole G$, not by the `getDropRarity` buckets — a hunter scanning the
// map reads "how much", and the colour is the shorthand for it. `max` is the
// inclusive upper bound; the last band catches everything above.
interface Tier {
  max: number;
  bg: string;
  border: string;
  text: string;
}

export const DROP_TIERS: Tier[] = [
  { max: 100, bg: "#EAFFE3", border: "#BAD9B6", text: "#529F63" },
  { max: 200, bg: "#E3F0FF", border: "#B6D0D9", text: "#529F94" },
  { max: 300, bg: "#E2B387", border: "#A57D64", text: "#854F31" },
  { max: 400, bg: "#EFEFEF", border: "#BDC2C8", text: "#666666" },
  { max: Infinity, bg: "#FFF0BD", border: "#D4BD89", text: "#854F31" },
];

/** The band a wei amount falls into. */
export function dropTier(amountWei: bigint): Tier {
  const g = Number(amountWei) / 1e18;
  return (
    DROP_TIERS.find((t) => g <= t.max) ?? DROP_TIERS[DROP_TIERS.length - 1]
  );
}

// ── Geometry ──────────────────────────────────────────────────────────────────
// ONE source of truth for the landmark pill's dimensions. Three things depend on
// these agreeing: the CSS that draws it, the marker offset that puts the pin's
// tip on the coordinate, and the collision test that decides which labels
// survive. If they drift, labels anchor or cull wrongly.
export const LM = {
  /** Pin artwork, one size at every breakpoint so the tip maths stays single-valued. */
  pinW: 28,
  pinH: 45,
  pinLeft: 8,
  /** How far the pin's tip sits above the pill's bottom edge. */
  pinBottom: 10,
  /**
   * Fixed so the tip's y-offset doesn't change when the count chip appears.
   * 32px chest + 3px above and below.
   */
  height: 38,
  /** Left padding, clearing the pin. */
  padLeft: 40,
  padRight: 16,
  padRightWithCount: 4,
  /** Chest artwork, square. */
  chest: 32,
  /**
   * Chest + count chip, including its leading gap:
   * 8 (pill gap-x-2) + 32 (chest) + 4 (inner gap-x-1) + 28 (min-w-7 chip).
   */
  countW: 72,
  /**
   * MUST match the rendered name (`text-sm/none` = 14px, one size at every
   * breakpoint on purpose). If this drifts, every collision box is measured at
   * the wrong width and labels cull or overlap for no visible reason.
   */
  font: '400 14px "DM Sans", system-ui, sans-serif',
} as const;

/** Where the pin's tip sits inside the element box, so the marker can offset to it. */
export const PIN_TIP = {
  x: LM.pinLeft + LM.pinW / 2,
  y: LM.height - LM.pinBottom,
} as const;

// ── Shared markup bits ────────────────────────────────────────────────────────

const CHEST = "/treasure-chest.png";

/**
 * Every map pill's shell — translucent white over a 20px blur, so the basemap
 * reads through it.
 *
 * Anything painted DIRECTLY on this has to be white: at 20% white over a dark
 * basemap, dark text disappears. The value and count chips are exempt because
 * they carry their own solid backgrounds.
 */
const PILL_GLASS =
  "bg-[#FFFFFF33] backdrop-blur-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.22)]";

/** 32×32 at every breakpoint. Kept in sync with LM.chest below. */
const CHEST_IMG =
  `<img src="${CHEST}" alt="" width="32" height="32" ` +
  `class="w-8 h-8 shrink-0 select-none pointer-events-none" />`;

/** Escape anything user-authored before it goes near innerHTML. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Special-drop marks. The old chest encoded these as corner tags; the new pill
// has no room for four, so they collapse into one leading chip — losing them
// entirely would hide that a drop is a riddle, a chain link or a flash drop.
// See "Things we have to come back to.md": the designer is drawing proper
// variations to replace these placeholders.
// Lucide outlines (zap, gift, puzzle, link, star) inlined as strings — the
// marker is raw HTML, so React icons can't be used here.
const TYPE_GLYPH: Record<string, string> = {
  flash: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  task: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
  riddle: '<path d="M15.4 20.1a2 2 0 0 1-2.2-.6 2 2 0 0 0-3.2 0 2 2 0 0 1-2.4.5 2 2 0 0 1-1.1-2.1l.2-1.1a2 2 0 0 0-.5-1.7 2 2 0 0 0-1.7-.5l-1.1.2a2 2 0 0 1-2.1-1.1 2 2 0 0 1 .5-2.4 2 2 0 0 0 0-3.2 2 2 0 0 1-.6-2.2 2 2 0 0 1 1.9-1.4h1.2a2 2 0 0 0 1.7-1 2 2 0 0 0 0-2 2 2 0 0 1 .8-2.7 2 2 0 0 1 2.3.4l.8.8a2 2 0 0 0 1.7.5 2 2 0 0 0 1.7-.5l.8-.8a2 2 0 0 1 2.3-.4 2 2 0 0 1 .8 2.7 2 2 0 0 0 0 2 2 2 0 0 0 1.7 1h1.2a2 2 0 0 1 1.9 1.4 2 2 0 0 1-.6 2.2 2 2 0 0 0 0 3.2 2 2 0 0 1 .5 2.4 2 2 0 0 1-2.1 1.1l-1.1-.2a2 2 0 0 0-1.7.5 2 2 0 0 0-.5 1.7l.2 1.1a2 2 0 0 1-1.1 2.1z"/>',
  chain: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  campaign: '<path d="M11.5 2.6a.6.6 0 0 1 1 0l2.6 5.3 5.9.9a.6.6 0 0 1 .3 1l-4.3 4.1 1 5.8a.6.6 0 0 1-.9.6L12 17.6l-5.2 2.7a.6.6 0 0 1-.9-.6l1-5.8-4.3-4.1a.6.6 0 0 1 .3-1l5.9-.9z"/>',
};

function typeMark(drop: Drop): string {
  const p = parseDropHint(drop.hint);
  const kind = isFlashDrop(drop)
    ? "flash"
    : p.taskMerchantId !== null
      ? "task"
      : p.hasRiddle
        ? "riddle"
        : p.chainNextId !== null || p.isChainLast
          ? "chain"
          : p.campaignId !== null
            ? "campaign"
            : null;
  if (!kind) return "";
  return `<svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden>${TYPE_GLYPH[kind]}</svg>`;
}

// ── Drop badge ────────────────────────────────────────────────────────────────

/** A single live drop: white pill, chest, value chip tinted by tier. */
export function dropBadgeHTML(drop: Drop): string {
  const active =
    drop.status === DROP_STATUS.Active &&
    drop.expiry > Math.floor(Date.now() / 1000);

  // Expired-but-still-Active edge case — dim, grey, clearly spent.
  if (!active) {
    return `
      <div class="flex items-center gap-x-1 rounded-full ${PILL_GLASS} p-0.5 pl-2.5 opacity-50 grayscale">
        ${CHEST_IMG}
        <div class="rounded-full border border-[#BDC2C8] bg-[#EFEFEF] px-2 py-1.5 text-[11px]/none text-[#666666]">
          Gone
        </div>
      </div>`;
  }

  const t = dropTier(drop.amount);
  return `
    <div class="flex items-center gap-x-1 rounded-full ${PILL_GLASS} p-0.5 pl-2.5 lg:gap-x-1.5 lg:pl-3">
      ${CHEST_IMG}
      ${typeMark(drop)}
      <div class="whitespace-nowrap rounded-full border px-2 py-1.5 text-[11px]/none lg:px-2.5 lg:py-2 lg:text-xs/none"
           style="background:${t.bg};border-color:${t.border};color:${t.text};">
        ${formatG$(drop.amount)} G$
      </div>
    </div>`;
}

// ── Cluster badge ─────────────────────────────────────────────────────────────

/** Several drops too close to separate at this zoom, and not tied to a landmark. */
export function clusterBadgeHTML(count: number): string {
  return `
    <div class="flex items-center gap-x-1 rounded-full ${PILL_GLASS} p-0.5 pl-2.5 lg:gap-x-1.5 lg:pl-3">
      ${CHEST_IMG}
      <div class="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-[11px]/none text-white lg:h-7 lg:min-w-7 lg:text-xs/none">
        ${count}
      </div>
    </div>`;
}

// ── Landmark badge ────────────────────────────────────────────────────────────

export interface LandmarkBadgeOpts {
  name: string;
  /** Live drops at this place. Shown only when `aggregate` is true. */
  dropCount: number;
  /**
   * True when zoomed out far enough that individual drops aren't separable —
   * the pill then carries the count instead, so a busy place reads as busy
   * rather than as one anonymous cluster.
   */
  aggregate: boolean;
}

export function landmarkBadgeHTML({
  name,
  dropCount,
  aggregate,
}: LandmarkBadgeOpts): string {
  const showCount = aggregate && dropCount > 0;
  return `
    <div class="relative flex items-center gap-x-2 rounded-full ${PILL_GLASS}"
         style="height:${LM.height}px;padding-left:${LM.padLeft}px;padding-right:${
           showCount ? LM.padRightWithCount : LM.padRight
         }px;">
      <img src="/location-pin.svg" alt="" width="${LM.pinW}" height="${LM.pinH}"
           class="absolute select-none pointer-events-none"
           style="left:${LM.pinLeft}px;bottom:${LM.pinBottom}px;width:${LM.pinW}px;height:${LM.pinH}px;" />
      <span class="max-w-[150px] truncate text-sm/none text-white lg:max-w-[260px]">${esc(name)}</span>
      ${
        showCount
          ? `
        <span class="flex items-center gap-x-1 shrink-0">
          ${CHEST_IMG}
          <span class="flex h-7 min-w-7 items-center justify-center rounded-full bg-brand px-1.5 text-xs/none text-white">
            ${dropCount}
          </span>
        </span>`
          : ""
      }
    </div>`;
}

// ── Label collision ───────────────────────────────────────────────────────────
// Text width is measured with a canvas rather than a DOM reflow: this runs on
// every pan, and forcing layout per landmark per frame is what makes a map feel
// sticky. Results are cached by name, so after the first pass it's free.
let ctx: CanvasRenderingContext2D | null | undefined;
const textCache = new Map<string, number>();

function textWidth(name: string): number {
  const cached = textCache.get(name);
  if (cached !== undefined) return cached;
  if (ctx === undefined) {
    const canvas =
      typeof document !== "undefined" ? document.createElement("canvas") : null;
    ctx = canvas?.getContext("2d") ?? null;
    if (ctx) ctx.font = LM.font;
  }
  // No canvas (SSR, or a browser that refuses one) — fall back to an estimate
  // that errs wide, so culling stays conservative rather than letting labels overlap.
  const w = ctx ? ctx.measureText(name).width : name.length * 7.5;
  textCache.set(name, w);
  return w;
}

/** The pill's on-screen box, for deciding which labels can coexist. */
export function landmarkBadgeSize(
  name: string,
  showCount: boolean,
): { w: number; h: number } {
  // Mirrors the `max-w-*` truncation above, so a long name is measured at the
  // width it will actually render, not its full length.
  const text = Math.min(textWidth(name), 260);
  return {
    w:
      LM.padLeft +
      text +
      (showCount ? LM.countW : 0) +
      (showCount ? LM.padRightWithCount : LM.padRight),
    // The pin overhangs the pill's top, and that overhang is part of what collides.
    h: Math.max(LM.height, LM.pinH + LM.pinBottom),
  };
}

// ── Event pin ────────────────────────────────────────────────────────────────

// lucide "activity": a still "happening now" mark instead of a pulsing dot.
const LIVE_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>';

const CALENDAR_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden><path d="M8 2v4"/><path d="M16 2v4"/>' +
  '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>';

/**
 * An event on the map: brand calendar mark, the (shortened) title, then either a
 * pulsing "Live" chip or when it starts, then the budget. Same glass family as
 * the drop and shop pills so it reads as part of the map, but blue-led so it
 * never gets mistaken for a single drop.
 */
export function eventPinHTML({ title, live, when, budget }: { title: string; live: boolean; when: string; budget: string }): string {
  const short = title.length > 24 ? `${title.slice(0, 23).trimEnd()}…` : title;
  const state = live
    ? `<span class="inline-flex items-center gap-1.5 rounded-full bg-streak px-2 py-1.5 text-[11px]/none text-white lg:text-xs/none">
         ${LIVE_ICON}Live</span>`
    : `<span class="rounded-full bg-white px-2 py-1.5 text-[11px]/none text-heading lg:text-xs/none whitespace-nowrap">${esc(when)}</span>`;
  return `
    <div class="flex items-center gap-x-1.5 rounded-full ${PILL_GLASS} p-0.5 pr-1 select-none font-sans">
      <span class="w-7 h-7 shrink-0 rounded-full bg-brand text-white flex items-center justify-center">${CALENDAR_ICON}</span>
      <span class="max-w-[150px] truncate text-white text-xs/none lg:text-sm/none pl-0.5">${esc(short)}</span>
      ${state}
      <span class="rounded-full bg-brand px-2 py-1.5 text-[11px]/none text-white lg:text-xs/none whitespace-nowrap">${esc(budget)}</span>
    </div>`;
}
