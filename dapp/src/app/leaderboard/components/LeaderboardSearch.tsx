"use client";
import { Search, X } from "lucide-react";
import { useRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}

/** Name/address search. The icon becomes a clear button as soon as there's text. */
export function LeaderboardSearch({ value, onChange, placeholder }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="relative w-full lg:w-[320px]">
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); } }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-full border border-line py-[18px] pl-6 pr-14 text-sm/none text-heading
          placeholder:text-nav-muted outline-none focus:border-brand motion-safe:transition-colors"
      />
      <button
        type="button"
        onClick={() => (value ? onChange("") : ref.current?.focus())}
        aria-label={value ? "Clear search" : "Search"}
        className="absolute top-1/2 right-6 -translate-y-1/2 text-black cursor-pointer"
      >
        {value ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
      </button>
    </div>
  );
}
