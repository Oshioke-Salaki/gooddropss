// Drop reporting — lets hunters flag a drop that's a scam, impossible to find,
// or offensive, and lets admins triage the queue and hide bad drops from the map.

export type ReportReason = "not_there" | "scam" | "offensive" | "spam" | "other";

export const REPORT_REASONS: { id: ReportReason; label: string; icon: string }[] = [
  { id: "not_there",  label: "Not there / can't find it", icon: "🕳️" },
  { id: "scam",       label: "Scam or misleading",        icon: "⚠️" },
  { id: "offensive",  label: "Offensive content",         icon: "🚫" },
  { id: "spam",       label: "Spam",                      icon: "🗑️" },
  { id: "other",      label: "Something else",            icon: "❓" },
];

const REASON_SET = new Set<string>(REPORT_REASONS.map((r) => r.id));
export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === "string" && REASON_SET.has(v);
}

export function reasonLabel(id: string): string {
  return REPORT_REASONS.find((r) => r.id === id)?.label ?? "Other";
}
export function reasonIcon(id: string): string {
  return REPORT_REASONS.find((r) => r.id === id)?.icon ?? "❓";
}

export const REPORT_DETAIL_MAX = 200;

export interface DropReport {
  dropId:   string;
  reporter: string;   // lowercased wallet
  reason:   ReportReason;
  detail?:  string;
  ts:       number;   // unix seconds
}

// The client signs this exact string; the server rebuilds it from validated
// fields and recovers the signer — so a signature can't be replayed for other
// data. dropId is a numeric string, reason is from the fixed set above.
export function reportMessage(dropId: string, reason: string, timestamp: number): string {
  return `GoodDrops report:${dropId}:${reason}:${timestamp}`;
}

export const DROP_ID_RE = /^[0-9]{1,20}$/;
