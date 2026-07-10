import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Server-only Supabase client (service role — never exposed to the browser).
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// POST /api/lookup  { email }
// Returns the legacy Focus-Pet account for this email so the UI knows which
// wallet provider to present. Only privy/web3auth accounts can be migrated via
// this email flow (minipay users hold self-custody wallets, no email).
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
    }

    const supabase = admin();
    if (!supabase) return NextResponse.json({ error: "Lookup unavailable" }, { status: 503 });

    const { data, error } = await supabase
      .from("users")
      .select("email, auth_type, wallet_address")
      .ilike("email", email.trim())
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[lookup]", error);
      return NextResponse.json({ error: "Lookup failed — try again" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ found: false });
    }

    const authType = String(data.auth_type ?? "").toLowerCase();
    const migratable = authType === "privy" || authType === "web3auth";

    return NextResponse.json({
      found: true,
      migratable,
      authType,
      wallet: (data.wallet_address ?? "").toLowerCase() || null,
    });
  } catch (e) {
    console.error("[lookup]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
