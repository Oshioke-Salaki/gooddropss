"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
import { Check, HeartHandshake, Loader2 } from "lucide-react";
import type { Address } from "viem";
import { Sheet } from "@/components/ui/Sheet";
import { useAuth } from "@/hooks/useAuth";
import { useVerification } from "@/hooks/useVerification";
import { useProfile } from "@/hooks/useProfile";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import { publicClient } from "@/lib/publicClient";
import { friendlyClaimError } from "@/lib/claimErrors";
import { track } from "@/lib/analytics";
import {
  FLOW_COUNCIL, FLOW_COUNCIL_ABI, FLOW_COUNCIL_URL,
  buildClaimMessage, toBallot, canGiveMore, ballotFor, type Ballot,
} from "@/lib/flowstate";

// Asks every verified person to give GoodDrops all of their free Flow State
// votes, with one button. Checked on every visit, so anyone with votes not yet
// given out is asked (for email sign-ups that's all of them). Votes someone
// already gave other projects are never touched. It can't be dismissed while a vote is possible. The moment it turns out a
// vote isn't (identity votes from another wallet, Flow State refusing or down),
// it explains and lets them go, so nobody is ever locked out of the app.

const blockedKey = (a: string) => `gd:flow-blocked:${a.toLowerCase()}`;
const BLOCKED_FOR_MS = 7 * 86_400_000;

function read(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function write(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function recentlyBlocked(a: string) { const t = Number(read(blockedKey(a))); return Number.isFinite(t) && Date.now() - t < BLOCKED_FOR_MS; }

/** Closed after a problem: leave them be until the next visit. */
let dismissedThisVisit = false;

const anyDialogOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]');
const HIDDEN_ON = ["/admin", "/auth", "/switch-to-email", "/renew", "/qa"];

async function readBallot(address: Address): Promise<Ballot> {
  const [voter, votes] = await Promise.all([
    publicClient.readContract({ address: FLOW_COUNCIL, abi: FLOW_COUNCIL_ABI, functionName: "getVoter", args: [address] }),
    publicClient.readContract({ address: FLOW_COUNCIL, abi: FLOW_COUNCIL_ABI, functionName: "getVotes", args: [address] }),
  ]);
  return toBallot(voter, votes);
}

/** Checked once per wallet per visit. */
const checkedThisVisit = new Set<string>();

export type Phase = "ask" | "enabling" | "voting" | "toppingUp" | "done" | "stopped";

export function FlowVotePrompt() {
  const { address, isConnected } = useAccount();
  const { ready } = useAuth();
  const { status } = useVerification();
  const profile = useProfile(address);
  const pathname = usePathname();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useSponsoredWrite();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("ask");
  const [error, setError] = useState("");
  const [stopReason, setStopReason] = useState("");
  const busy = useRef(false);

  const hiddenHere = HIDDEN_ON.some((p) => pathname.startsWith(p)) || /^\/events\/[^/]+\/screen/.test(pathname);
  const eligible =
    ready && isConnected && !!address && status === "verified" && !!profile?.username && !hiddenHere;

  // Decide once per wallet whether to ask, then wait for a quiet moment so it
  // never lands on top of sign-up, verification or another prompt.
  useEffect(() => {
    if (!eligible || open || !address || dismissedThisVisit) return;
    if (recentlyBlocked(address) || checkedThisVisit.has(address.toLowerCase())) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    readBallot(address as Address).then((b) => {
      if (cancelled) return;
      checkedThisVisit.add(address.toLowerCase());
      if (!canGiveMore(b)) return; // every vote they have is already given out
      let quiet = 0;
      const startAt = Date.now() + 1500;
      timer = setInterval(() => {
        if (Date.now() < startAt) return;
        quiet = anyDialogOpen() ? 0 : quiet + 1;
        if (quiet >= 2) {
          if (timer) clearInterval(timer);
          setPhase("ask"); setError("");
          setOpen(true);
          track("flow_vote_prompt_shown");
        }
      }, 500);
    }).catch(() => { /* chain unreachable: try again on the next page */ });
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [eligible, open, address]);

  // Signing out resets the visit, so every sign-in checks again for new votes.
  useEffect(() => {
    if (!isConnected) { checkedThisVisit.clear(); dismissedThisVisit = false; }
  }, [isConnected]);

  // Switching wallets or signing out closes it; the next wallet gets its own check.
  const shownFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (open && shownFor.current && shownFor.current !== address?.toLowerCase()) setOpen(false);
    if (open) shownFor.current = address?.toLowerCase();
  }, [open, address]);

  const stop = useCallback((reason: string, remember: boolean) => {
    if (remember && address) write(blockedKey(address), String(Date.now()));
    setStopReason(reason);
    setPhase("stopped");
  }, [address]);

  /** Wait for Flow State's bot to add the wallet on chain. */
  const waitForVoter = async (a: Address): Promise<Ballot | null> => {
    const until = Date.now() + 90_000;
    while (Date.now() < until) {
      const b = await readBallot(a).catch(() => null);
      if (b?.isVoter && b.votingPower > 0) return b;
      await new Promise((r) => setTimeout(r, 2500));
    }
    return null;
  };

  const vote = useCallback(async () => {
    if (!address || busy.current) return;
    busy.current = true;
    setError("");
    const a = address as Address;
    try {
      let b = await readBallot(a);

      // 1. Get voting rights (once per round), by signing Flow State's own message.
      if (!b.isVoter) {
        setPhase("enabling");
        const issuedAt = Date.now();
        let signature: string;
        try {
          signature = await signMessageAsync({ message: buildClaimMessage(a, issuedAt) });
        } catch (e) {
          if (friendlyClaimError(e).kind === "rejected") { setPhase("ask"); return; }
          throw e;
        }
        const res = await fetch("/api/flowstate/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: a, issuedAt, signature }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (body.alreadyClaimed) {
            track("flow_vote_blocked", { reason: "identity_elsewhere" });
            return stop("Your GoodDollar identity already votes on Flow State from another wallet. You can vote for GoodDrops from that wallet on Flow State.", true);
          }
          if (body.final) {
            track("flow_vote_blocked", { reason: "refused" });
            return stop("Flow State couldn't add this wallet as a voter right now. You can still vote for GoodDrops on Flow State's site.", true);
          }
          setError(body.error || "Something went wrong. Please try again.");
          setPhase("ask");
          return;
        }
        const added = await waitForVoter(a);
        if (!added) {
          setError("Flow State is taking longer than usual. Tap the button again in a moment.");
          setPhase("ask");
          return;
        }
        b = added;
      }

      // 2. Vote: every free vote goes to GoodDrops. Only GoodDrops' entry is
      //    sent, so votes given to other projects stay exactly where they are.
      if (b.available <= 0) {
        if (b.forUs > 0) { setPhase("done"); return; }
        track("flow_vote_blocked", { reason: "no_points" });
        return stop("All your votes are already given out on Flow State, so there are none left to give.", true);
      }
      setPhase("voting");
      const params = {
        address: FLOW_COUNCIL as Address,
        abi: FLOW_COUNCIL_ABI,
        functionName: "vote" as const,
        args: [ballotFor(b)] as const,
      };
      // Check it would go through before asking the wallet, so a problem shows
      // its real reason instead of a failed send.
      await publicClient.simulateContract({ ...params, account: a });
      const hash = await writeContractAsync(params as never, { onToppingUp: () => setPhase("toppingUp") });
      setPhase("voting");
      const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (rc.status !== "success") throw new Error("vote reverted");
      const after = await readBallot(a).catch(() => null);
      if (after && after.forUs < b.forUs + b.available) throw new Error("vote not recorded");
      track("flow_vote_cast", { points: b.available });
      setPhase("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const fe = friendlyClaimError(e);
      if (fe.kind === "rejected") { setPhase("ask"); return; }
      if (/UNAUTHORIZED/.test(msg)) {
        setError("Flow State hasn't finished adding you as a voter. Tap the button again in a moment.");
      } else {
        setError(fe.kind === "gas" ? fe.message : "Your vote didn't go through. Please try again.");
      }
      setPhase("ask");
    } finally {
      busy.current = false;
    }
  }, [address, signMessageAsync, writeContractAsync, stop]);

  if (!open) return null;

  const working = phase === "enabling" || phase === "voting" || phase === "toppingUp";
  const closable = phase === "done" || phase === "stopped" || !!error;
  const close = () => {
    if (!closable || working) return;
    if (phase !== "done") dismissedThisVisit = true;
    setOpen(false);
  };

  return (
    <FlowVoteSheet phase={phase} error={error} stopReason={stopReason}
      working={working} closable={closable} onVote={vote} onClose={close} />
  );
}


