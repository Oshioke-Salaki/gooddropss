// Idle drift: when the hunter stops touching the map at street level, the
// camera slowly circles the scene, like a game's attract screen, so the city
// and its treasure feel alive. The first touch, scroll or key stops it at once;
// it resumes after a quiet spell. Plain jumps on animation frames, skipped
// whenever anything else moves the camera, so it never fights a gesture or a
// fly-to.

import type maplibregl from "maplibre-gl";

const IDLE_MS = 9_000;
const DEG_PER_SEC = 1.5;
const MIN_ZOOM = 14;
const MIN_PITCH = 30;

export function idleOrbit(map: maplibregl.Map): () => void {
  let lastTouch = performance.now();
  let last = performance.now();
  let raf = 0;
  let stopped = false;
  const container = map.getContainer();
  const touched = () => { lastTouch = performance.now(); };
  const events = ["pointerdown", "wheel", "keydown", "touchstart"] as const;
  for (const e of events) container.addEventListener(e, touched, { passive: true });

  function frame(now: number) {
    if (stopped) return;
    const dt = Math.min(100, now - last);
    last = now;
    const idle = now - lastTouch > IDLE_MS;
    if (idle && !document.hidden && !map.isMoving() && map.getZoom() >= MIN_ZOOM && map.getPitch() >= MIN_PITCH) {
      map.setBearing(map.getBearing() + (DEG_PER_SEC * dt) / 1000);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    for (const e of events) container.removeEventListener(e, touched);
  };
}
