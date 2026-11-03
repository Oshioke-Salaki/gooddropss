"use client";
import { useRef, useState } from "react";
import { useSignMessage, useReadContract } from "wagmi";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import { parseUnits, maxUint256, decodeEventLog, type Hex } from "viem";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, G_TOKEN_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { degToGps, buildTaskHint, formatG$ } from "@/lib/utils";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { isValidTask, cleanTask, TASK_MAX_LEN } from "@/lib/taskShared";
import type { Spot } from "@/types";
import { taskCreateMessage } from "@/lib/taskCreateMsg";
import { Check, Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { confirmTx, StillPendingError, TxFailedError } from "@/lib/txOutcome";
import { friendlyClaimError } from "@/lib/claimErrors";

const DURATIONS = [
  { label: "1 day", s: 86_400 },
  { label: "7 days", s: 604_800 },
  { label: "30 days", s: 2_592_000 },
];

type Status = "idle" | "approving" | "creating" | "saving" | "done" | "error";

const INPUT =
  "w-full h-14 rounded-full bg-surface px-5 text-base/none text-heading placeholder:text-nav-muted " +
  "border border-transparent outline-none motion-safe:transition-colors focus:border-brand disabled:opacity-60";

// A merchant funds + creates a task-locked reward drop pinned at their spot.
// Reuses the normal drop escrow; the [T:spotId] tag + task record are what make
// it merchant-approved at claim time.
export function TaskDropCreator({ spot, onClose, onCreated }: { spot: Spot; onClose: () => void; onCreated: () => void }) {
  const { address } = useSignedInAccount();
  const { writeContractAsync } = useSponsoredWrite();
  const { signMessageAsync } = useSignMessage();
  const { balance } = useGoodDollarProfile();

  const { data: maxWei } = useReadContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "maxDropAmount" });
  const { data: minWei } = useReadContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "minDropAmount" });
  const maxDrop = (maxWei as bigint | undefined) ?? parseUnits("500", 18);
  const minDrop = (minWei as bigint | undefined) ?? parseUnits("1", 18);

  const [amount, setAmount] = useState("50");
  const [task, setTask]     = useState("");
  const [clue, setClue]     = useState("");
  const [duration, setDuration] = useState(604_800);
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr]       = useState("");
  // Once the reward has been sent, every later step (seeing it land, reading
  // its id, the owner's confirmation, saving the task) resumes from here.
  // While this is set the button can only finish the job, never fund again.
  const job = useRef<{ hash: Hex; dropId: string | null; sig: string | null } | null>(null);
  const [resumable, setResumable] = useState(false);

  // type="number" accepts things like "1e5" that parseUnits can't read.
  let amountWei = 0n;
  try { if (/^\d*\.?\d+$/.test(amount.trim()) && Number(amount) > 0) amountWei = parseUnits(amount.trim(), 18); } catch { amountWei = 0n; }
  const busy = status === "approving" || status === "creating" || status === "saving";

  const problem =
    !isValidTask(task) ? "Add a task (3–80 characters), e.g. \"Buy any coffee\"" :
    amountWei <= 0n ? "Enter a reward amount" :
    amountWei > maxDrop ? `Max reward is ${formatG$(maxDrop)} G$` :
    amountWei < minDrop ? `Min reward is ${formatG$(minDrop)} G$` :
    amountWei > balance ? `Not enough G$ — you have ${formatG$(balance)}` :
    null;

  async function handleCreate() {
    if (!address || problem || job.current) return;
    setErr(""); setStatus("approving");
    try {
      // 1. Approve escrow if needed.
      const allowance = await publicClient.readContract({
        address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [address, GOOD_DROPS_ADDRESS],
      });
      if (allowance < amountWei) {
        const aTx = await writeContractAsync({ address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [GOOD_DROPS_ADDRESS, maxUint256] });
        await confirmTx(aTx);
      }

      // 2. Create the drop at the spot, tagged [T:spotId] with a hunter-facing clue.
      setStatus("creating");
      // expiry is uint40 (a number in the ABI). Durations here (≥1 day) sit well
      // inside the contract's [min,max] window, and the max bound only relaxes as
      // the block time advances, so no skew padding is needed.
      const expiry = Math.floor(Date.now() / 1000) + duration;
      const hint = buildTaskHint(clue.trim() || `Task at ${spot.name}`, spot.id);
      const dTx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createDrop",
        args: [degToGps(spot.lat), degToGps(spot.lng), amountWei, expiry, hint],
      });
      job.current = { hash: dTx, dropId: null, sig: null };
      setResumable(true);
    } catch (e: unknown) {
      const fe = friendlyClaimError(e);
      if (fe.kind === "rejected") { setStatus("idle"); return; } // nothing was sent
      setErr(fe.kind === "network" ? fe.message : "That didn't go through, and none of your G$ was spent. Please try again.");
      setStatus("error");
      return;
    }
    await finish();
  }

  // Steps 3 and 4, resumable: see the reward land, read its id, confirm it's
  // yours, save the task. Never sends money.
  async function finish() {
    const j = job.current;
    if (!j || !address) return;
    setErr("");
    try {
      if (!j.dropId) {
        setStatus("creating");
        let rc;
        try {
          rc = await confirmTx(j.hash);
        } catch (e) {
          if (e instanceof TxFailedError) {
            job.current = null; setResumable(false);
            setErr("That didn't go through, and none of your G$ was spent. Please try again.");
            setStatus("error");
            return;
          }
          throw e;
        }
        window.dispatchEvent(new CustomEvent("gd:drop-created"));
        for (const log of rc.logs) {
          try {
            const dec = decodeEventLog({ abi: GOOD_DROPS_ABI, data: log.data, topics: log.topics, eventName: "DropCreated" });
            if (dec.args.dropId !== undefined) { j.dropId = String(dec.args.dropId); break; }
          } catch { /* not this log */ }
        }
        if (!j.dropId) throw new Error("no drop id");
      }
      if (!j.sig) {
        setStatus("saving");
        j.sig = await signMessageAsync({ message: taskCreateMessage(j.dropId, spot.id) });
      }
      await saveTask(j.dropId, j.sig);
    } catch (e: unknown) {
      const fe = friendlyClaimError(e);
      setErr(
        e instanceof StillPendingError
          ? "Your reward is still being funded. Give it a moment, then tap Finish setting up. You won't be charged again."
          : fe.kind === "rejected"
            ? "Your reward is funded. Approve the request in your wallet to finish setting it up. You won't be charged again."
            : "Your reward is funded, but we couldn't finish setting it up. Tap Finish setting up. You won't be charged again.",
      );
      setStatus("error");
    }
  }

  // Persist the task record with retries. The mint tx is already confirmed, so a
  // failure here is almost always read-after-write lag on the server — retry a
  // few times, and if it still fails keep the job so the merchant can finish
  // without minting (and paying for) a second drop.
  async function saveTask(dropId: string, sig: string) {
    if (!address) return;
    setStatus("saving"); setErr("");
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch("/api/task/create", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dropId, spotId: spot.id, task: cleanTask(task), ownerAddress: address, signature: sig }),
        });
        if (res.ok) { job.current = null; setResumable(false); setStatus("done"); onCreated(); return; }
        // A refused signature won't get better by retrying with the same one.
        if (res.status === 401 || res.status === 403) { if (job.current) job.current.sig = null; break; }
      } catch { /* network: retry */ }
      if (i < 2) await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("save failed");
  }

  // The hint doubles as guidance: the first thing to fix is always visible.
  const hint = err || problem;
  const ctaLabel =
    status === "approving" ? "Getting ready…"
    : status === "creating" ? "Funding your reward…"
    : status === "saving" ? "Saving the task…"
    : resumable ? "Finish setting up"
    : `Fund ${amount || "?"} G$ reward`;

  return (
    <Sheet title="New reward drop" onClose={onClose} dismissible={!busy} width={440}>
      {status === "done" ? (
        <div className="flex flex-col items-center text-center pt-8 pb-2 gap-y-4">
          <span className="success-pop w-16 h-16 rounded-full bg-brand-soft text-brand flex items-center justify-center">
            <Check className="w-9 h-9" strokeWidth={2.25} />
          </span>
          <p className="text-xl/none text-heading">Reward drop is live</p>
          <p className="text-sm/[140%] text-nav-muted">
            {formatG$(amountWei)} G$ is funded and pinned at {spot.name}. Hunters do the task, you scan their code to approve.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
              motion-safe:transition-colors hover:bg-brand/90"
          >
            Done
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-y-5 pt-6"
          onSubmit={(e) => { e.preventDefault(); if (busy) return; if (job.current) finish(); else handleCreate(); }}
        >
          <p className="text-sm/[140%] text-nav-muted -mt-1">
            Pinned at <span className="text-heading">{spot.name}</span>. The G$ is set aside until you approve a hunter.
          </p>

          <label className="block">
            <span className="block text-sm/none text-nav-muted mb-3">The task (hunters must do this)</span>
            <input
              value={task}
              onChange={(e) => setTask(e.target.value.slice(0, TASK_MAX_LEN))}
              placeholder="Buy any coffee"
              disabled={busy}
              className={INPUT}
            />
          </label>

          <label className="block">
            <span className="block text-sm/none text-nav-muted mb-3">Reward</span>
            <span className="relative block">
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0"
                disabled={busy || resumable}
                className={`${INPUT} pr-14`}
              />
              <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-base/none text-nav-muted">G$</span>
            </span>
          </label>

          <div>
            <span className="block text-sm/none text-nav-muted mb-3">Expires in</span>
            <div role="radiogroup" aria-label="Expires in" className="flex gap-2">
              {DURATIONS.map((d) => {
                const on = duration === d.s;
                return (
                  <button
                    key={d.s}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={busy || resumable}
                    onClick={() => setDuration(d.s)}
                    className={`flex-1 h-11 rounded-full text-sm/none cursor-pointer motion-safe:transition-colors
                      disabled:cursor-not-allowed
                      ${on ? "bg-brand text-white" : "border border-line bg-white text-heading hover:bg-surface"}`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <span className="block text-sm/none text-nav-muted mb-3">Map clue (optional)</span>
            <input
              value={clue}
              onChange={(e) => setClue(e.target.value.slice(0, 150))}
              placeholder={`e.g. At the ${spot.name} counter`}
              disabled={busy || resumable}
              className={INPUT}
            />
          </label>

          <div>
            <p
              role="status"
              aria-live="polite"
              className={`min-h-4 mb-3 px-5 text-sm/[140%] ${err ? "text-danger" : "text-nav-muted"}`}
            >
              {hint ?? ""}
            </p>
            <button
              type="submit"
              disabled={busy || (!resumable && !!problem)}
              className="w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
                flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-brand/90
                disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
            >
              {busy && <Loader2 className="w-5 h-5 animate-spin" />}
              {ctaLabel}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
