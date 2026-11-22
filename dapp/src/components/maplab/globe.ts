// The globe intro: a slow turn of the Earth while the app finds the hunter,
// until the dive to their street begins.
//
// Driven by animation frames with plain jumps (no eased animations), so it can
// never fight the camera: whenever anything else is moving the map (the dive,
// a drag) it simply skips that frame. Stops for good at the first touch, or
// once the camera is past globe zoom.

import type maplibregl from "maplibre-gl";

/** Above this zoom the map is no longer a globe view: the spin ends. */
const GLOBE_MAX_ZOOM = 3.5;

/** Start the spin. Returns a function that stops it (safe to call twice). */
export function spinGlobe(map: maplibregl.Map, { degreesPerSecond = 3 }: { degreesPerSecond?: number } = {}): () => void {
  let stopped = false;
  let raf = 0;
  let last = performance.now();
  const container = map.getContainer();
  const interacted = () => stop();

  function frame(now: number) {
    if (stopped) return;
    const dt = Math.min(100, now - last); // a backgrounded tab mustn't jump the globe
    last = now;
    if (map.getZoom() >= GLOBE_MAX_ZOOM) return stop();
    if (!map.isMoving()) {
      const c = map.getCenter();
      map.setCenter([c.lng + (degreesPerSecond * dt) / 1000, c.lat]);
    }
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    container.removeEventListener("pointerdown", interacted);
    container.removeEventListener("wheel", interacted);
  }

  container.addEventListener("pointerdown", interacted, { passive: true });
  container.addEventListener("wheel", interacted, { passive: true });
  raf = requestAnimationFrame(frame);
  return stop;
}
