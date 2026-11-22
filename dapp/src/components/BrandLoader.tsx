import { BrandMark } from "@/components/BrandMark";

/**
 * The one full-screen loading look: white, the G-drop mark breathing, the name,
 * and an optional short line saying what's happening. Used by the session
 * restore gate and the Google return page, so a sign-in shows one continuous
 * brand screen, never two different loaders back to back.
 */
export function BrandLoader({ status, style, label = "Loading GoodDrops" }: {
  status?: string;
  style?: React.CSSProperties;
  label?: string;
}) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      role="status"
      style={style}
      className="fixed inset-0 z-[3000] bg-white flex flex-col items-center justify-center gap-5 font-sans"
    >
      <BrandMark className="w-14 h-14 motion-safe:animate-pulse" />
      <span className="text-xl/none text-heading">GoodDrops</span>
      {status
        ? <span className="-mt-2 text-sm/none text-nav-muted">{status}</span>
        : <span className="sr-only">Loading</span>}
    </div>
  );
}
