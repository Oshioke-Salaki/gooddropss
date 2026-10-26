"use client";
import { useEffect } from "react";
import "./globals.css";
import { reportClientError } from "@/lib/clientErrors";

// Last-resort boundary: replaces the root layout when the layout itself fails,
// so it carries its own <html>/<body> and leans only on plain markup.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError(error, "global-error"); }, [error]);

  return (
    <html lang="en">
      <body className="bg-surface">
        <div className="min-h-dvh flex items-center justify-center p-4" style={{ fontFamily: "system-ui, sans-serif" }}>
          <div className="w-full max-w-[420px] bg-white rounded-3xl p-6 shadow-[0px_0px_12px_0px_#0000000A] flex flex-col items-center text-center">
            <h1 className="text-xl/none text-heading">Something went wrong</h1>
            <p className="text-sm/[150%] text-nav-muted mt-3">
              GoodDrops couldn&apos;t load. Your wallet and G$ are safe. Please try again.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-6 w-full">
              <button
                type="button"
                onClick={reset}
                className="flex-1 h-12 rounded-full bg-brand text-white text-base/none cursor-pointer"
              >
                Try again
              </button>
              {/* A full navigation, not <Link>: the router may be what broke. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className="flex-1 h-12 rounded-full border border-line text-base/none text-heading flex items-center justify-center">
                Back to the map
              </a>
            </div>
            {error.digest && <p className="text-xs/none text-nav-muted mt-5">Reference {error.digest}</p>}
          </div>
        </div>
      </body>
    </html>
  );
}
