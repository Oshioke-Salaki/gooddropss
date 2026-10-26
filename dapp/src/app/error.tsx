"use client";
import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, Map } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { reportClientError } from "@/lib/clientErrors";

// Route-level error boundary. The nav and providers above it keep working, so
// "Try again" re-renders just the broken segment.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError(error, "error-boundary"); }, [error]);

  return (
    <div className="min-h-dvh bg-surface font-sans flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] bg-white rounded-3xl p-6 shadow-[0px_0px_12px_0px_#0000000A] flex flex-col items-center text-center">
        <span className="w-16 h-16 rounded-full bg-brand-soft flex items-center justify-center">
          <BrandMark className="w-9 h-9" />
        </span>
        <h1 className="text-xl/none text-heading mt-5">Something went wrong</h1>
        <p className="text-sm/[150%] text-nav-muted mt-3">
          This page hit a snag. Your wallet and G$ are safe. Try again, or head back to the map.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 mt-6 w-full">
          <button
            type="button"
            onClick={reset}
            className="flex-1 h-12 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-brand/90"
          >
            <RotateCcw className="w-[18px] h-[18px]" strokeWidth={1.75} />
            Try again
          </button>
          <Link
            href="/"
            className="flex-1 h-12 rounded-full border border-line bg-white text-base/none text-heading flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-surface"
          >
            <Map className="w-[18px] h-[18px]" strokeWidth={1.75} />
            Back to the map
          </Link>
        </div>
        {error.digest && <p className="text-xs/none text-nav-muted mt-5">Reference {error.digest}</p>}
      </div>
    </div>
  );
}
