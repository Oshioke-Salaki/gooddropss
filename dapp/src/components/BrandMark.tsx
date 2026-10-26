import { MARK_VIEWBOX, MARK_G_TOP, MARK_G_BOTTOM, MARK_DROP, BRAND_BLUE, BRAND_SPARK } from "@/lib/brandMark";

/**
 * The GoodDrops mark, inline. Colours default to brand blue + spark orange;
 * pass `g="#fff"` on blue surfaces. The drop keeps its orange everywhere —
 * it's the one accent the brand owns.
 */
export function BrandMark({
  className,
  g = BRAND_BLUE,
  drop = BRAND_SPARK,
  title,
}: {
  className?: string;
  g?: string;
  drop?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={MARK_G_TOP} fill={g} />
      <path d={MARK_G_BOTTOM} fill={g} />
      <path d={MARK_DROP} fill={drop} />
    </svg>
  );
}
