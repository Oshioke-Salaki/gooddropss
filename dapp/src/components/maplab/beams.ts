// Beams of light over rare and legendary drops.
//
// Drawn as light, not geometry: MapLibre shades every 3D shape by the scene's
// light, so an extruded "beam" at night reads as a dark post. These are small
// on-screen elements instead: a bright gold core inside a wide soft bloom,
// blended with `screen` so they brighten whatever is behind them, with a spark
// drifting up every few seconds. A vertical line in the world stays vertical on
// screen at any pitch (the camera never rolls), so they always point to the sky.
//
// Only rare and legendary drops get one, so there are few elements; they scale
// with zoom, appear as the camera comes down to the street, and rest under
// reduced motion. The marker's root element is never transformed (MapLibre
// positions it), so beams never drift while the map pans.

import maplibregl from "maplibre-gl";
import type { Drop } from "@/types";
import { getDropRarity, gpsToDeg, type DropRarity } from "@/lib/utils";
import { DROP_STATUS } from "@/types";

/** Beam height in px at zoom 16.5; 0 = no beam. */
export const BEAM_PX: Record<DropRarity, number> = { common: 0, uncommon: 0, rare: 150, legendary: 260 };
const BASE_ZOOM = 16.5;
const MIN_ZOOM = 13;

export interface BeamSpot { id: string; lng: number; lat: number; rarity: DropRarity; height: number }

/** Where beams go: live, public, rare or legendary drops. Pure. */
export function beamSpots(drops: Drop[], nowSec = Math.floor(Date.now() / 1000)): BeamSpot[] {
  const out: BeamSpot[] = [];
  for (const d of drops) {
    if (d.status !== DROP_STATUS.Active || d.expiry <= nowSec) continue;
    if (d.lat === 0 && d.lng === 0) continue;
    const rarity = getDropRarity(d.amount);
    if (BEAM_PX[rarity] === 0) continue;
    out.push({ id: d.id.toString(), lng: gpsToDeg(d.lng), lat: gpsToDeg(d.lat), rarity, height: BEAM_PX[rarity] });
  }
  return out;
}

/** Beam scale at a zoom: 1 at street level, smaller zoomed out, capped up close. */
export function beamScale(zoom: number): number {
  return Math.min(1.8, Math.max(0.3, 2 ** (zoom - BASE_ZOOM)));
}

const STYLE_ID = "gd-beam-style";
const CSS = `
.gd-beams-off .gd-beam-root{display:none}
.gd-beam-root{width:0;height:0;pointer-events:none;z-index:0}
.gd-beam{position:absolute;left:0;bottom:0;width:var(--w);height:calc(var(--h) * var(--gd-beam-s, 1));
  transform:translateX(-50%);pointer-events:none;mix-blend-mode:screen}
.gd-beam::before{content:"";position:absolute;left:50%;bottom:0;width:calc(var(--w) * 7);height:100%;transform:translateX(-50%);
  background:radial-gradient(60% 100% at 50% 100%,rgba(255,180,0,.55),rgba(255,180,0,.12) 55%,rgba(255,180,0,0) 75%);filter:blur(6px)}
.gd-beam::after{content:"";position:absolute;inset:0;border-radius:999px;
  background:linear-gradient(to top,#FFF6D6 0%,rgba(255,214,102,.95) 18%,rgba(255,194,26,.55) 55%,rgba(255,194,26,0) 100%);
  box-shadow:0 0 6px rgba(255,200,60,.9),0 0 18px rgba(255,170,0,.5)}
.gd-beam-spark{position:absolute;left:50%;bottom:0;width:calc(var(--w) * 1.6);height:calc(var(--w) * 1.6);margin-left:calc(var(--w) * -.8);
  border-radius:50%;background:#FFF8E1;box-shadow:0 0 8px 3px rgba(255,210,90,.9);opacity:0;z-index:1;
  animation:gd-beam-rise 3.2s cubic-bezier(.3,.1,.4,1) infinite}
@keyframes gd-beam-rise{0%{transform:translateY(0);opacity:0}12%{opacity:1}80%{opacity:.6}100%{transform:translateY(calc(var(--h) * var(--gd-beam-s, 1) * -1));opacity:0}}
@media (prefers-reduced-motion: reduce){.gd-beam-spark{display:none}}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function beamElement(spot: BeamSpot, delayMs: number): HTMLElement {
  const root = document.createElement("div");
  root.className = "gd-beam-root";
  root.setAttribute("aria-hidden", "true");
  const beam = document.createElement("div");
  beam.className = "gd-beam";
  beam.style.setProperty("--h", `${spot.height}px`);
  beam.style.setProperty("--w", spot.rarity === "legendary" ? "5px" : "3.5px");
  const spark = document.createElement("div");
  spark.className = "gd-beam-spark";
  spark.style.animationDelay = `${-delayMs}ms`; // beams don't spark in unison
  beam.appendChild(spark);
  root.appendChild(beam);
  return root;
}

export interface Beams {
  update(drops: Drop[]): void;
  destroy(): void;
}

export function attachBeams(map: maplibregl.Map): Beams {
  ensureStyle();
  const container = map.getContainer();
  const markers = new Map<string, maplibregl.Marker>();

  const onZoom = () => {
    const z = map.getZoom();
    container.style.setProperty("--gd-beam-s", String(beamScale(z)));
    container.classList.toggle("gd-beams-off", z < MIN_ZOOM);
  };
  onZoom();
  map.on("zoom", onZoom);

  return {
    update(drops) {
      const spots = beamSpots(drops);
      const keep = new Set(spots.map((s) => s.id));
      for (const [id, m] of markers) if (!keep.has(id)) { m.remove(); markers.delete(id); }
      for (const s of spots) {
        if (markers.has(s.id)) continue;
        const delay = (Number(s.id) * 977) % 3200;
        markers.set(s.id, new maplibregl.Marker({ element: beamElement(s, delay), anchor: "bottom" }).setLngLat([s.lng, s.lat]).addTo(map));
      }
    },
    destroy() {
      map.off("zoom", onZoom);
      for (const m of markers.values()) m.remove();
      markers.clear();
      container.classList.remove("gd-beams-off");
      container.style.removeProperty("--gd-beam-s");
    },
  };
}
