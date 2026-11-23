"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { m } from "framer-motion";
import { AlertCircle, Check, ChevronRight, Gift, Loader2, ShieldCheck } from "lucide-react";
import dynamic from "next/dynamic";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { useDropClaim } from "@/hooks/useDropClaim";
import { rememberTask } from "@/hooks/useTaskInfo";
import { formatG$ } from "@/lib/utils";
import type { LatLng } from "@/types";
import type { RewardUnavailable } from "@/components/TaskUnlock";

// The QR library only loads when a code is actually shown.
const TaskUnlock = dynamic(() => import("@/components/TaskUnlock").then((x) => x.TaskUnlock), { ssr: false });

// A shop's reward, right where the customer already is: on the shop sheet and
// on the payment receipt. Paying is usually the task, so the receipt opens with
// the code on screen; the shop approves it and the G$ is sent automatically.
// No trip back to the map, no second "Claim" tap.
//
// Verification stays the bar: an unverified customer sees how to verify, never a code.

interface Reward { dropId: string; task: string; amountWei: string; expiry: number }

type Load = { state: "loading" } | { state: "ready"; rewards: Reward[] } | { state: "failed" };

export function ShopReward({
  spotId, userLocation, open: openByDefault, surface,
}: {
  spotId: string;
  userLocation: LatLng | null;
  /** Show the code straight away (receipt) instead of behind "Show my code" (shop sheet). */
  open: boolean;
  surface: "sheet" | "receipt";
}) {
  const { address, isConnected } = useSignedInAccount();
  const identity = useIdentityStatus();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [open, setOpen] = useState(openByDefault);
  const [task, setTask] = useState<string | null>(null);
  // Rewards for this task that turned out to be taken while we were here.
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [approvedId, setApprovedId] = useState<string | null>(null);
  const { claim: runClaim, status: claimStatus, errMsg: claimErr } = useDropClaim("shop");

  const fetchRewards = useCallback(async (signal?: AbortSignal) => {
    const qs = new URLSearchParams({ spotId, ...(address ? { address } : {}) });
    const res = await fetch(`/api/task/available?${qs}`, { cache: "no-store", signal });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    return (Array.isArray(d.rewards) ? d.rewards : []) as Reward[];
  }, [spotId, address]);

  // Load once per shop/person, with one quiet retry: this panel is a bonus on
  // top of the sheet, so a hiccup should never put an error in front of a payment.
  useEffect(() => {
    const ac = new AbortController();
    setLoad({ state: "loading" });
    (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const rewards = await fetchRewards(ac.signal);
          rewards.forEach((r) => rememberTask(r.dropId, r.task));
          setLoad({ state: "ready", rewards });
          return;
        } catch {
          if (ac.signal.aborted) return;
          if (attempt === 0) await new Promise((r) => setTimeout(r, 2500));
        }
      }
      if (!ac.signal.aborted) setLoad({ state: "failed" });
    })();
    return () => ac.abort();
  }, [fetchRewards]);

  const rewards = useMemo(() => (load.state === "ready" ? load.rewards : []), [load]);
  // One entry per distinct task (a shop may run "Buy any coffee" ×5 and "Buy lunch" ×2).
  const tasks = useMemo(() => {
    const seen = new Map<string, Reward>();
    for (const r of rewards) if (!seen.has(r.task)) seen.set(r.task, r);
    return [...seen.values()];
  }, [rewards]);
  const chosenTask = task ?? tasks[0]?.task ?? null;
  // The reward to unlock: soonest-expiring for this task that isn't taken.
  const current = useMemo(
    () => rewards.find((r) => r.task === chosenTask && !skipped.has(r.dropId)) ?? null,
    [rewards, chosenTask, skipped],
  );
  const approved = approvedId ? rewards.find((r) => r.dropId === approvedId) ?? null : null;

  const onUnavailable = useCallback((_reason: RewardUnavailable) => {
    if (!current) return;
    setSkipped((s) => new Set(s).add(current.dropId));
  }, [current]);

  const sendReward = useCallback((r: Reward) => {
    if (!address) return;
    void runClaim({ dropId: BigInt(r.dropId), amount: BigInt(r.amountWei), address, userLocation });
  }, [address, runClaim, userLocation]);

  const onApproved = useCallback(() => {
    if (!current) return;
    setApprovedId(current.dropId);
    sendReward(current);
  }, [current, sendReward]);

  // Nothing to offer: stay out of the way entirely.
  if (load.state !== "ready" || tasks.length === 0) return null;

  const amountOf = (r: Reward) => `${formatG$(BigInt(r.amountWei))} G$`;
  const lead = current ?? tasks.find((t) => t.task === chosenTask) ?? tasks[0];

  // ── After approval: the reward is being sent / has arrived / needs a retry ──
  if (approved) {
    const s = claimStatus;
    return (
      <Card>
        {s === "done" ? (
          <div className="flex flex-col items-center text-center gap-y-3 py-2" role="status" aria-live="polite">
            <span className="success-pop w-14 h-14 rounded-full bg-brand-soft text-brand flex items-center justify-center">
              <Check className="w-7 h-7" strokeWidth={2} />
            </span>
            <p className="text-lg/none text-heading">{amountOf(approved)} is in your wallet</p>
            <p className="text-sm/[140%] text-nav-muted">Reward from the shop for: {approved.task}</p>
          </div>
        ) : s === "error" || s === "gone" ? (
          <div className="flex flex-col gap-y-3">
            <div className="flex items-start gap-3 rounded-2xl bg-[#FFF1F1] px-4 py-3 text-sm/[140%] text-danger" role="alert">
              <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-px" strokeWidth={1.75} />
              <span>{claimErr || "Your reward didn't go through."}</span>
            </div>
            {s === "error" && (
              <button type="button" onClick={() => sendReward(approved)} className={PRIMARY}>
                Try again
              </button>
            )}
          </div>
        ) : s === "idle" ? (
          // The wallet prompt was closed: nothing was sent, one tap to send it.
          <div className="flex flex-col gap-y-3">
            <p className="text-sm/[140%] text-nav-muted text-center">Approved by the shop. Confirm to receive your reward.</p>
            <button type="button" onClick={() => sendReward(approved)} className={PRIMARY}>
              Get {amountOf(approved)}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-y-3 py-2" role="status" aria-live="polite">
            <span className="w-14 h-14 rounded-full bg-surface text-heading flex items-center justify-center">
              <Loader2 className="w-7 h-7 animate-spin" strokeWidth={1.75} />
            </span>
            <p className="text-lg/none text-heading">Approved</p>
            <p className="text-sm/none text-nav-muted">
              {s === "gassing" ? "Getting things ready…" : `Sending ${amountOf(approved)} to your wallet…`}
            </p>
          </div>
        )}
      </Card>
    );
  }

  // ── Collapsed teaser (shop sheet, before paying) ───────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Show my reward code: ${tasks.map((t) => `${t.task}, ${amountOf(t)}`).join("; ")}`}
        className="w-full rounded-full bg-brand-soft p-2 pr-5 flex items-center gap-3 text-left cursor-pointer
          motion-safe:transition-colors hover:bg-brand-soft/70"
      >
        <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-white text-brand flex items-center justify-center">
          <Gift className="w-5 h-5" strokeWidth={1.75} />
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-y-1">
          <span className="text-base/none text-brand truncate">
            {tasks.length > 1 ? `${tasks.length} rewards here` : `Reward here · ${amountOf(lead)}`}
          </span>
          <span className="text-sm/none text-brand/70 truncate">
            {tasks.length > 1 ? tasks.map((t) => t.task).join(" · ") : lead.task}
          </span>
        </span>
        <span className="shrink-0 flex items-center gap-1 text-sm/none text-brand">
          <span className="hidden sm:inline">Show my code</span>
          <ChevronRight className="w-5 h-5" strokeWidth={2} aria-hidden />
        </span>
      </button>
    );
  }

  // ── Who can't get a code yet ───────────────────────────────────────────────
  let gate: React.ReactNode = null;
  if (!isConnected || !address) {
    gate = <GateNote title="Sign in to get this reward" body="Verified GoodDollar members can earn rewards at this shop." />;
  } else if (identity.isLoading) {
    gate = (
      <div className="flex items-center gap-2 text-sm/none text-nav-muted" role="status">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking your verification…
      </div>
    );
  } else if (identity.checkFailed) {
    gate = (
      <GateNote
        title="Couldn't check your verification"
        body="Check your connection, then try again."
        action={<SmallButton onClick={() => identity.refresh()}>Try again</SmallButton>}
      />
    );
  } else if (identity.isBlacklisted) {
    gate = <GateNote title="Rewards aren't available for this wallet" body="GoodDollar has blocked this wallet's verification." />;
  } else if (!identity.isVerified) {
    gate = (
      <GateNote
        title={identity.isLapsed ? "Re-verify to get this reward" : "Verify to get this reward"}
        body="Shop rewards are for verified GoodDollar members. It takes a minute, once."
        action={
          <SmallButton onClick={() => window.dispatchEvent(new CustomEvent("gd:openVerify"))}>
            {identity.isLapsed ? "Re-verify" : "Verify"}
          </SmallButton>
        }
      />
    );
  }

  return (
    <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="w-full flex flex-col gap-y-3">
      {tasks.length > 1 && (
        <div className="flex flex-col gap-y-2">
          <p className={`text-sm/none text-nav-muted px-1 ${surface === "receipt" ? "text-center" : ""}`}>Which reward did you earn?</p>
          <div role="radiogroup" aria-label="Rewards at this shop" className={`flex flex-wrap gap-2 ${surface === "receipt" ? "justify-center" : ""}`}>
            {tasks.map((t) => {
              const on = t.task === chosenTask;
              return (
                <button
                  key={t.task}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setTask(t.task)}
                  className={`max-w-full h-11 px-4 rounded-full text-sm/none truncate cursor-pointer motion-safe:transition-colors
                    ${on ? "bg-brand text-white" : "bg-white border border-line text-heading hover:bg-surface"}`}
                >
                  {t.task} · {amountOf(t)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {gate ? (
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-brand-soft text-brand flex items-center justify-center">
              <Gift className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1 flex flex-col gap-y-1.5">
              <p className="flex items-baseline justify-between gap-3 text-sm/none text-nav-muted">
                <span>Shop reward</span>
                <span className="shrink-0 text-heading tabular-nums">{amountOf(lead)}</span>
              </p>
              <p className="text-base/[130%] text-heading break-words">{lead.task}</p>
            </div>
          </div>
          {gate}
        </Card>
      ) : current && address ? (
        <TaskUnlock
          key={current.dropId}
          dropId={current.dropId}
          userLocation={userLocation}
          address={address}
          amountLabel={amountOf(current)}
          onApproved={onApproved}
          onUnavailable={onUnavailable}
        />
      ) : (
        <Card>
          <p className="text-sm/[140%] text-nav-muted text-center" role="status">
            Every reward for this task is being claimed right now. Check back in a few minutes.
          </p>
        </Card>
      )}
      {surface === "receipt" && !gate && current && (
        <p className="text-xs/[140%] text-nav-muted text-center px-4">
          Your G$ is sent automatically once the shop approves.
        </p>
      )}
    </m.div>
  );
}

const PRIMARY =
  "w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer " +
  "motion-safe:transition-colors hover:bg-brand/90";

function Card({ children }: { children: React.ReactNode }) {
  return <div className="w-full rounded-3xl border border-line bg-white p-5 text-left font-sans">{children}</div>;
}

function GateNote({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface p-4">
      <ShieldCheck className="w-5 h-5 shrink-0 text-heading" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1 flex flex-col gap-y-1">
        <p className="text-base/[130%] text-heading">{title}</p>
        <p className="text-sm/[140%] text-nav-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

function SmallButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 h-10 px-4 rounded-full bg-nav-active text-white text-sm/none cursor-pointer
        motion-safe:transition-opacity hover:opacity-90 whitespace-nowrap"
    >
      {children}
    </button>
  );
}
