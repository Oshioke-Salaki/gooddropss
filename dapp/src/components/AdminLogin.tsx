"use client";
import { useState } from "react";
import { Lock, Loader2, Eye, EyeOff } from "lucide-react";
import { Logo } from "@/components/Logo";

export function AdminLogin({ configured }: { configured: boolean }) {
  const [pw, setPw]     = useState("");
  const [err, setErr]   = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  async function submit() {
    if (!pw || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) { window.location.reload(); return; }
      const b = await res.json().catch(() => ({}));
      setErr(b.error ?? "Incorrect password.");
    } catch {
      setErr("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-surface font-sans flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px] bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 lg:p-8">
        <Logo size="md" />

        <div className="flex items-center gap-3 mt-8">
          <span className="w-11.5 h-11.5 rounded-full bg-surface flex items-center justify-center text-heading shrink-0">
            <Lock className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl/none text-heading">Admin access</h1>
            <p className="text-sm/none text-nav-muted mt-2">
              {configured ? "Enter the admin password to continue." : "Not configured"}
            </p>
          </div>
        </div>

        {configured ? (
          <form className="mt-6 flex flex-col" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label className="relative block">
              <span className="sr-only">Password</span>
              <input
                type={show ? "text" : "password"}
                value={pw}
                autoFocus
                autoComplete="current-password"
                onChange={(e) => { setPw(e.target.value); setErr(""); }}
                placeholder="Password"
                disabled={busy}
                aria-invalid={!!err}
                className="w-full h-14 rounded-full bg-surface pl-5 pr-14 text-base/none text-heading
                  placeholder:text-nav-muted border border-transparent outline-none
                  motion-safe:transition-colors focus:border-brand disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center
                  text-nav-muted cursor-pointer motion-safe:transition-colors hover:text-heading hover:bg-white"
              >
                {show ? <EyeOff className="w-5 h-5" strokeWidth={1.75} /> : <Eye className="w-5 h-5" strokeWidth={1.75} />}
              </button>
            </label>

            {/* Fixed-height slot so the button never jumps when an error lands. */}
            <p role="status" aria-live="polite" className="h-4 mt-3 px-5 text-sm/none text-danger truncate">
              {err}
            </p>

            <button
              type="submit"
              disabled={!pw || busy}
              className="mt-3 w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
                flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-brand/90
                disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
            >
              {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Checking…</> : "Unlock"}
            </button>
          </form>
        ) : (
          <p className="mt-6 text-sm/[140%] text-danger">
            Admin password isn&apos;t configured. Set <span className="text-heading">ADMIN_PASSWORD</span> in the
            server environment to enable access.
          </p>
        )}
      </div>
    </div>
  );
}
