"use client";
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import {
  Lock, MapPin, GraduationCap, School, ShoppingCart, Church, Signpost, Building2, Trees, TrainFront,
  MapPinOff, TriangleAlert, Ban, Trash2, CircleHelp, Loader2, type LucideIcon,
} from "lucide-react";
import { isAdminAddress } from "@/lib/admins";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";

/**
 * Admin building blocks. The console is internal, but it's the same product:
 * same tokens, radii and type scale as the leaderboard and profile. Everything
 * here is a thin wrapper over those classes so the eight pages can't drift.
 */

// ── Page chrome ───────────────────────────────────────────────────────────────

export function AdminPage({
  title, subtitle, actions, children, width = "max-w-[920px]",
}: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; width?: string }) {
  return (
    <div className={`px-4 lg:px-10 pt-6 lg:pt-10 pb-20 ${width} font-sans`}>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-[32px]/none lg:text-4xl/none text-heading flex items-center gap-3 flex-wrap">{title}</h1>
          {subtitle && <p className="text-sm/[140%] text-nav-muted mt-3 max-w-[560px]">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Wallet-gated pages: the cookie gets you into the console, an admin wallet unlocks writes. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  if (isAdminAddress(address)) return <>{children}</>;
  return (
    <div className="px-4 lg:px-10 pt-6 lg:pt-10 pb-20 font-sans">
      <Card className="max-w-[400px] mx-auto flex flex-col items-center text-center gap-y-4 p-8">
        <span className="w-14 h-14 rounded-full bg-surface flex items-center justify-center text-heading">
          <Lock className="w-6 h-6" strokeWidth={1.75} />
        </span>
        <p className="text-xl/none text-heading">Admin wallet needed</p>
        <p className="text-sm/[140%] text-nav-muted">
          {address ? "This wallet isn't on the admin list." : "Sign in with an admin wallet to manage this page."}
        </p>
      </Card>
    </div>
  );
}

// ── Surfaces ──────────────────────────────────────────────────────────────────

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-5 lg:p-6 ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-xl/none text-heading ${className}`}>{children}</h2>;
}

/** A number with a label. `tone="accent"` for the one figure that matters most. */
export function Stat({
  value, label, sub, tone = "default", loading,
}: { value: ReactNode; label: string; sub?: string; tone?: "default" | "accent"; loading?: boolean }) {
  const accent = tone === "accent";
  return (
    <div className={`rounded-2xl p-4 lg:p-5 min-w-0 ${accent ? "bg-brand text-white" : "bg-white border border-line"}`}>
      {loading ? (
        <Skeleton className={`h-7 w-20 ${accent ? "bg-white/20" : ""}`} />
      ) : (
        <p className={`text-2xl/none lg:text-[28px]/none truncate ${accent ? "text-white" : "text-heading"}`}>{value}</p>
      )}
      <p className={`text-sm/none mt-3 truncate ${accent ? "text-white/80" : "text-nav-muted"}`}>{label}</p>
      {sub && <p className={`text-xs/[140%] mt-1.5 ${accent ? "text-white/60" : "text-nav-muted/70"}`}>{sub}</p>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-y-3 py-14 px-6">
      <span className="w-14 h-14 rounded-full bg-surface flex items-center justify-center text-heading">
        <Icon className="w-6 h-6" strokeWidth={1.75} />
      </span>
      <p className="text-lg/none text-heading">{title}</p>
      {body && <p className="text-sm/[140%] text-nav-muted max-w-[320px]">{body}</p>}
    </div>
  );
}

/**
 * Rows that haven't loaded yet — same height as the real rows so nothing jumps.
 * White, because these sit directly on the grey page where a surface-coloured
 * block would be invisible.
 */
export function RowsSkeleton({ count = 3, height = "h-24" }: { count?: number; height?: string }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className={`animate-pulse rounded-3xl bg-white ${height}`} />
      ))}
    </div>
  );
}

// ── Status text ───────────────────────────────────────────────────────────────

/**
 * The one-line status slot under a form or a list. Fixed height so the layout
 * doesn't jump when a message appears; `aria-live` so screen readers hear it.
 */
export function Hint({
  text, tone = "muted", className = "",
}: { text?: string; tone?: "muted" | "ok" | "bad"; className?: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`h-4 text-sm/none truncate ${
        tone === "bad" ? "text-danger" : tone === "ok" ? "text-brand" : "text-nav-muted"
      } ${className}`}
    >
      {text ?? ""}
    </p>
  );
}

export function Tag({ children, tone = "muted", className = "" }: { children: ReactNode; tone?: "good" | "warn" | "bad" | "muted" | "dark"; className?: string }) {
  const cls = {
    good: "bg-brand-soft text-brand",
    warn: "bg-streak-bg text-streak",
    bad: "bg-[#FFEBEB] text-danger",
    muted: "bg-surface text-nav-muted",
    dark: "bg-nav-active text-white",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs/none whitespace-nowrap ${cls} ${className}`}>
      {children}
    </span>
  );
}

