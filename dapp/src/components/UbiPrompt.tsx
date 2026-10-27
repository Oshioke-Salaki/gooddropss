"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { Check, Loader2, UserRound } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useUbiClaim } from "@/hooks/useUbiClaim";
import { useAuth } from "@/hooks/useAuth";
import { formatG$ } from "@/lib/utils";

const shownKey = (address: string) => `gd:ubi-prompt:${address.toLowerCase()}`;
const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

function shownToday(address: string): boolean {
  try { return localStorage.getItem(shownKey(address)) === today(); } catch { return true; }
}
function markShown(address: string) {
  try { localStorage.setItem(shownKey(address), today()); } catch { /* private mode */ }
}

const anyDialogOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]');

/**
 * "Your daily G$ is ready." Offered once a day, on load, to a verified person
 * whose GoodDollar UBI is waiting. It never lands on top of anything: it waits
 * until onboarding and any other modal have been closed for a moment. Saying
 * "Later" is fine: the same claim lives in their profile all day.
 */
export function UbiPrompt() {
  const { address, isConnected } = useAccount();
  const { ready } = useAuth();
  const pathname = usePathname();
  const ubi = useUbiClaim();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  const eligible =
    ready && isConnected && !!address && ubi.status === "can_claim" &&
    !pathname.startsWith("/admin") && !pathname.startsWith("/auth");

  useEffect(() => {
    if (!eligible || open || !address || shownToday(address)) return;
    // Let the page settle, then wait for a quiet moment with no modal open.
    const startAt = Date.now() + 2500;
    let quiet = 0;
    const t = setInterval(() => {
      if (Date.now() < startAt) return;
      quiet = anyDialogOpen() ? 0 : quiet + 1;
      if (quiet >= 3) {
        clearInterval(t);
        markShown(address); // dismissing counts: never nag twice in a day
        setOpen(true);
      }
    }, 500);
    return () => clearInterval(t);
  }, [eligible, open, address]);

  if (!open) return null;

  const amount = ubi.claimed ?? ubi.entitlement;
  const close = () => { if (!ubi.claiming) { setOpen(false); setDone(false); } };

  return (
    <UbiPromptSheet
      amountLabel={amount ? formatG$(amount) : null}
      claiming={ubi.claiming}
      error={ubi.error}
      done={done}
      onClaim={async () => { if (await ubi.claim()) setDone(true); }}
      onClose={close}
    />
  );
}

/** The sheet itself, state in, events out (kept separate so every state can be previewed). */
export function UbiPromptSheet({ amountLabel, claiming, error, done, onClaim, onClose }: {
  amountLabel: string | null;
  claiming: boolean;
  error: string;
  done: boolean;
  onClaim: () => void;
  onClose: () => void;
}) {
  const close = onClose;
  return (
    <Sheet title={done ? "Claimed" : "Your daily G$"} onClose={close} dismissible={!claiming} width={400}>
      {done ? (
        <div className="flex flex-col items-center text-center pt-2">
          <span className="success-pop w-16 h-16 rounded-full bg-brand-soft text-brand flex items-center justify-center">
            <Check className="w-7 h-7" strokeWidth={2} />
          </span>
          <p className="mt-5 font-anta text-[40px]/none text-heading">
            +{amountLabel ?? ""}<span className="text-brand text-2xl"> G$</span>
          </p>
          <p className="mt-3 text-sm/[150%] text-nav-muted max-w-[280px]">
            It&apos;s in your wallet. Your next G$ is ready tomorrow.
          </p>
          <button
            type="button"
            onClick={close}
            className="mt-6 w-full h-12 rounded-full bg-brand text-white text-base/none cursor-pointer motion-safe:transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center pt-2">
          <span className="relative w-20 h-20 flex items-center justify-center">
            <span aria-hidden className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(39,39,226,0.18)_0%,rgba(39,39,226,0)_70%)]" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gdollartoken-logo.svg" alt="" width={56} height={56} className="relative w-14 h-14" />
          </span>
          {amountLabel && (
            <p className="mt-3 font-anta text-[40px]/none text-heading">
              {amountLabel}<span className="text-brand text-2xl"> G$</span>
            </p>
          )}
          <p className="mt-3 text-sm/[150%] text-nav-muted max-w-[300px]">
            Free G$ from the GoodDollar UBI pool. Every verified member can claim once a day.
          </p>

          {error && (
            <p role="alert" className="mt-4 text-sm/[140%] text-danger">{error}</p>
          )}

          <button
            type="button"
            onClick={onClaim}
            disabled={claiming}
            className="mt-6 w-full h-12 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-brand/90 disabled:opacity-70 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
          >
            {claiming && <Loader2 className="w-[18px] h-[18px] motion-safe:animate-spin" strokeWidth={2} />}
            {claiming ? "Claiming…" : error ? "Try again" : `Claim${amountLabel ? ` ${amountLabel}` : ""} G$`}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={claiming}
            className="mt-2 w-full h-11 rounded-full text-base/none text-heading cursor-pointer motion-safe:transition-colors hover:bg-surface disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Later
          </button>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs/[140%] text-nav-muted">
            <UserRound aria-hidden className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
            You can claim it anytime today from your profile.
          </p>
        </div>
      )}
    </Sheet>
  );
}
