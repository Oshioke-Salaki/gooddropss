"use client";
import { useState } from "react";
import { Lock, ArrowRight, Loader2, Eye, EyeOff } from "lucide-react";

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
    <div style={{
      minHeight: "100dvh", background: "#f5f4f0",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <div style={{
        width: "100%", maxWidth: 380,
        background: "#fff", border: "2.5px solid #111", borderRadius: 24,
        boxShadow: "6px 6px 0 #111", padding: "28px 26px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span>good</span>
          <span style={{ background: "#111", color: "#BFFD00", padding: "2px 8px", fontSize: 13, fontWeight: 900, borderRadius: 4 }}>drops.</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0 4px" }}>
          <Lock size={18} />
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>Admin access</h1>
        </div>

        {configured ? (
          <>
            <p style={{ fontSize: 13.5, color: "#5a5a5a", margin: "0 0 18px", lineHeight: 1.5 }}>
              Enter the admin password to continue.
            </p>
            <div style={{ position: "relative" }}>
              <input
                type={show ? "text" : "password"}
                value={pw}
                autoFocus
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Password"
                style={{
                  width: "100%", padding: "14px 44px 14px 16px", fontSize: 16, fontWeight: 600,
                  border: "2px solid #111", borderRadius: 14, outline: "none",
                  fontFamily: "inherit", background: "#f5f4f0",
                }}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
                title={show ? "Hide password" : "Show password"}
                style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  width: 32, height: 32, border: "none", background: "transparent",
                  color: "#888", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {err && <p style={{ color: "#C81E1E", fontWeight: 700, fontSize: 13, margin: "10px 0 0" }}>{err}</p>}
            <button
              onClick={submit}
              disabled={!pw || busy}
              style={{
                width: "100%", padding: "15px", marginTop: 14,
                background: pw && !busy ? "#BFFD00" : "#e8e6e0",
                color: pw && !busy ? "#111" : "#aaa",
                border: "2.5px solid", borderColor: pw && !busy ? "#111" : "#ddd",
                borderRadius: 16, boxShadow: pw && !busy ? "4px 4px 0 #111" : "none",
                fontWeight: 900, fontSize: 16, cursor: pw && !busy ? "pointer" : "not-allowed",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <>Unlock <ArrowRight size={18} /></>}
            </button>
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: "#C81E1E", fontWeight: 600, margin: "8px 0 0", lineHeight: 1.5 }}>
            Admin password isn&apos;t configured. Set <b>ADMIN_PASSWORD</b> in the server
            environment to enable access.
          </p>
        )}
      </div>
    </div>
  );
}
