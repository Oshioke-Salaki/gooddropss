"use client";
import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Map, Loader2 } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { reportClientError } from "@/lib/clientErrors";

// A tab left open across a deploy asks for code files the new build no longer
// has. Re-rendering can't fix that; only a full reload picks up the new build.
const STALE_BUILD = /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed|error loading dynamically/i;
const RELOAD_KEY = "gd:error-reload-at";
// Outside the component: the boundary remounts on each new error, so a ref
// would forget that we already tried a soft retry.
let lastSoftRetry = 0;

function hardReload() {
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
  window.location.reload();
}

function reloadedRecently() {
  try { return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) < 30_000; } catch { return true; }
}

// Route-level error boundary. The nav and providers above it keep working.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const stale = STALE_BUILD.test(`${error.name} ${error.message}`);

  useEffect(() => {
    reportClientError(error, stale ? "stale-build" : "error-boundary");
    setBusy(false);
    // Recover from a stale build on its own, once, so a loop can't start.
    if (stale && !reloadedRecently()) hardReload();
  }, [error, stale]);

  const tryAgain = () => {
    setBusy(true);
    // First go: refetch server data and re-render the segment. If it breaks
    // again (or the build is stale), start clean with a full reload.
    if (stale || Date.now() - lastSoftRetry < 60_000) { hardReload(); return; }
    lastSoftRetry = Date.now();
    startTransition(() => { router.refresh(); reset(); });
  };

  return (
    <div className="min-h-dvh bg-surface font-sans flex items-center justify-center p-4">
      <div role="alert" className="w-full max-w-[420px] bg-white rounded-3xl p-6 shadow-[0px_0px_12px_0px_#0000000A] flex flex-col items-center text-center">
        <span className="w-16 h-16 rounded-full bg-brand-soft flex items-center justify-center">
          <BrandMark className="w-9 h-9" />
        </span>
        <h1 className="text-xl/none text-heading mt-5">{stale ? "GoodDrops just updated" : "Something went wrong"}</h1>
        <p className="text-sm/[150%] text-nav-muted mt-3">
          {stale
            ? "A newer version is live. Reload to pick it up. Your wallet and G$ are safe."
            : "This page hit a snag. Your wallet and G$ are safe. Try again, or head back to the map."}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 mt-6 w-full">
          <button
            type="button"
            onClick={tryAgain}
            disabled={busy}
            className="flex-1 h-12 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-brand/90 disabled:opacity-70 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
          >
            {busy
              ? <Loader2 className="w-[18px] h-[18px] motion-safe:animate-spin" strokeWidth={1.75} />
              : <RotateCcw className="w-[18px] h-[18px]" strokeWidth={1.75} />}
            {stale ? "Reload" : "Try again"}
          </button>
          {/* A full page load, not <Link>: it works even when the broken page is
              the map itself, and it drops whatever state caused the crash. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="flex-1 h-12 rounded-full border border-line bg-white text-base/none text-heading flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
          >
            <Map className="w-[18px] h-[18px]" strokeWidth={1.75} />
            Back to the map
          </a>
        </div>
        {error.digest && <p className="text-xs/none text-nav-muted mt-5">Reference {error.digest}</p>}
      </div>
    </div>
  );
}
