"use client";
import { useState, useEffect, useCallback } from "react";

type Level = "ok" | "warn" | "error" | "off";
interface Check { key: string; label: string; status: Level; detail: string }
interface Health { overall: Level; checks: Check[]; stats: Record<string, number> | null; at: number }

const DOT: Record<Level, { color: string; label: string }> = {
  ok:    { color: "#16a34a", label: "OK" },
  warn:  { color: "#d97706", label: "Warn" },
  error: { color: "#dc2626", label: "Error" },
  off:   { color: "#9ca3af", label: "Off" },
};

const STAT_LABELS: Record<string, string> = {
  subscribers: "Push subscribers",
  huntersSharingLocation: "Sharing location",
  reportedDrops: "Reported drops",
  hiddenDrops: "Hidden drops",
  landmarks: "Landmarks",
};

export default function AdminHealthPage() {
  const [data, setData]   = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]     = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const res = await fetch("/api/admin/health");
      if (res.status === 403) { setErr("Not authorised."); return; }
      setData(await res.json());
    } catch { setErr("Couldn't load health."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ minHeight: "100dvh", background: "#f5f4f0", fontFamily: "'Space Grotesk', sans-serif" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>Health</h1>
            {data && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: `${DOT[data.overall].color}18`, color: DOT[data.overall].color, fontWeight: 800, fontSize: 12.5, padding: "3px 10px", borderRadius: 999 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: DOT[data.overall].color }} />
                {data.overall === "ok" ? "All systems go" : "Needs attention"}
              </span>
            )}
          </div>
          <button onClick={load} disabled={loading}
            style={{ padding: "8px 14px", background: "#fff", color: "#111", border: "2px solid #111", borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: loading ? "wait" : "pointer", fontFamily: "inherit" }}>
            {loading ? "…" : "↻ Refresh"}
          </button>
        </div>
        <p style={{ color: "#5a5a5a", fontSize: 13.5, margin: "4px 0 18px" }}>
          Configuration & connectivity for the features that depend on external services.
        </p>

        {err && <p style={{ color: "#C81E1E", fontWeight: 700, fontSize: 13 }}>{err}</p>}

        {loading && !data ? (
          <p style={{ textAlign: "center", padding: 40, color: "#888", fontWeight: 700 }}>Checking…</p>
        ) : data ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.checks.map((c) => (
                <div key={c.key} style={{
                  display: "flex", alignItems: "flex-start", gap: 11,
                  background: "#fff", border: "2px solid #111", borderRadius: 13,
                  padding: "12px 14px", boxShadow: "2px 2px 0 #111",
                }}>
                  <span style={{ width: 11, height: 11, borderRadius: 999, background: DOT[c.status].color, marginTop: 4, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 900, fontSize: 14.5 }}>{c.label}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: DOT[c.status].color, textTransform: "uppercase", letterSpacing: "0.04em" }}>{DOT[c.status].label}</span>
                    </div>
                    <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#555" }}>{c.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {data.stats && (
              <>
                <h2 style={{ fontSize: 15, fontWeight: 900, margin: "22px 0 10px" }}>Live numbers</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                  {Object.entries(data.stats).map(([k, v]) => (
                    <div key={k} style={{ background: "#fff", border: "2px solid #111", borderRadius: 13, padding: "13px 15px", boxShadow: "2px 2px 0 #111" }}>
                      <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{v}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: "#666", marginTop: 4 }}>{STAT_LABELS[k] ?? k}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <p style={{ margin: "18px 0 0", fontSize: 11, color: "#9a9da8" }}>
              Last checked {new Date(data.at).toLocaleTimeString()}. Env changes need a redeploy to show here.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
