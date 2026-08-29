import { cookies } from "next/headers";
import { adminToken, ADMIN_COOKIE } from "@/lib/adminAuth";
import { AdminLogin } from "@/components/AdminLogin";
import { AdminShell } from "@/components/AdminShell";

// The gate reads the admin cookie on every request — never serve a cached or
// prefetched render, or an already-authed admin can flash the login screen (a
// stale render) until the next reload. Force a fresh dynamic render each time.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Server-side gate for every /admin/* route (including /admin/analytics).
// Validates the httpOnly cookie against the hashed ADMIN_PASSWORD. Fails closed
// if no password is configured.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token  = adminToken();
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value;
  const authed = !!token && cookie === token;

  if (!authed) return <AdminLogin configured={!!token} />;
  return <AdminShell>{children}</AdminShell>;
}