/** Count bubble beside a title or nav item. */
export function CountBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="inline-flex min-w-[22px] h-[22px] items-center justify-center rounded-full bg-danger px-1.5 text-xs/none text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

// ── Controls ──────────────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "quiet" | "dark" | "danger";

const VARIANT: Record<Variant, string> = {
  primary:   "bg-brand text-white hover:bg-brand/90 disabled:bg-[#A4A4A4]",
  secondary: "bg-white border border-line text-heading hover:bg-surface disabled:opacity-50",
  quiet:     "bg-surface text-heading hover:bg-nav-controls disabled:opacity-50",
  dark:      "bg-nav-active text-white hover:opacity-90 disabled:opacity-50",
  danger:    "bg-white border border-danger/30 text-danger hover:bg-[#FFEBEB] disabled:opacity-50",
};

export function Button({
  children, variant = "secondary", size = "md", busy, className = "", type = "button", ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: "sm" | "md" | "lg"; busy?: boolean;
}) {
  const h = size === "lg" ? "h-14 px-6 text-base/none w-full" : size === "sm" ? "h-9 px-4 text-sm/none" : "h-11 px-5 text-sm/none";
  return (
    <button
      type={type}
      disabled={busy || rest.disabled}
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-full whitespace-nowrap cursor-pointer
        motion-safe:transition-colors disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40
        ${h} ${VARIANT[variant]} ${className}`}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export const inputCls =
  "w-full h-12 rounded-full bg-surface px-5 text-sm/none text-heading placeholder:text-nav-muted " +
  "border border-transparent outline-none motion-safe:transition-colors focus:border-brand disabled:opacity-60";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-sm/none text-nav-muted mb-2 px-1">{label}</span>
      {children}
      {hint && <span className="block text-xs/[140%] text-nav-muted/80 mt-2 px-1">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputCls} appearance-none pr-10 bg-no-repeat bg-[right_18px_center] ${props.className ?? ""}`}
      style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B6E63' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")", ...props.style }}
    />
  );
}

/** Toggle chip for multi-select rows (badge picking, categories). */
export function ChoiceChip({
  on, children, className = "", ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      {...rest}
      className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm/none whitespace-nowrap cursor-pointer
        motion-safe:transition-colors disabled:opacity-50 disabled:cursor-not-allowed
        ${on ? "bg-nav-active text-white" : "bg-white border border-line text-heading hover:bg-surface"} ${className}`}
    >
      {children}
    </button>
  );
}

// ── Icon maps (the libs store emoji for these; the console draws lucide) ─────

const LANDMARK_ICON: Record<string, LucideIcon> = {
  landmark: MapPin, campus: GraduationCap, school: School, market: ShoppingCart, worship: Church,
  junction: Signpost, estate: Building2, park: Trees, transport: TrainFront,
};
export function landmarkIcon(category: string): LucideIcon {
  return LANDMARK_ICON[category] ?? MapPin;
}

const REASON_ICON: Record<string, LucideIcon> = {
  not_there: MapPinOff, scam: TriangleAlert, offensive: Ban, spam: Trash2, other: CircleHelp,
};
export function reasonIconFor(reason: string): LucideIcon {
  return REASON_ICON[reason] ?? CircleHelp;
}

export function timeAgo(unixSec: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000) - unixSec);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
