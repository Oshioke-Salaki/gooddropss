// Robust one-shot geolocation for mobile browsers.
//
// Why this exists: a single high-accuracy getCurrentPosition() (enableHighAccuracy
// + maximumAge:0) waits for a fresh GPS satellite lock, which TIMES OUT indoors —
// this is why the merchant "pin my shop" button failed while the main map worked.
// The map succeeds because its first read is COARSE and cache-friendly (cell/wifi),
// then it refines with a background high-accuracy watch. This helper does the same
// in one call: it fires both a fast coarse fix and a high-accuracy watch at once,
// then returns the BEST fix — resolving early once accuracy is good enough, and
// never hanging forever.
//
//   • coarse read  — fast, works indoors, gives an immediate rough position
//   • accuracy watch — refines toward a precise pin as GPS locks
//   • soft deadline — return the best fix we have (good enough, never stuck)
//   • hard budget  — nothing at all → accept ANY last-known position, else fail

export type GeoFailKind = "denied" | "unavailable" | "timeout";
export interface GeoFail { code: number; kind: GeoFailKind }

interface RobustOpts {
  budgetMs?: number;        // hard ceiling before we give up
  softMs?: number;          // return best-so-far after this
  desiredAccuracyM?: number; // resolve immediately once a fix is at least this precise
}

export function getPositionRobust(opts?: RobustOpts): Promise<GeolocationPosition> {
  const budgetMs = opts?.budgetMs ?? 22_000;
  const softMs   = opts?.softMs ?? 8_000;
  const desired  = opts?.desiredAccuracyM ?? 65;

  return new Promise<GeolocationPosition>((resolve, reject) => {
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : null;
    if (!geo) { reject({ code: 2, kind: "unavailable" } as GeoFail); return; }

    let settled = false;
    let best: GeolocationPosition | null = null;
    let watchId: number | null = null;
    let softTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (watchId !== null) geo.clearWatch(watchId);
      if (softTimer) clearTimeout(softTimer);
      if (hardTimer) clearTimeout(hardTimer);
    };
    const succeed = (p: GeolocationPosition) => { if (settled) return; settled = true; cleanup(); resolve(p); };
    const fail = (kind: GeoFailKind, code: number) => { if (settled) return; settled = true; cleanup(); reject({ code, kind } as GeoFail); };
    const kindOf = (e: GeolocationPositionError): GeoFailKind =>
      e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable";

    // Every fix (coarse or precise) feeds here; keep the most accurate one and
    // resolve the moment it's good enough.
    const onFix = (p: GeolocationPosition) => {
      if (settled) return;
      if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
      if (best.coords.accuracy <= desired) succeed(best);
    };
    // Only a revoked permission is fatal here — plain timeouts are expected while
    // we wait for a better fix; the timers own the fallback.
    const onErr = (e: GeolocationPositionError) => { if (e.code === e.PERMISSION_DENIED) fail("denied", 1); };

    // A) High-accuracy watch — refines toward a precise pin.
    watchId = geo.watchPosition(onFix, onErr, { enableHighAccuracy: true, timeout: budgetMs, maximumAge: 0 });

    // B) Fast coarse fix — the read that reliably returns indoors (mirrors the map).
    geo.getCurrentPosition(onFix, onErr, { enableHighAccuracy: false, timeout: softMs, maximumAge: 60_000 });

    // Soft deadline — precise enough or not, ship the best fix we've collected.
    softTimer = setTimeout(() => { if (best) succeed(best); }, softMs);

    // Hard budget — still nothing at all: accept ANY last-known position, else fail.
    hardTimer = setTimeout(() => {
      if (settled) return;
      if (best) { succeed(best); return; }
      geo.getCurrentPosition(
        succeed,
        (e) => fail(kindOf(e), e.code),
        { enableHighAccuracy: false, timeout: 8_000, maximumAge: Infinity },
      );
    }, budgetMs);
  });
}

export function geoErrorMessage(kind: GeoFailKind, context: "shop" | "drop" = "drop"): string {
  if (kind === "denied") {
    return "Location is blocked. Allow location access for this site (or open it in Chrome/Safari), then try again.";
  }
  if (kind === "unavailable") {
    return "Couldn't get your location — turn on location/GPS in your phone settings, then try again.";
  }
  // timeout — got permission but no fix landed in time
  return context === "shop"
    ? "Still no GPS fix. Step near a window or just outside for a moment, then tap again."
    : "Still no GPS fix. Step near a window or outside, then try again.";
}
