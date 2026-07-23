"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { reasonLabel, reasonIcon, type DropReport } from "@/lib/reports";

interface ReportedDrop {
  dropId:  string;
  count:   number;
  lastTs:  number;
  reports: DropReport[];
  hidden:  boolean;
}

function timeAgo(unixSec: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000) - unixSec);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function AdminReportsPage() {
  const [reported, setReported] = useState<ReportedDrop[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busyId, setBusyId]     = useState<string | null>(null);
  const [err, setErr]           = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/moderation");
      if (res.status === 403) { setErr("Not authorised."); setReported([]); return; }
      const d = await res.json();
      if (Array.isArray(d.reported)) setReported(d.reported);
    } catch { /* keep what we had */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(dropId: string, action: "hide" | "unhide" | "dismiss") {
    setBusyId(dropId); setErr("");
    try {
      const res = await fetch("/api/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, dropId }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? "Action failed"); }
      window.dispatchEvent(new CustomEvent("gd:moderation-updated"));
      await load();
    } catch (e) { setErr((e as Error).message || "Action failed"); }
    finally { setBusyId(null); }
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#f5f4f0", fontFamily: "'Space Grotesk', sans-serif" }}>
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "28px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>Reports</h1>
          {reported.length > 0 && (
            <span style={{ background: "#FF5C5C", color: "#fff", fontWeight: 900, fontSize: 13, padding: "3px 10px", borderRadius: 999 }}>
              {reported.length}
            </span>
          )}
        </div>
        <p style={{ color: "#5a5a5a", fontSize: 13.5, margin: "4px 0 18px" }}>
          Drops flagged by hunters. Hide a bad one from the map, or dismiss the report if it&rsquo;s fine.
        </p>

        {err && <p style={{ margin: "0 0 12px", color: "#C81E1E", fontWeight: 700, fontSize: 13 }}>{err}</p>}

        {loading ? (
          <p style={{ textAlign: "center", padding: 40, color: "#888", fontWeight: 700 }}>Loading…</p>
        ) : reported.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 20px", color: "#888" }}>
            <div style={{ fontSize: 44 }}>✅</div>
            <p style={{ fontWeight: 900, margin: "10px 0 0", color: "#111", fontSize: 17 }}>Nothing flagged</p>
            <p style={{ fontSize: 13, margin: "4px 0 0" }}>No reports to review right now.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {reported.map((r) => {
              const busy = busyId === r.dropId;
              return (
                <div key={r.dropId} style={{
                  background: "#fff", border: "2px solid #111", borderRadius: 16,
                  padding: "14px 15px", boxShadow: "3px 3px 0 #111",
                  opacity: busy ? 0.6 : 1, transition: "opacity 0.15s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                      <span style={{ fontWeight: 900, fontSize: 16 }}>Drop #{r.dropId}</span>
                      <span style={{ background: "#FFE5E5", color: "#C81E1E", fontWeight: 800, fontSize: 11.5, padding: "2px 8px", borderRadius: 999 }}>
                        {r.count} {r.count === 1 ? "report" : "reports"}
                      </span>
                      {r.hidden && (
                        <span style={{ background: "#111", color: "#fff", fontWeight: 800, fontSize: 11, padding: "2px 8px", borderRadius: 999 }}>hidden</span>
                      )}
                    </div>
                    <Link href={`/drop/${r.dropId}`} target="_blank" style={{ fontSize: 12, fontWeight: 800, color: "#2563eb", textDecoration: "underline", whiteSpace: "nowrap" }}>
                      View ↗
                    </Link>
                  </div>

                  {/* Individual reports */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 11 }}>
                    {r.reports.map((rep, i) => (
                      <div key={i} style={{ background: "#f5f4f0", borderRadius: 10, padding: "8px 11px" }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#111" }}>
                          {reasonIcon(rep.reason)} {reasonLabel(rep.reason)}
                        </p>
                        {rep.detail && <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#444" }}>&ldquo;{rep.detail}&rdquo;</p>}
                        <p style={{ margin: "3px 0 0", fontSize: 11, color: "#999", fontWeight: 600 }}>
                          {short(rep.reporter)} · {timeAgo(rep.ts)}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    {r.hidden ? (
                      <button onClick={() => act(r.dropId, "unhide")} disabled={busy}
                        style={{ flex: 1, height: 44, background: "#fff", color: "#111", border: "2px solid #111", borderRadius: 12, fontWeight: 900, fontSize: 13.5, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
                        {busy ? "…" : "Un-hide"}
                      </button>
                    ) : (
                      <button onClick={() => act(r.dropId, "hide")} disabled={busy}
                        style={{ flex: 1, height: 44, background: "#C81E1E", color: "#fff", border: "2.5px solid #111", borderRadius: 12, fontWeight: 900, fontSize: 13.5, cursor: busy ? "wait" : "pointer", fontFamily: "inherit", boxShadow: "2px 2px 0 #111" }}>
                        {busy ? "…" : "🚫 Hide from map"}
                      </button>
                    )}
                    <button onClick={() => act(r.dropId, "dismiss")} disabled={busy}
                      style={{ padding: "0 16px", height: 44, background: "#fff", color: "#111", border: "2px solid #111", borderRadius: 12, fontWeight: 800, fontSize: 13.5, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
