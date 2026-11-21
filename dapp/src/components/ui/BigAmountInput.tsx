"use client";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * The big centred amount field used by Send and Withdraw. It sizes itself to
 * the exact width of what's typed (measured from a hidden copy in the same
 * font), so the unit sits right beside the number at every amount.
 */
export function BigAmountInput({ id, value, display, onChange, disabled, unit = "G$" }: {
  id: string;
  /** Raw value, e.g. "50000". */
  value: string;
  /** What to show, e.g. "50,000". */
  display: string;
  onChange: (raw: string) => void;
  disabled?: boolean;
  unit?: string;
}) {
  const mirror = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (mirror.current) setW(Math.ceil(mirror.current.getBoundingClientRect().width) + 4);
  }, [display, value]);
  const cls = "text-[34px]/none tracking-[-0.02em] font-sans";
  return (
    <div className="relative flex items-baseline justify-center gap-2 w-full min-w-0">
      <span ref={mirror} aria-hidden className={`${cls} absolute invisible whitespace-pre pointer-events-none`}>{display || "0"}</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={display}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${cls} min-w-0 max-w-[80%] text-center text-heading outline-none placeholder:text-[#C9C9C9] bg-transparent disabled:opacity-60`}
        style={{ width: w }}
      />
      <span className="text-lg/none text-nav-muted shrink-0">{unit}</span>
    </div>
  );
}
