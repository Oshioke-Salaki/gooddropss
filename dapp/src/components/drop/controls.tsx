"use client";
import { Minus, Plus } from "lucide-react";

/** Section heading + helper text used above each field. */
export function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-sm/none text-nav-muted">{children}</span>
      {hint && <span className="text-sm/none text-nav-active">{hint}</span>}
    </div>
  );
}

const FIELD =
  "w-full rounded-full border border-line px-5 py-5 text-base/none text-nav-active " +
  "placeholder:text-nav-muted outline-none focus:border-brand motion-safe:transition-colors " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

/** Pill text input. `suffix` renders inside the field on the right (e.g. "G$"). */
export function TextField({
  suffix, className = "", ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { suffix?: React.ReactNode }) {
  return (
    <div className="relative">
      <input {...props} className={`${FIELD} ${suffix ? "pr-14" : ""} ${className}`} />
      {suffix && (
        <span className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 text-base/none text-nav-muted">
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Bordered group that holds a couple of related fields. */
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-line ${className}`}>{children}</div>;
}

/**
 * Number input with −/+ buttons pinned inside the field.
 *
 * The text input stays editable — typing "12" is faster than twelve taps — but
 * it's clamped on every change so the value can never leave [min, max], however
 * it was entered.
 */
export function Stepper({
  value, onChange, min, max, disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const BTN =
    "w-11 h-11 shrink-0 rounded-full bg-surface text-nav-active flex items-center justify-center " +
    "cursor-pointer motion-safe:transition-colors hover:bg-nav-controls " +
    "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface";

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          // Empty input falls back to `min` rather than NaN, so the field can
          // never hold a value the submit path would have to defend against.
          onChange(digits === "" ? min : clamp(parseInt(digits, 10)));
        }}
        aria-label="How many drops"
        className={`${FIELD} pr-28`}
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-x-2">
        <button
          type="button" aria-label="One fewer" className={BTN}
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - 1))}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button" aria-label="One more" className={BTN}
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + 1))}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** iOS-style switch. */
export function Toggle({
  checked, onChange, label, disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // p-0 matters: a <button> carries UA padding, and without it the knob's
      // static position starts ~6px in — `translate-x-6` then pushes it past the
      // track's right edge. `left-0` pins it regardless.
      className={`relative h-7 w-12 shrink-0 rounded-full p-0 motion-safe:transition-colors
        ${checked ? "bg-brand" : "bg-nav-controls"}
        ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span
        className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow-sm
          motion-safe:transition-transform motion-safe:duration-200
          ${checked ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}

/**
 * A togglable feature block: icon, title, blurb, switch — and its own fields
 * revealed underneath once it's on.
 */
export function FeatureCard({
  iconSrc, title, blurb, checked, onChange, disabled, children,
}: {
  iconSrc: string;
  title: string;
  blurb: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-x-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={iconSrc} alt="" width={56} height={56} className="h-14 w-14 shrink-0" />
          <div className="min-w-0">
            <h3 className="mb-[14px] text-base/none text-heading">{title}</h3>
            <p className="text-sm/[140%] text-nav-muted">{blurb}</p>
          </div>
        </div>
        <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
      </div>
      {/* Reveal without measuring: a 0fr→1fr grid row animates to the content's
          natural height, which `height: auto` can't do. The child needs
          overflow-hidden or it spills while the row is collapsed. */}
      {children && (
        <div
          className={`grid motion-safe:transition-all motion-safe:duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
            ${checked ? "mt-6 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"}`}
          aria-hidden={!checked}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-4">{children}</div>
          </div>
        </div>
      )}
    </Card>
  );
}
