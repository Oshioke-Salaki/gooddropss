"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ExternalLink, EyeOff, Eye, Flag } from "lucide-react";
import { reasonLabel, type DropReport } from "@/lib/reports";
import {
  AdminPage, Button, Card, CountBadge, EmptyState, Hint, RowsSkeleton, Tag, reasonIconFor, timeAgo,
} from "@/components/admin/ui";

interface ReportedDrop {
  dropId:  string;
  count:   number;
  lastTs:  number;
  reports: DropReport[];
  hidden:  boolean;
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
        body: JSON.stringify({ action, dropId: String(dropId) }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? "Action failed"); }
      window.dispatchEvent(new CustomEvent("gd:moderation-updated"));
      await load();
    } catch (e) { setErr((e as Error).message || "Action failed"); }
    finally { setBusyId(null); }
  }

  return (
    <AdminPage
      title={<>Reports <CountBadge n={reported.length} /></>}
      subtitle="Drops flagged by hunters. Hide a bad one from the map, or dismiss the report if it's fine."
    >
      <Hint text={err} tone="bad" className="mb-3" />

      {loading ? (
        <RowsSkeleton count={3} height="h-44" />
      ) : reported.length === 0 ? (
        <Card><EmptyState icon={Flag} title="Nothing flagged" body="No reports to review right now." /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {reported.map((r) => {
            const busy = busyId === r.dropId;
            return (
              <Card key={r.dropId} className={`motion-safe:transition-opacity ${busy ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <p className="text-lg/none text-heading">Drop #{r.dropId}</p>
                    <Tag tone="bad">{r.count} {r.count === 1 ? "report" : "reports"}</Tag>
                    {r.hidden && <Tag tone="dark">Hidden</Tag>}
                  </div>
                  <Link
                    href={`/drop/${r.dropId}`}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-surface text-sm/none text-heading
                      whitespace-nowrap shrink-0 motion-safe:transition-colors hover:bg-nav-controls"
                  >
                    View <ExternalLink className="w-4 h-4" strokeWidth={2} />
                  </Link>
                </div>

                {/* Individual reports */}
                <div className="flex flex-col gap-2 mt-4">
                  {r.reports.map((rep, i) => {
                    const Icon = reasonIconFor(rep.reason);
                    return (
                      <div key={i} className="flex items-start gap-3 bg-surface rounded-2xl px-4 py-3">
                        <span className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-heading shrink-0">
                          <Icon className="w-4 h-4" strokeWidth={2} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm/none text-heading">{reasonLabel(rep.reason)}</p>
                          {rep.detail && <p className="text-sm/[140%] text-nav-muted mt-1.5">&ldquo;{rep.detail}&rdquo;</p>}
                          <p className="text-xs/none text-nav-muted/80 mt-2">{short(rep.reporter)} · {timeAgo(rep.ts)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-4">
                  {r.hidden ? (
                    <Button onClick={() => act(r.dropId, "unhide")} busy={busy} className="flex-1">
                      {!busy && <Eye className="w-4 h-4" strokeWidth={2} />} Show on map
                    </Button>
                  ) : (
                    <Button variant="dark" onClick={() => act(r.dropId, "hide")} busy={busy} className="flex-1">
                      {!busy && <EyeOff className="w-4 h-4" strokeWidth={2} />} Hide from map
                    </Button>
                  )}
                  <Button onClick={() => act(r.dropId, "dismiss")} disabled={busy}>Dismiss</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AdminPage>
  );
}
