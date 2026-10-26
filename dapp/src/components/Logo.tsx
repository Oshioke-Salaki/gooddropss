/**
 * The GoodDrops wordmark.
 *
 * One component because the mark previously lived inline in four places (nav,
 * drop page, admin login, the load gate) and they'd already drifted apart in
 * font, padding and radius. Colours come from the tokens, so a brand change is
 * one edit here.
 *
 * When the basket mark lands, it goes in this file and every surface picks it up.
 */
const SIZES = {
  sm: {
    text: "text-base",
    chip: "text-sm px-1.5 py-0.5",
    gap: "gap-1",
    radius: "rounded",
  },
  md: {
    text: "text-lg",
    chip: "text-sm px-1.5 py-0.5",
    gap: "gap-1.5",
    radius: "rounded-md",
  },
  lg: {
    text: "text-2xl",
    chip: "text-xl px-2 py-0.5",
    gap: "gap-1.5",
    radius: "rounded-lg",
  },
} as const;

export function Logo({
  size = "md",
  className = "",
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      className={`font-sans font-black tracking-tight text-heading flex items-center ${s.gap} ${s.text} ${className}`}
    >
      <span>Good</span>
      <span
        className={`bg-brand text-white leading-none ${s.chip} ${s.radius}`}
      >
        Drops.
      </span>
    </span>
  );
}
