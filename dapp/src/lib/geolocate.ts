// Robust one-shot geolocation for mobile browsers.
//
// A single high-accuracy getCurrentPosition() frequently TIMES OUT indoors: the
// GPS radio can't see the sky and the call resolves with nothing. The fix is
// watchPosition() — it resolves on the FIRST fix the OS produces, including a
// fast cell/wifi triangulation, and keeps trying until one lands. Strategy:
//   1. Instant  — accept a recent cached fix if the OS already has one.
//   2. Watch    — high-accuracy watch, resolve on the first fix (up to budgetMs).
//   3. Last resort — any last-known position, however stale, before giving up.

export type GeoFailKind = "denied" | "unavailable" | "timeout";
export interface GeoFail { code: number; kind: GeoFailKind }

export function getPositionRobust(opts?: { budgetMs?: number }): Promise<GeolocationPosition> {
  const budgetMs = opts?.budgetMs ?? 24_000;
  return new Promise<GeolocationPosition>((resolve, reject) => {
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : null;
    if (!geo) { reject({ code: 2, kind: "unavailable" } as GeoFail); return; }

    let settled = false;
    let watchId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      if (watchId !== null) geo.clearWatch(watchId);
      if (timer) clearTimeout(timer);
    };
    const ok = (p: GeolocationPosition) => { if (settled) return; settled = true; done(); resolve(p); };
    const bad = (kind: GeoFailKind, code: number) => { if (settled) return; settled = true; done(); reject({ code, kind } as GeoFail); };
    const kindOf = (e: GeolocationPositionError): GeoFailKind =>
      e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable";

    // 1) Instant path — a recent cached fix returns immediately if the OS has one.
    geo.getCurrentPosition(
      ok,
      (e1) => {
        if (settled) return;
        if (e1.code === e1.PERMISSION_DENIED) { bad("denied", 1); return; }

        // 2) Watch for the first live fix. watchPosition emits as soon as ANY
        //    position lands (often a quick network fix), succeeding where a
        //    single GPS read would time out. Ignore its own timeout — the budget
        //    timer below owns the fallback — but honour a permission revocation.
        watchId = geo.watchPosition(
          ok,
          (e2) => { if (e2.code === e2.PERMISSION_DENIED) bad("denied", 1); },
          { enableHighAccuracy: true, timeout: budgetMs + 5_000, maximumAge: 0 },
        );

        // 3) Budget exhausted — take ANY last-known position, else surface the error.
        timer = setTimeout(() => {
          if (settled) return;
          geo.getCurrentPosition(
            ok,
            (e3) => bad(kindOf(e3), e3.code),
            { enableHighAccuracy: false, timeout: 8_000, maximumAge: Infinity },
          );
        }, budgetMs);
      },
      { enableHighAccuracy: true, timeout: 6_000, maximumAge: 60_000 },
    );
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
