import { NextRequest, NextResponse } from "next/server";
import { adminToken, ADMIN_COOKIE } from "@/lib/adminAuth";

export const runtime = "nodejs";

// POST /api/admin/login  { password }
// Validates against the server-only ADMIN_PASSWORD and sets an httpOnly session
// cookie. The password itself never reaches the client bundle.
export async function POST(req: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "Admin password not configured on the server." }, { status: 503 });
  }

  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || password !== expected) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = adminToken();
  if (!token) return NextResponse.json({ error: "Server error." }, { status: 500 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return res;
}
