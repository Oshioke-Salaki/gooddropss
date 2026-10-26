"use client";
import { useEffect, useState } from "react";
import { Link, MapPin, Plus } from "lucide-react";

interface Props {
  onDropG: () => void;
  onDropChain: () => void;
  /** Omitted entirely when the hunter may not name places. */
  onNamePlace?: () => void;
  /** "Name place" for admins, "Suggest place" for verified hunters. */
  namePlaceLabel?: string;
}

// One edit point for the pill shape. Width is fixed so the stack reads as one
// block; the longest label ("Suggest place") still clears the 6px right well.
const PILL =
  "w-[151px] flex items-center gap-x-3 p-1.5 rounded-full bg-white cursor-pointer " +
  "transition-shadow hover:shadow-[0px_2px_12px_0px_#00000014] active:scale-[0.985]";
const LABEL = "text-sm/[100%] text-heading whitespace-nowrap truncate";
const ICON = "w-8 h-8 rounded-full flex items-center justify-center shrink-0";

// The expand/collapse curve: fast out, gentle settle. No overshoot — these are
// wide pills, and a bounce on a 151px block reads as wobble rather than spring.
const EASE = "ease-[cubic-bezier(0.22,1,0.36,1)]";
const ANIM = `motion-safe:transition-all motion-safe:duration-300 ${EASE}`;

/**
 * The map's bottom-right actions: drop money, drop a chain, name a place.
 *
 * At lg and up all three pills are always on screen. Below that they'd crowd the
 * map, so they collapse behind a 44px trigger that matches the height of the
 * My location pill opposite it.
 *
 * The collapsed stack is absolutely positioned above the trigger, so it occupies
 * no layout space and can animate both in AND out — `hidden` would snap. Visible
 * state is forced on at lg with plain `lg:` overrides, so crossing the breakpoint
 * mid-session can never strand the stack half-hidden.
 */
export function MapActionButtons({ onDropG, onDropChain, onNamePlace, namePlaceLabel = "Name place" }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Escape collapses, matching every other dismissible surface.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Picking an action always collapses the stack — the sheet it opens takes over.
  const run = (fn: () => void) => () => { setExpanded(false); fn(); };

  const actions = [
    {
      key: "drop",
      label: "Drop $G",
      onClick: run(onDropG),
      // The token artwork is its own circle, so it fills the well directly.
      // eslint-disable-next-line @next/next/no-img-element
      icon: <img src="/gdollartoken-logo.svg" alt="" width={32} height={32} className={`${ICON} object-cover`} />,
    },
    {
      key: "chain",
      label: "Drop chain",
      onClick: run(onDropChain),
      icon: (
        <span className={`${ICON} bg-surface`}>
          <Link className="w-[18px] h-[18px] text-heading" strokeWidth={2} />
        </span>
      ),
    },
    ...(onNamePlace
      ? [{
          key: "place",
          label: namePlaceLabel,
          onClick: run(onNamePlace),
          icon: (
            <span className={`${ICON} bg-brand-soft`}>
              <MapPin className="w-4 h-4 text-brand" strokeWidth={2} />
            </span>
          ),
        }]
      : []),
  ];

  return (
    <div className="relative flex flex-col items-end gap-3 font-sans">
      <div
        className={`absolute bottom-full right-0 mb-3 flex flex-col items-end gap-3
          lg:static lg:mb-0 ${ANIM}
          ${expanded ? "opacity-100" : "opacity-0 pointer-events-none"}
          lg:opacity-100 lg:pointer-events-auto`}
      >
        {actions.map((a, i) => (
          <button
            key={a.key}
            type="button"
            onClick={a.onClick}
            tabIndex={expanded ? 0 : -1}
            className={`${PILL} ${ANIM}
              ${expanded ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-3 scale-95"}
              lg:opacity-100 lg:translate-y-0 lg:scale-100`}
            style={{
              // Stagger outward from the trigger: the nearest pill leaves first on
              // the way up, and is the last to fold away on the way back down.
              transitionDelay: `${(expanded ? actions.length - 1 - i : i) * 45}ms`,
            }}
          >
            {a.icon}
            <span className={LABEL}>{a.label}</span>
          </button>
        ))}
      </div>

      {/* Mobile trigger — 44px, so it lines up with the My location pill.
          One Plus turned 45° becomes the X, so the icon morphs instead of swapping. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? "Close actions" : "Open actions"}
        className="lg:hidden w-11 h-11 shrink-0 rounded-full bg-white text-heading flex items-center justify-center cursor-pointer
          shadow-[0px_0px_12px_0px_#0000000A] transition-shadow hover:shadow-[0px_2px_12px_0px_#00000014] active:scale-[0.985]"
      >
        <Plus
          className={`w-6 h-6 motion-safe:transition-transform motion-safe:duration-300 ${EASE} ${expanded ? "rotate-45" : "rotate-0"}`}
        />
      </button>
    </div>
  );
}

export default MapActionButtons;
