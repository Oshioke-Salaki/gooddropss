"use client";
import { useEffect, useState } from "react";
import { track } from "@/lib/analytics";
import { BadgeCheck, Camera, Check, ExternalLink, Loader2, ScanFace, ShieldCheck } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import type { VerificationStatus } from "@/hooks/useVerification";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  fvLink: string | null;
  status: VerificationStatus;
  onRefresh: () => void;
}

const STEPS = [
  { Icon: Camera,     label: "Allow your camera" },
  { Icon: ScanFace,   label: "Quick face scan" },
  { Icon: BadgeCheck, label: "Verified for good" },
];

/**
 * GoodDollar face verification, inside the app. The scan itself runs in
 * GoodDollar's iframe; this is the frame around it: what to expect, a way out
 * if the camera won't start in the iframe, and the confirmation.
 */
export function VerificationModal({ isOpen, onClose, fvLink, status, onRefresh }: Props) {
  const [iframeLoaded, setIframeLoaded] = useState(false);

  useEffect(() => { setIframeLoaded(false); }, [fvLink]);

  useEffect(() => { if (isOpen) track("verify_started"); }, [isOpen]);

  // Auto-close 2 seconds after verification confirmed
  useEffect(() => {
    if (status === "verified" && isOpen) {
      track("verify_completed");
      const t = setTimeout(() => onClose(), 2000);
      return () => clearTimeout(t);
    }
  }, [status, isOpen, onClose]);

  if (!isOpen) return null;

  const verified = status === "verified";

  return (
    <Sheet title="Verify you're human" onClose={onClose} width={520}>
      {verified ? (
        <div className="flex flex-col items-center text-center pt-8 pb-2 gap-y-4">
          <span className="w-14 h-14 rounded-full bg-brand-soft text-brand flex items-center justify-center">
            <Check className="w-7 h-7" strokeWidth={2} />
          </span>
          <p className="text-xl/none text-heading">You&apos;re verified</p>
          <p className="text-sm/[140%] text-nav-muted">
            Your GoodDollar identity is confirmed. You can now claim drops.
          </p>
        </div>
      ) : (
        <>
          {/* What's about to happen, in three beats. */}
          <ol className="mt-5 grid grid-cols-3 gap-2">
            {STEPS.map(({ Icon, label }, i) => (
              <li key={label} className="rounded-2xl bg-surface p-3 flex flex-col gap-2 min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="w-5 h-5 shrink-0 rounded-full bg-white text-heading text-[11px]/none flex items-center justify-center">
                    {i + 1}
                  </span>
                  <Icon className="w-4 h-4 text-brand" strokeWidth={2} />
                </span>
                <span className="text-xs/[130%] text-heading">{label}</span>
              </li>
            ))}
          </ol>

          {fvLink ? (
            <>
              <div className="relative mt-4 rounded-2xl overflow-hidden bg-surface h-[min(58dvh,520px)]">
                {!iframeLoaded && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" aria-live="polite">
                    <Loader2 className="w-6 h-6 animate-spin text-nav-muted" />
                    <span className="text-sm/none text-nav-muted">Starting face verification…</span>
                  </div>
                )}
                <iframe
                  src={fvLink}
                  title="GoodDollar face verification"
                  className="w-full h-full border-0 motion-safe:transition-opacity duration-500"
                  style={{ opacity: iframeLoaded ? 1 : 0 }}
                  onLoad={() => setIframeLoaded(true)}
                  allow="camera"
                />
              </div>

              {/* Way out if the embedded camera won't start (some in-app browsers). */}
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-sm/none text-nav-muted">Camera not working?</span>
                <a
                  href={fvLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 h-10 px-4 rounded-full border border-line bg-white text-sm/none text-heading
                    flex items-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-surface whitespace-nowrap"
                >
                  Open in new tab
                  <ExternalLink className="w-4 h-4" strokeWidth={2} />
                </a>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center text-center pt-8 pb-2 gap-y-4">
              <span className="w-14 h-14 rounded-full bg-brand-soft text-brand flex items-center justify-center">
                <ShieldCheck className="w-7 h-7" strokeWidth={1.75} />
              </span>
              <p className="text-xl/none text-heading">
                {status === "error" ? "Couldn't connect to GoodDollar" : "Connecting to GoodDollar"}
              </p>
              <p className="text-sm/[140%] text-nav-muted max-w-[300px]">
                {status === "error"
                  ? "The secure link for face verification didn't come through. Try again in a moment."
                  : "Setting up a secure connection for face verification. This may take a moment."}
              </p>
              {status === "error" ? (
                <div className="w-full flex flex-col gap-2.5 mt-2">
                  <button
                    type="button"
                    onClick={onRefresh}
                    className="w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
                      motion-safe:transition-colors hover:bg-brand/90"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full h-11 rounded-full border border-line bg-white text-sm/none text-heading cursor-pointer
                      motion-safe:transition-colors hover:bg-surface"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <Loader2 className="w-6 h-6 animate-spin text-nav-muted" aria-label="Connecting" />
              )}
            </div>
          )}
        </>
      )}

      <p className="mt-5 text-xs/[140%] text-nav-muted text-center">
        GoodDrops uses GoodDollar for privacy-focused identity verification.
      </p>
    </Sheet>
  );
}
