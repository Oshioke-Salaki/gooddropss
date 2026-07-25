// Anti-spoof for GPS claims. The claim-proof route is the single gate on every
// claim, so presence is only as trustworthy as these checks. Runs in one of
// three modes via ANTISPOOF_MODE:
//
//   "off"     — no checks (old behaviour; not recommended)
//   "shadow"  — evaluate + LOG suspicious claims, never block (default; run this
//               for a few days, review /admin/health, then switch)
//   "enforce" — block claims that trip a hard signal
//
// Pure decision logic lives in `evaluateSpoofSignals` so it's unit-testable.

export type AntispoofMode = "off" | "shadow" | "enforce";

export function antispoofMode(): AntispoofMode {
  const m = (process.env.ANTISPOOF_MODE ?? "shadow").toLowerCase();
  return m === "off" || m === "enforce" ? m : "shadow";
}

export interface SpoofInputs {
  /** km between IP geolocation and reported GPS; null = geo unavailable */
  ipDistanceKm: number | null;
  /** IP flagged as proxy/VPN or datacenter by the geo provider */
  proxyOrHosting: boolean;
  /** reported GPS accuracy in metres; null = client didn't send it */
  accuracyM: number | null;
  /** age of the GPS fix in ms; null = client didn't send it */
  fixAgeMs: number | null;
}

export interface SpoofVerdict {
  /** trip enforcement (block in enforce mode) */
  block: boolean;
  /** worth logging even when not blocking */
  suspicious: boolean;
  reasons: string[];
  /** user-facing message when blocked */
  userMessage: string | null;
}

// Generous thresholds by design: mobile carrier IPs geolocate poorly (often a
// city or two away), so false positives are the real enemy. VPN/datacenter and
// extreme IP distance are hard signals; fix quality is soft (log-only) because
// older clients don't send it.
export const IP_HARD_KM   = 1500; // block beyond this (different country/continent)
export const IP_SOFT_KM   = 400;  // log beyond this
export const ACCURACY_SOFT_M = 200;
export const FIX_STALE_MS    = 120_000;

export function evaluateSpoofSignals(s: SpoofInputs): SpoofVerdict {
  const reasons: string[] = [];
  let block = false;
  let userMessage: string | null = null;

  if (s.proxyOrHosting) {
    reasons.push("vpn_or_datacenter_ip");
    block = true;
    userMessage = "VPN or proxy detected — turn it off to claim.";
  }

  if (s.ipDistanceKm !== null) {
    if (s.ipDistanceKm > IP_HARD_KM) {
      reasons.push(`ip_gps_distance_${Math.round(s.ipDistanceKm)}km`);
      block = true;
      userMessage = userMessage ?? "Your network location doesn't match your GPS position.";
    } else if (s.ipDistanceKm > IP_SOFT_KM) {
      reasons.push(`ip_gps_distance_soft_${Math.round(s.ipDistanceKm)}km`);
    }
  }

  // Soft signals — never block on their own (older clients omit them).
  if (s.accuracyM !== null && s.accuracyM > ACCURACY_SOFT_M) {
    reasons.push(`low_accuracy_${Math.round(s.accuracyM)}m`);
  }
  if (s.fixAgeMs !== null && s.fixAgeMs > FIX_STALE_MS) {
    reasons.push(`stale_fix_${Math.round(s.fixAgeMs / 1000)}s`);
  }

  return { block, suspicious: reasons.length > 0, reasons, userMessage };
}

export interface SpoofFlag {
  ts: number;
  dropId: string;
  claimer: string;
  root: string;
  ip: string;
  mode: AntispoofMode;
  blocked: boolean;
  reasons: string[];
}
