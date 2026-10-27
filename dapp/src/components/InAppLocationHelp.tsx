"use client";
import { useState } from "react";
import { Check, Copy, MapPinOff } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { copyText } from "@/lib/share";

/**
 * Shown when location fails inside a wallet's in-app browser. Valora's Android
 * browser never shares location with web apps (its WebView has geolocation
 * switched off and the app holds no location permission), so "enable it in
 * settings" is a dead end there. The way through is a normal browser, where
 * Valora still connects: Connect wallet opens Valora to approve.
 */
export function InAppLocationHelp({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? window.location.origin : "https://www.gooddrops.xyz";

  const copy = async () => {
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <Sheet title="Location is off here" onClose={onClose} width={420}>
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 shrink-0 rounded-full bg-surface text-heading flex items-center justify-center">
            <MapPinOff className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <p className="text-sm/[150%] text-nav-muted">
            Some wallet browsers, like Valora&apos;s, don&apos;t share your location with apps. GoodDrops needs it to show the drops around you and let you claim them.
          </p>
        </div>

        <ol className="flex flex-col gap-3 text-sm/[140%] text-heading">
          <li className="flex gap-3"><span className="w-6 h-6 shrink-0 rounded-full bg-brand-soft text-brand text-xs/none flex items-center justify-center">1</span>Copy the GoodDrops link.</li>
          <li className="flex gap-3"><span className="w-6 h-6 shrink-0 rounded-full bg-brand-soft text-brand text-xs/none flex items-center justify-center">2</span>Open it in Chrome or Safari.</li>
          <li className="flex gap-3"><span className="w-6 h-6 shrink-0 rounded-full bg-brand-soft text-brand text-xs/none flex items-center justify-center">3</span>Tap Sign in, then Connect wallet. Valora opens so you can approve.</li>
        </ol>

        <div className="flex items-center gap-2 rounded-2xl bg-surface p-2 pl-4">
          <span className="min-w-0 flex-1 truncate text-sm/none text-heading">{url.replace(/^https?:\/\//, "")}</span>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 h-10 px-4 rounded-full bg-brand text-white text-sm/none flex items-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {copied ? <Check className="w-4 h-4" strokeWidth={2} /> : <Copy className="w-4 h-4" strokeWidth={2} />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="h-11 rounded-full text-base/none text-heading cursor-pointer motion-safe:transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          Keep browsing the map
        </button>
      </div>
    </Sheet>
  );
}
