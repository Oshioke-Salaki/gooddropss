"use client";
import { Sheet } from "@/components/ui/Sheet";
import type { LabSettings, LabStats } from "./types";
import type { Quality } from "./quality";

const TIER_LABEL = { standard: "Standard", lite: "Lite" } as const;

function Segmented<T extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm/none text-nav-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className={`grid gap-1 p-1 rounded-full bg-surface ${disabled ? "opacity-50" : ""}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`h-10 rounded-full text-sm/none cursor-pointer disabled:cursor-not-allowed motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40
              ${value === o.value ? "bg-white text-heading shadow-[0px_1px_4px_0px_#0000001A]" : "text-nav-muted hover:text-heading"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange, disabled }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={`flex items-center justify-between gap-4 min-h-12 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <span className="min-w-0">
        <span className="block text-base/[130%] text-heading">{label}</span>
        {hint && <span className="block text-xs/[140%] text-nav-muted mt-0.5">{hint}</span>}
      </span>
      <span className="relative shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="block w-12 h-7 rounded-full bg-line peer-checked:bg-brand motion-safe:transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40" />
        <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow motion-safe:transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function LabPanel({ settings, onChange, quality, stats, onClose }: {
  settings: LabSettings;
  onChange: (s: LabSettings) => void;
  quality: Quality;
  stats: LabStats | null;
  onClose: () => void;
}) {
  const set = <K extends keyof LabSettings>(k: K, v: LabSettings[K]) => onChange({ ...settings, [k]: v });

  return (
    <Sheet title="Map lab" onClose={onClose} width={420}>
      <div className="flex flex-col gap-5">
        <Segmented label="Base map" value={settings.look} onChange={(v) => set("look", v)}
          options={[{ value: "original", label: "Original" }, { value: "night", label: "GoodDrops Night" }]} />

        <div className="flex flex-col divide-y divide-line">
          <Toggle label="3D buildings" hint={quality.tier === "lite" ? "Off in Lite to save battery" : undefined}
            checked={quality.tier !== "lite" && settings.buildings} disabled={quality.tier === "lite"} onChange={(v) => set("buildings", v)} />
        </div>

        <Segmented label="Building colour" value={settings.buildingColor} onChange={(v) => set("buildingColor", v)}
          disabled={quality.tier === "lite" || !settings.buildings}
          options={[{ value: "brand", label: "Brand blue" }, { value: "classic", label: "Classic grey" }]} />

        <Segmented label="Sky" value={settings.sky} onChange={(v) => set("sky", v)}
          options={[{ value: "auto", label: "Auto" }, { value: "day", label: "Day" }, { value: "dusk", label: "Dusk" }, { value: "night", label: "Night" }]} />

        <div className="rounded-2xl bg-surface p-4 flex flex-col gap-2 text-sm/[140%]">
          <div className="flex justify-between gap-3"><span className="text-nav-muted">Device tier</span><span className="text-heading">{TIER_LABEL[quality.tier]}</span></div>
          <div className="flex justify-between gap-3"><span className="text-nav-muted">Why</span><span className="text-heading text-right min-w-0 break-words">{quality.reasons.join(", ")}</span></div>
          {stats && <>
            <div className="flex justify-between gap-3"><span className="text-nav-muted">Frames last second</span><span className="text-heading tabular-nums">{stats.fps === 0 ? "Idle (nothing moving)" : stats.fps}</span></div>
            <div className="flex justify-between gap-3"><span className="text-nav-muted">Zoom</span><span className="text-heading tabular-nums">{stats.zoom.toFixed(1)}</span></div>
          </>}
        </div>
        <p className="text-xs/[150%] text-nav-muted">Add <code>?tier=standard</code> or <code>?tier=lite</code> to the address to try another tier on this phone.</p>
      </div>
    </Sheet>
  );
}
