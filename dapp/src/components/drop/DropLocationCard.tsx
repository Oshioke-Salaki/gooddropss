"use client";
import { ArrowRight, Pencil } from "lucide-react";

interface Props {
  lat: number | null;
  lng: number | null;
  placeName: string | null;
  /** Shown as chips so the drop's shape is visible at a glance. */
  isPrivate: boolean;
  hasRiddle: boolean;
  onPick: () => void;
  disabled?: boolean;
}

/**
 * Where the drop is going.
 *
 * Deliberately NOT a live map. The spot is chosen in LocationPickerSheet, which
 * is a full-screen map — repeating it here as a 200px non-interactive copy told
 * the dropper nothing they hadn't just seen, cost a second WebGL context, and on
 * a dark basemap mostly rendered as a black rectangle. The name and coordinates
 * are the part that actually confirms "yes, that's the place".
 */
export function DropLocationCard({
  lat, lng, placeName, isPrivate, hasRiddle, onPick, disabled,
}: Props) {
  const chosen = lat !== null && lng !== null;

  if (!chosen) {
    return (
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-3 rounded-3xl bg-surface p-4 text-left
          motion-safe:transition-colors
          ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-nav-controls"}`}
      >
        <span className="flex min-w-0 items-center gap-x-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gdollartoken-logo.svg" alt="" width={40} height={40} className="h-10 w-10 shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm/none text-heading">Choose a drop location</span>
            <span className="mt-2 block text-xs/none text-nav-muted">
              Anywhere in the world
            </span>
          </span>
        </span>
        <ArrowRight className="h-5 w-5 shrink-0 text-heading" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-label="Change drop location"
      className={`flex w-full items-center justify-between gap-3 rounded-3xl bg-surface p-4 text-left
        motion-safe:transition-colors
        ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-nav-controls"}`}
    >
      <span className="flex min-w-0 items-center gap-x-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/location-pin.svg" alt="" width={28} height={45}
             className="h-[45px] w-7 shrink-0 select-none" />
        <span className="min-w-0">
          <span className="block truncate text-sm/none text-heading">
            {placeName ?? "Chosen spot"}
          </span>
          <span className="mt-2 block text-xs/none text-nav-muted">
            {lat.toFixed(5)}°, {lng.toFixed(5)}°
          </span>
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-x-2">
        {isPrivate && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src="/lock-password-fill-icon.svg" alt="Private drop" title="Private drop"
               width={28} height={28} className="h-7 w-7" />
        )}
        {hasRiddle && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src="/question-dropper-icon.svg" alt="Riddle drop" title="Riddle drop"
               width={28} height={28} className="h-7 w-7" />
        )}
        <Pencil className="h-4 w-4 text-nav-muted" />
      </span>
    </button>
  );
}
