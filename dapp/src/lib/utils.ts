export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatG$(wei: bigint): string {
  const n = Number(wei) / 1e18;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n >= 1) return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
  return n.toFixed(4);
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function timeLeft(expiry: number): string {
  const diff = expiry - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Expired";
  if (diff < 60) return `${diff}s`;
  if (diff < 3_600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86_400) return `${Math.floor(diff / 3_600)}h ${Math.floor((diff % 3_600) / 60)}m`;
  return `${Math.floor(diff / 86_400)}d ${Math.floor((diff % 86_400) / 3_600)}h`;
}

export function gpsToDeg(raw: number): number {
  return raw / 1_000_000;
}

export function degToGps(deg: number): number {
  return Math.round(deg * 1_000_000);
}

// ─── Flash drops ─────────────────────────────────────────────────────────────
// A drop is "flash" if it was originally created with ≤ 1 hour duration.

import type { Drop } from "@/types";
import { DROP_STATUS } from "@/types";

export function isFlashDrop(drop: Drop): boolean {
  if (drop.status !== DROP_STATUS.Active) return false;
  if (drop.expiry < Math.floor(Date.now() / 1000)) return false;
  if (!drop.createdAt) return false;
  return drop.expiry - drop.createdAt <= 3600;
}

// ─── Rarity ──────────────────────────────────────────────────────────────────

export type DropRarity = "common" | "uncommon" | "rare" | "legendary";

export function getDropRarity(amountWei: bigint): DropRarity {
  const g = Number(amountWei) / 1e18;
  if (g >= 200) return "legendary";
  if (g >= 50)  return "rare";
  if (g >= 10)  return "uncommon";
  return "common";
}

export const RARITY = {
  common:    { label: "Common",    color: "#666666", textColor: "#fff", glowRgb: "102,102,102",   animClass: ""                   },
  uncommon:  { label: "Uncommon",  color: "#BFFD00", textColor: "#111", glowRgb: "191,253,0",     animClass: "pin-pulse-uncommon"  },
  rare:      { label: "Rare",      color: "#00CFFF", textColor: "#111", glowRgb: "0,207,255",     animClass: "pin-pulse-rare"      },
  legendary: { label: "Legendary", color: "#FFD700", textColor: "#111", glowRgb: "255,215,0",     animClass: "pin-pulse-legendary" },
} as const;

// ─── Bearing ─────────────────────────────────────────────────────────────────

// Opens Google Maps with walking directions on both iOS and Android.
// Uses comgooglemaps:// deep link on iOS (falls back to web if app not installed).
export function openGoogleMapsWalking(lat: number, lng: number) {
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
  const isIOS  = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isIOS) {
    // Try opening the Google Maps app; if not installed, fall back to web
    const appUrl = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=walking`;
    const start  = Date.now();
    window.location.href = appUrl;
    // After 1.5s — if the app opened, the page will be backgrounded and this won't fire
    const timer = setTimeout(() => {
      if (Date.now() - start < 2000) window.open(webUrl, "_blank");
    }, 1500);
    // Clean up if page visibility changes (app opened successfully)
    const cleanup = () => { clearTimeout(timer); document.removeEventListener("visibilitychange", cleanup); };
    document.addEventListener("visibilitychange", cleanup);
  } else {
    // Android: Google Maps web URL triggers the app via intent system
    window.open(webUrl, "_blank", "noopener,noreferrer");
  }
}

export function calculateBearing(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function formatDegrees(raw: number): string {
  const deg = gpsToDeg(raw);
  const abs = Math.abs(deg).toFixed(4);
  return deg >= 0 ? `${abs}°` : `-${abs}°`;
}

// ─── Private drop encoding ────────────────────────────────────────────────────
// Format stored in the on-chain hint field:
//   [P:0xADDRESS]user hint text   ← private, targeted at specific wallet
//   [P:]user hint text             ← private, no specific target
// Plain hint text means a public drop.

const PRIVATE_RE = /^\[P:([^\]]*)\]([\s\S]*)/;

export function parseDropHint(raw: string): {
  isPrivate: boolean;
  target: string | null;
  hint: string;
} {
  const m = raw.match(PRIVATE_RE);
  if (!m) return { isPrivate: false, target: null, hint: raw };
  return { isPrivate: true, target: m[1] || null, hint: m[2] };
}

export function buildPrivateHint(hint: string, targetAddress: string): string {
  return `[P:${targetAddress}]${hint}`;
}

export function buildPrivateHintNoTarget(hint: string): string {
  return `[P:]${hint}`;
}
