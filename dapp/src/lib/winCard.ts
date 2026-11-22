// The win card: the image a hunter shares after a claim. 1080 x 1920 (9:16),
// the WhatsApp and Instagram Status format, drawn in the browser on a canvas,
// so it's instant and costs no server.
//
// Design (the direction the team picked for the flyers): flat brand blue, tight
// DM Sans, gold reserved for money, the open gold chest from the claim moment,
// and a clean white panel with a QR code that carries the sharer's invite link.
//
// Pure helpers (text fitting, wrapping, share text) are unit-tested; `drawWinCard`
// paints onto any 2D context; `renderWinCard` loads fonts and art, then returns a PNG.

import { formatUnits } from "viem";
import { RARITY, type DropRarity } from "@/lib/utils";

export const CARD = { w: 1080, h: 1920 } as const;

const C = {
  blue: "#2727E2",
  blueDeep: "#1C1CB0",
  white: "#FFFFFF",
  soft: "rgba(255,255,255,0.72)",
  faint: "rgba(255,255,255,0.14)",
  gold: "#FFC23D",
  heading: "#121607",
  muted: "#6B6E63",
} as const;

const FONT = `"DM Sans", system-ui, sans-serif`;
const PAD = 96;

export interface WinCardData {
  amount: bigint;
  rarity: DropRarity;
  /** The drop's clue or place, if any. */
  place: string | null;
  /** "@name" or a short address. */
  handle: string;
  /** Whole naira the find is worth in the bank (Nigeria only), or null. */
  naira: number | null;
  /** When it was found. */
  date: Date;
}

type Measure = (text: string, font: string) => number;

/** The largest font size (px, from max down to min) at which the text fits the width. */
export function fitFontSize(measure: Measure, text: string, weight: number, max: number, min: number, maxWidth: number): number {
  for (let size = max; size > min; size -= 4) {
    if (measure(text, `${weight} ${size}px ${FONT}`) <= maxWidth) return size;
  }
  return min;
}

/** Shorten text with "…" until it fits the width. */
function ellipsize(measure: Measure, text: string, font: string, maxWidth: number): string {
  if (measure(text, font) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`, font) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Split text into at most `maxLines` lines that fit the width; cut text ends in "…". */
export function wrapLines(measure: Measure, text: string, font: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, font) <= maxWidth) { line = next; continue; }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines.map((l) => ellipsize(measure, l, font, maxWidth));
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(measure, `${kept[maxLines - 1]}…`, font, maxWidth).replace(/……$/, "…");
  return kept;
}

/** The exact amount, never abbreviated: "1,000", "250,000", "12.5". */
export function formatWholeG(amount: bigint): string {
  return Number(formatUnits(amount, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** "₦1,550": Nigerian grouping. */
export function formatNairaWhole(n: number): string {
  return `₦${Math.floor(n).toLocaleString("en-NG")}`;
}

/** The message that goes with the card. Plain, specific, with the naira hook when known. */
export function winShareText({ amount, naira }: Pick<WinCardData, "amount" | "naira">): string {
  const worth = naira && naira > 0 ? ` (that's ${formatNairaWhole(naira)})` : "";
  return `I just found ${formatWholeG(amount)} G$${worth} hidden in the real world on GoodDrops. Real money, real places. Come hunt with me:`;
}

// ── Art ────────────────────────────────────────────────────────────────────────

/** The gold chest from the claim moment, open: lid swung back, light and coins pouring out. Vector. */
export const CHEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="600" height="600">
<defs>
<radialGradient id="halo" cx="50%" cy="52%" r="50%"><stop offset="0" stop-color="#FFE38A" stop-opacity=".8"/><stop offset=".5" stop-color="#FFC23D" stop-opacity=".22"/><stop offset="1" stop-color="#FFC23D" stop-opacity="0"/></radialGradient>
<linearGradient id="beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFF3B0" stop-opacity=".95"/><stop offset="1" stop-color="#FFE066" stop-opacity="0"/></linearGradient>
</defs>
<circle cx="60" cy="62" r="56" fill="url(#halo)"/>
<path d="M34 57 L48 10 L72 10 L86 57 Z" fill="url(#beam)" opacity=".7"/>
<path d="M26 40 Q26 22 60 22 Q94 22 94 40 L94 44 L26 44 Z" fill="#B8891F" stroke="#87640F" stroke-width="2.5"/>
<path d="M33 36 Q37 28 60 27" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2.5" stroke-linecap="round"/>
<rect x="26" y="44" width="68" height="13" rx="2" fill="#5A3E06"/>
<ellipse cx="60" cy="50" rx="30" ry="4.5" fill="#FFE066" opacity=".9"/>
<circle cx="50" cy="44" r="5" fill="#FFD700" stroke="#C99B26" stroke-width="1.6"/><circle cx="62" cy="40" r="5.5" fill="#FFD700" stroke="#C99B26" stroke-width="1.6"/>
<circle cx="72" cy="45" r="4.8" fill="#FFE066" stroke="#C99B26" stroke-width="1.5"/>
<circle cx="44" cy="27" r="4" fill="#FFD700" stroke="#C99B26" stroke-width="1.4"/><circle cx="76" cy="22" r="4.5" fill="#FFD700" stroke="#C99B26" stroke-width="1.4"/>
<circle cx="58" cy="14" r="3.6" fill="#FFE066" stroke="#C99B26" stroke-width="1.3"/>
<rect x="28" y="56" width="64" height="40" rx="5" fill="#C99B26" stroke="#87640F" stroke-width="2.5"/>
<rect x="23" y="55" width="74" height="10" rx="2.5" fill="#FFE066"/>
<rect x="39" y="56" width="5" height="40" fill="#FFE066" opacity=".9"/><rect x="76" y="56" width="5" height="40" fill="#FFE066" opacity=".9"/>
<rect x="53" y="57" width="14" height="17" rx="3" fill="#FFF3B0" stroke="#87640F" stroke-width="1.4"/><circle cx="60" cy="64" r="2.6" fill="#87640F"/>
</svg>`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${src.slice(0, 40)}`));
    img.src = src;
  });
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export interface WinCardArt {
  logo: CanvasImageSource | null;
  chest: CanvasImageSource | null;
  qr: CanvasImageSource | null;
}

