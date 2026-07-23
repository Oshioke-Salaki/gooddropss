import { createHash } from "crypto";
import { cookies } from "next/headers";

// Server-only. The cookie stores a hash of the password (never the raw value),
// so a leaked cookie doesn't reveal the password. Returns null when no
// ADMIN_PASSWORD is configured → the admin area fails closed.
export function adminToken(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return createHash("sha256").update(`gd-admin:${pw}`).digest("hex");
}

export const ADMIN_COOKIE = "gd_admin";

// True only for a request carrying the valid admin session cookie (the same gate
// as the /admin pages). Fails closed if no password is configured. Use this to
// protect admin-only API routes without a wallet-signature round-trip.
export async function isAdminAuthed(): Promise<boolean> {
  const token = adminToken();
  if (!token) return false;
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value;
  return !!cookie && cookie === token;
}
