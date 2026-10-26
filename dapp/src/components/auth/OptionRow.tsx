"use client";
import { ArrowRight, Loader2 } from "lucide-react";

interface Props {
  label: string;
  /** Path to a 1:1 logo, rendered as its own 40px circle. */
  iconSrc?: string;
  /** Fallback when a connector ships no artwork. */
  iconFallback?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Swaps the trailing arrow for a spinner. */
  busy?: boolean;
}

/**
 * One tappable sign-in option: circular logo, label, trailing arrow.
 *
 * On hover the logo lifts a touch and the arrow slides toward the edge — a
 * small nudge that makes the row feel like a door rather than a label. Both are
 * `motion-safe`, so anyone with reduced motion enabled gets the colour change
 * only.
 */
export function OptionRow({ label, iconSrc, iconFallback, onClick, disabled, busy }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`group w-full border border-line rounded-full flex justify-between items-center gap-3 py-1.5 pl-1.5 pr-6
        motion-safe:transition-[background-color,border-color] hover:bg-surface hover:border-nav-controls
        ${disabled || busy ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span className="flex gap-x-4 items-center min-w-0">
        <span className="w-10 h-10 shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-surface motion-safe:transition-transform motion-safe:duration-200 group-hover:motion-safe:scale-105">
          {iconSrc
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={iconSrc} alt="" width={40} height={40} className="w-10 h-10 object-cover" />
            : iconFallback}
        </span>
        <span className="text-base/none text-heading truncate">{label}</span>
      </span>

      {busy
        ? <Loader2 className="w-5 h-5 shrink-0 text-nav-muted animate-spin" />
        : <ArrowRight className="w-5 h-5 shrink-0 text-nav-muted motion-safe:transition-transform motion-safe:duration-200 group-hover:motion-safe:translate-x-1" />}
    </button>
  );
}