// ── Drawing ────────────────────────────────────────────────────────────────────

/** Paint the card. Missing art is skipped, never fatal. */
export function drawWinCard(ctx: CanvasRenderingContext2D, d: WinCardData, art: WinCardArt): void {
  const { w, h } = CARD;
  const measure: Measure = (text, font) => { ctx.font = font; return ctx.measureText(text).width; };
  const set = (font: string, color: string, align: CanvasTextAlign = "left") => {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
  };
  const tight = (em: number) => { try { (ctx as unknown as { letterSpacing: string }).letterSpacing = `${em}px`; } catch { /* older browsers */ } };

  // Ground: flat brand blue, a touch deeper at the foot so the panel sits.
  const ground = ctx.createLinearGradient(0, 0, 0, h);
  ground.addColorStop(0, C.blue);
  ground.addColorStop(1, C.blueDeep);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);

  // Brand row.
  if (art.logo) ctx.drawImage(art.logo, PAD, 112, 72, 72);
  tight(-1);
  set(`500 52px ${FONT}`, C.white);
  ctx.fillText("GoodDrops", PAD + 92, 166);

  // Rarity pill, top right.
  const r = RARITY[d.rarity];
  tight(1.5);
  set(`600 28px ${FONT}`, C.white);
  const tag = r.label.toUpperCase();
  const tagW = measure(tag, ctx.font) + 84;
  const tagX = w - PAD - tagW;
  ctx.fillStyle = C.faint;
  ctx.beginPath(); ctx.roundRect(tagX, 116, tagW, 64, 32); ctx.fill();
  ctx.fillStyle = r.color;
  ctx.beginPath(); ctx.arc(tagX + 34, 148, 10, 0, Math.PI * 2); ctx.fill();
  set(`600 28px ${FONT}`, C.white);
  ctx.fillText(tag, tagX + 58, 158);

  // ── The hero block, laid out to fit between the header and the panel ────
  const maxW = w - PAD * 2;
  const PANEL_Y = 1452;
  const amt = formatWholeG(d.amount);
  const unit = " G$";

  // Amount + unit fit the width together (the unit is 40% of the amount's size).
  let size = 300;
  for (; size > 120; size -= 6) {
    tight(-size * 0.04);
    const total = measure(amt, `700 ${size}px ${FONT}`) + measure(unit, `700 ${Math.round(size * 0.4)}px ${FONT}`);
    if (total <= maxW) break;
  }
  const clueFont = `500 40px ${FONT}`;
  tight(0);
  const clue = d.place ? wrapLines(measure, `“${d.place.trim()}”`, clueFont, maxW - 40, 2) : [];
  const hasNaira = !!d.naira && d.naira > 0;

  // Heights of each piece, then centre the whole stack in the free space.
  const chestH = 520, foundH = 60, amountH = size * 0.82, nairaH = hasNaira ? 84 : 0, clueH = clue.length * 54;
  const gaps = 24 + 36 + (hasNaira ? 44 : 0) + (clue.length ? 44 : 0);
  const blockH = chestH + foundH + amountH + nairaH + clueH + gaps;
  const top = 230 + Math.max(0, (PANEL_Y - 60 - 230 - blockH) / 2);

  let y = top;
  if (art.chest) ctx.drawImage(art.chest, (w - chestH) / 2, y, chestH, chestH);
  y += chestH + 24;

  set(`500 48px ${FONT}`, C.soft, "center");
  ctx.fillText("I just found", w / 2, y + 44);
  y += foundH + 36;

  tight(-size * 0.04);
  const amtW = measure(amt, `700 ${size}px ${FONT}`);
  const unitSize = Math.round(size * 0.4);
  tight(0);
  const unitW = measure(unit, `700 ${unitSize}px ${FONT}`);
  const x0 = (w - amtW - unitW) / 2;
  const base = y + size * 0.74;
  tight(-size * 0.04);
  set(`700 ${size}px ${FONT}`, C.white);
  ctx.fillText(amt, x0, base);
  tight(0);
  set(`700 ${unitSize}px ${FONT}`, C.gold);
  ctx.fillText(unit, x0 + amtW, base);
  y += amountH;

  if (hasNaira) {
    y += 44;
    const txt = `≈ ${formatNairaWhole(d.naira!)} in the bank`;
    set(`500 40px ${FONT}`, C.white);
    const pw = measure(txt, ctx.font) + 72;
    ctx.fillStyle = C.faint;
    ctx.beginPath(); ctx.roundRect((w - pw) / 2, y, pw, 84, 42); ctx.fill();
    set(`500 40px ${FONT}`, C.white, "center");
    ctx.fillText(txt, w / 2, y + 56);
    y += nairaH;
  }

  if (clue.length) {
    y += 44;
    set(clueFont, C.soft, "center");
    clue.forEach((line, i) => ctx.fillText(line, w / 2, y + 40 + i * 54));
  }

  // The white panel: QR, the invite, who found it and when.
  const panelY = PANEL_Y, panelH = 372, panelX = 72, panelW = w - 144;
  ctx.save();
  ctx.shadowColor = "rgba(8,8,60,0.35)";
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = C.white;
  ctx.beginPath(); ctx.roundRect(panelX, panelY, panelW, panelH, 56); ctx.fill();
  ctx.restore();

  const qrSize = 268;
  const qrX = panelX + 52, qrY = panelY + (panelH - qrSize) / 2;
  if (art.qr) {
    ctx.imageSmoothingEnabled = false; // crisp modules
    ctx.drawImage(art.qr, qrX, qrY, qrSize, qrSize);
    ctx.imageSmoothingEnabled = true;
  }
  const tx = qrX + qrSize + 48;
  const textW = panelX + panelW - 52 - tx;
  tight(-1);
  set(`500 ${fitFontSize(measure, "Hunt with me", 500, 60, 40, textW)}px ${FONT}`, C.heading);
  ctx.fillText("Hunt with me", tx, panelY + 128);
  tight(0);
  set(`400 34px ${FONT}`, C.muted);
  ctx.fillText("Scan to find your first drop", tx, panelY + 182);
  set(`500 34px ${FONT}`, C.blue);
  ctx.fillText("gooddrops.xyz", tx, panelY + 236);
  const when = d.date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  // A long name ends in "…"; the date always shows in full. Never squeezed.
  const byFont = `400 28px ${FONT}`;
  const tail = ` · ${when}`;
  const name = ellipsize(measure, `Found by ${d.handle}`, byFont, textW - measure(tail, byFont));
  set(byFont, C.muted);
  ctx.fillText(name + tail, tx, panelY + 306);
}

/**
 * Render the card to a PNG. Waits for the brand font (so the canvas never falls
 * back to a system face), then the art. `qr` is a canvas with the invite QR.
 */
export async function renderWinCard(d: WinCardData, qr: HTMLCanvasElement | null): Promise<Blob> {
  if (typeof document !== "undefined" && document.fonts?.load) {
    await Promise.all([
      document.fonts.load(`700 300px "DM Sans"`),
      document.fonts.load(`500 52px "DM Sans"`),
      document.fonts.load(`400 34px "DM Sans"`),
    ]).catch(() => {});
  }
  const [logo, chest] = await Promise.all([
    loadImage("/logo-mark-white.svg").catch(() => null),
    loadImage(svgUrl(CHEST_SVG)).catch(() => null),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = CARD.w;
  canvas.height = CARD.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  drawWinCard(ctx, d, { logo, chest, qr });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't make the image"))), "image/png"));
}
