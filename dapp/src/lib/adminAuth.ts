import { createHash } from "crypto";

// Server-only. The cookie stores a hash of the password (never the raw value),
// so a leaked cookie doesn't reveal the password. Returns null when no
// ADMIN_PASSWORD is configured → the admin area fails closed.
export function adminToken(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return createHash("sha256").update(`gd-admin:${pw}`).digest("hex");
}

export const ADMIN_COOKIE = "gd_admin";
