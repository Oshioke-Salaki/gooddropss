import { cookies } from "next/headers";
import { adminToken, ADMIN_COOKIE } from "@/lib/adminAuth";
import { AdminLogin } from "@/components/AdminLogin";

// Server-side gate for every /admin/* route (including /admin/analytics).
// Validates the httpOnly cookie against the hashed ADMIN_PASSWORD. Fails closed
// if no password is configured.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token  = adminToken();
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value;
  const authed = !!token && cookie === token;

  if (!authed) return <AdminLogin configured={!!token} />;
  return <>{children}</>;
}