/** The sheet itself, state in, events out (kept separate so every state can be previewed). */
export function FlowVoteSheet({ phase, error, stopReason, working, closable, onVote, onClose }: {
  phase: Phase; error: string; stopReason: string; working: boolean; closable: boolean;
  onVote: () => void; onClose: () => void;
}) {
  const close = onClose;
  return (
    <Sheet
      title={phase === "done" ? "Thank you" : "Vote for GoodDrops"}
      onClose={close}
      dismissible={closable && !working}
      headerAction={closable && !working ? undefined : <span />}
      zIndex={1450}
      width={420}
    >
      <div className="flex flex-col items-center text-center gap-5 pt-2">
        <span className={`w-16 h-16 rounded-full flex items-center justify-center ${phase === "done" ? "bg-brand text-white" : "bg-brand-soft text-brand"}`}>
          {phase === "done" ? <Check className="w-8 h-8" strokeWidth={2.25} /> : <HeartHandshake className="w-8 h-8" strokeWidth={1.75} />}
        </span>

        {phase === "done" ? (
          <>
            <p className="text-base/[150%] text-heading">Your votes are in. Thank you for backing GoodDrops.</p>
            <button type="button" onClick={close} className="w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer hover:bg-brand/90">
              Back to the hunt
            </button>
          </>
        ) : phase === "stopped" ? (
          <>
            <p className="text-base/[150%] text-heading">{stopReason}</p>
            <a href={FLOW_COUNCIL_URL} target="_blank" rel="noopener noreferrer"
              className="w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center hover:bg-brand/90">
              Open Flow State
            </a>
            <button type="button" onClick={close} className="h-11 px-5 rounded-full text-sm/none text-nav-muted cursor-pointer hover:text-heading">
              Close
            </button>
          </>
        ) : (
          <>
            <p className="text-base/[150%] text-heading">
              Help GoodDrops grow. Give us your vote on Flow State with one tap.
            </p>

            <button
              type="button"
              onClick={onVote}
              disabled={working}
              className="w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed"
            >
              {working && <Loader2 className="w-5 h-5 animate-spin" />}
              {phase === "enabling" ? "Getting your votes ready…" : phase === "toppingUp" ? "Getting things ready…" : phase === "voting" ? "Sending your vote…" : "Vote for GoodDrops"}
            </button>
            {error ? (
              <p role="status" className="text-sm/[145%] text-danger -mt-1">{error}</p>
            ) : (
              <p className="text-xs/[145%] text-nav-muted -mt-1">Free, one tap. Nothing leaves your wallet.</p>
            )}
            {error && !working && (
              <button type="button" onClick={close} className="h-10 px-5 -mt-2 rounded-full text-sm/none text-nav-muted cursor-pointer hover:text-heading">
                Not now
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
