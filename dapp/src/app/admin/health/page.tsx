"use client";
import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Activity } from "lucide-react";
import { AdminPage, Button, Card, EmptyState, Hint, RowsSkeleton, SectionTitle, Stat, Tag } from "@/components/admin/ui";

type Level = "ok" | "warn" | "error" | "off";
interface Check { key: string; label: string; status: Level; detail: string }
interface Health { overall: Level; checks: Check[]; stats: Record<string, number> | null; at: number }

const LEVEL: Record<Level, { dot: string; label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  ok:    { dot: "bg-brand",     label: "OK",    tone: "good" },
  warn:  { dot: "bg-streak",    label: "Warn",  tone: "warn" },
  error: { dot: "bg-danger",    label: "Error", tone: "bad" },
  off:   { dot: "bg-nav-muted", label: "Off",   tone: "muted" },
};

const STAT_LABELS: Record<string, string> = {
  subscribers: "Push subscribers",
  huntersSharingLocation: "Sharing location",
  reportedDrops: "Reported drops",
  hiddenDrops: "Hidden drops",
  landmarks: "Landmarks",
  spoofFlags: "Spoof flags (log)",
  gasTopupsToday: "Gas top-ups today",
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
    <AdminPage
      title={
        <>
          Health
          {data && (
            <Tag tone={LEVEL[data.overall].tone}>
              <span className={`w-2 h-2 rounded-full ${LEVEL[data.overall].dot}`} />
              {data.overall === "ok" ? "All systems go" : "Needs attention"}
            </Tag>
          )}
        </>
      }
      subtitle="Configuration and connectivity for the features that depend on external services."
      actions={
        <Button onClick={load} busy={loading} aria-label="Refresh">
          {!loading && <RefreshCw className="w-4 h-4" strokeWidth={2} />} Refresh
        </Button>
      }
    >
      <Hint text={err} tone="bad" className="mb-3" />

      {loading && !data ? (
        <RowsSkeleton count={5} height="h-20" />
      ) : data ? (
        <>
          <div className="flex flex-col gap-3">
            {data.checks.map((c) => {
              const lv = LEVEL[c.status];
              return (
                <div key={c.key} className="bg-white rounded-3xl border border-line p-4 lg:p-5 flex items-start gap-4">
                  <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${lv.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base/none text-heading">{c.label}</p>
                      <Tag tone={lv.tone}>{lv.label}</Tag>
                    </div>
                    <p className="text-sm/[140%] text-nav-muted mt-2">{c.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {data.stats && (
            <>
              <SectionTitle className="mt-8 mb-4">Live numbers</SectionTitle>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(data.stats).map(([k, v]) => (
                  <Stat key={k} value={v.toLocaleString("en-US")} label={STAT_LABELS[k] ?? k} />
                ))}
              </div>
            </>
          )}

          <p className="mt-6 text-xs/[140%] text-nav-muted">
            Last checked {new Date(data.at).toLocaleTimeString()}. Env changes need a redeploy to show here.
          </p>
        </>
      ) : (
        <Card><EmptyState icon={Activity} title="No health data" body="Refresh to run the checks again." /></Card>
      )}
    </AdminPage>
  );
}
