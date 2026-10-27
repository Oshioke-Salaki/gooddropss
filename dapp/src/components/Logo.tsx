import { BrandMark } from "@/components/BrandMark";

/**
 * The GoodDrops lockup: the G-drop mark + the wordmark, in brand blue.
 *
 * One component because the logo appears in the nav, the drop page, the
 * sticker and poster, the admin and the sign-in callback, and they'd drift
 * apart otherwise. The mark itself lives in lib/brandMark (shared with the
 * favicon, app icons and OG images).
 */
const SIZES = {
  sm: { mark: "w-5 h-5", text: "text-base", gap: "gap-1.5" },
  md: { mark: "w-7 h-7", text: "text-xl", gap: "gap-2" },
  lg: { mark: "w-9 h-9", text: "text-2xl", gap: "gap-2.5" },
} as const;

export function Logo({
  size = "md",
  className = "",
  compact = false,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  /** Phones show the mark alone (a touch larger); the name returns from sm up. */
  compact?: boolean;
}) {
  const s = SIZES[size];
  return (
    <span
      className={`font-sans font-bold tracking-[-0.02em] text-brand flex items-center leading-none ${s.gap} ${s.text} ${className}`}
    >
      <BrandMark className={`${compact ? "w-8 h-8 sm:w-7 sm:h-7" : s.mark} shrink-0`} />
      <span className={compact ? "hidden sm:inline" : undefined}>GoodDrops</span>
    </span>
  );
}
