"use client";
import { useEffect, useRef } from "react";
import { Check, Loader2, Map as MapIcon, ScanFace, Wallet } from "lucide-react";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { useVerification } from "@/hooks/useVerification";
import { VerificationModal } from "@/components/VerificationModal";
import { track } from "@/lib/analytics";

type Step = "done" | "now" | "later";

/**
 * What someone needs to hunt at this event, in order: a wallet, a one-time
 * face check (GoodDollar's proof that each person claims once), then the map.
 * The door QR opens the event page with this card at the top; it also shows
 * for anyone who isn't ready yet, and disappears once they are.
 */
export function JoinSteps({ address, onSignIn, live, fromDoor, mapHref }: {
  address: string | undefined;
  onSignIn: () => void;
  live: boolean;
  fromDoor: boolean;
  mapHref: string;
}) {
  const identity = useIdentityStatus();
  const signedIn = !!address;
  const verified = signedIn && identity.isVerified;
  const checking = signedIn && identity.isLoading;

  useEffect(() => { if (fromDoor) track("event_door_opened"); }, [fromDoor]);

  // Ready and not from the door: nothing to say.
  if (verified && !fromDoor) return null;
  if (signedIn && identity.isBlacklisted) return null;

  const s1: Step = signedIn ? "done" : "now";
  const s2: Step = verified ? "done" : signedIn && !checking ? "now" : "later";
  const s3: Step = verified ? "now" : "later";

  return (
    <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 flex flex-col gap-4" aria-labelledby="join-h">
      <div>
        <h2 id="join-h" className="text-lg/none text-heading">{verified ? "You're ready to hunt" : "New here? Three steps"}</h2>
        <p className="mt-2 text-sm/[145%] text-nav-muted">
          {verified
            ? live ? "Walk to a drop on the map and claim it." : "Come back when it starts. The drops unlock then."
            : "Takes about two minutes. It's free, and the G$ you find is yours to keep."}
        </p>
      </div>
      <ol className="flex flex-col gap-3">
        <Row n={1} state={s1} Icon={Wallet} title="Sign in" body="With your email or a wallet you already use.">
          {s1 === "now" && (
            <button type="button" onClick={onSignIn}
              className="h-10 px-4 rounded-full bg-brand text-white text-sm/none cursor-pointer hover:bg-brand/90 shrink-0">
              Sign in
            </button>
          )}
        </Row>
        <Row n={2} state={s2} Icon={ScanFace} title="Prove you're a real person" body="A quick face scan with GoodDollar, once. It keeps it fair: one person, one share.">
          {checking ? (
            <Loader2 className="w-4 h-4 animate-spin text-nav-muted shrink-0" aria-label="Checking" />
          ) : s2 === "now" ? (
            <VerifyButton lapsed={identity.isLapsed} onDone={() => identity.refresh()} />
          ) : null}
        </Row>
        <Row n={3} state={s3} Icon={MapIcon} title={live ? "Hunt" : "Hunt when it starts"} body="Drops are hidden around the venue. Get within 100 m to claim one.">
          {s3 === "now" && live && (
            <a href={mapHref} className="h-10 px-4 rounded-full bg-brand text-white text-sm/none flex items-center shrink-0 hover:bg-brand/90">
              Open map
            </a>
          )}
        </Row>
      </ol>
    </section>
  );
}

function Row({ n, state, Icon, title, body, children }: {
  n: number; state: Step; Icon: typeof Wallet; title: string; body: string; children?: React.ReactNode;
}) {
  return (
    <li className={`rounded-2xl p-4 flex items-center gap-3 ${state === "now" ? "bg-brand-soft" : "bg-surface"}`}>
      <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${state === "done" ? "bg-brand text-white" : "bg-white text-heading"}`}
        aria-label={state === "done" ? `Step ${n} done` : `Step ${n}`}>
        {state === "done" ? <Check className="w-4 h-4" strokeWidth={2.25} /> : <Icon className="w-4 h-4" strokeWidth={1.75} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm/none ${state === "later" ? "text-nav-muted" : "text-heading"}`}>{title}</p>
        <p className="mt-1.5 text-xs/[140%] text-nav-muted">{body}</p>
      </div>
      {children}
    </li>
  );
}

function VerifyButton({ lapsed, onDone }: { lapsed: boolean; onDone: () => void }) {
  const v = useVerification();
  const done = useRef(onDone);
  done.current = onDone;
  // Once, when the face check completes: re-read the on-chain status.
  useEffect(() => { if (v.status === "verified") done.current(); }, [v.status]);
  return (
    <>
      <button type="button" onClick={() => v.setIsVerifying(true)}
        className="h-10 px-4 rounded-full bg-brand text-white text-sm/none cursor-pointer hover:bg-brand/90 shrink-0">
        {lapsed ? "Re-verify" : "Verify"}
      </button>
      <VerificationModal isOpen={v.isVerifying} onClose={() => v.setIsVerifying(false)} fvLink={v.fvLink} status={v.status} onRefresh={v.refresh} />
    </>
  );
}
