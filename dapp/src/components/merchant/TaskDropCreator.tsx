"use client";
import { useState } from "react";
import { useWriteContract, useSignMessage, useReadContract } from "wagmi";
import { parseUnits, maxUint256, decodeEventLog } from "viem";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, G_TOKEN_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { degToGps, buildTaskHint, formatG$ } from "@/lib/utils";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { isValidTask, cleanTask, TASK_MAX_LEN } from "@/lib/taskShared";
import type { Spot } from "@/types";
import { taskCreateMessage } from "@/lib/taskCreateMsg";
import { Gift, X, PartyPopper } from "lucide-react";

const DURATIONS = [
  { label: "1 day", s: 86_400 },
  { label: "7 days", s: 604_800 },
  { label: "30 days", s: 2_592_000 },
];

type Status = "idle" | "approving" | "creating" | "saving" | "done" | "error";

// A merchant funds + creates a task-locked reward drop pinned at their spot.
// Reuses the normal drop escrow; the [T:spotId] tag + task record are what make
// it merchant-approved at claim time.
export function TaskDropCreator({ spot, onClose, onCreated }: { spot: Spot; onClose: () => void; onCreated: () => void }) {
  const { address } = useSignedInAccount();
  const { writeContractAsync } = useWriteContract();
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
  // Set when the drop minted but the task record didn't save — lets the merchant
  // finish saving WITHOUT re-funding (which would mint a second, wasted drop).
  const [pendingSave, setPendingSave] = useState<{ dropId: string; sig: string } | null>(null);

  const amountNum = parseFloat(amount);
  const amountWei = !isNaN(amountNum) && amountNum > 0 ? parseUnits(amount, 18) : 0n;
  const busy = status === "approving" || status === "creating" || status === "saving";

  const problem =
    !isValidTask(task) ? "Add a task (3–80 chars), e.g. \"Buy any coffee\"" :
    amountWei <= 0n ? "Enter a reward amount" :
    amountWei > maxDrop ? `Max reward is ${formatG$(maxDrop)} G$` :
    amountWei < minDrop ? `Min reward is ${formatG$(minDrop)} G$` :
    amountWei > balance ? `Not enough G$ — you have ${formatG$(balance)}` :
    null;

  async function handleCreate() {
    if (!address || problem) return;
    setErr(""); setStatus("approving");
    try {
      // 1. Approve escrow if needed.
      const allowance = await publicClient.readContract({
        address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [address, GOOD_DROPS_ADDRESS],
      });
      if (allowance < amountWei) {
        const aTx = await writeContractAsync({ address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [GOOD_DROPS_ADDRESS, maxUint256] });
        await publicClient.waitForTransactionReceipt({ hash: aTx });
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
      const rc = await publicClient.waitForTransactionReceipt({ hash: dTx });

      // 3. Extract the new dropId from the DropCreated event.
      let dropId: string | null = null;
      for (const log of rc.logs) {
        try {
          const dec = decodeEventLog({ abi: GOOD_DROPS_ABI, data: log.data, topics: log.topics, eventName: "DropCreated" });
          if (dec.args.dropId !== undefined) { dropId = String(dec.args.dropId); break; }
        } catch { /* not this log */ }
      }
      if (!dropId) throw new Error("Created, but couldn't read the drop id — refresh and try again.");

      // 4. Store the task record (owner-signed).
      const sig = await signMessageAsync({ message: taskCreateMessage(dropId, spot.id) });
      await saveTask(dropId, sig);
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Failed";
      setErr(/rejected|denied/i.test(m) ? "Cancelled." : m);
      setStatus("error");
    }
  }

  // Persist the task record with retries. The mint tx is already confirmed, so a
  // failure here is almost always read-after-write RPC lag on the server — retry
  // a few times, and if it still fails keep the dropId+sig so the merchant can
  // finish saving without minting (and paying for) a second drop.
  async function saveTask(dropId: string, sig: string) {
    if (!address) return;
    setStatus("saving"); setErr("");
    let lastErr = "Saving the task failed.";
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch("/api/task/create", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dropId, spotId: spot.id, task: cleanTask(task), ownerAddress: address, signature: sig }),
        });
        if (res.ok) { setPendingSave(null); setStatus("done"); onCreated(); return; }
        const d = await res.json().catch(() => ({}));
        lastErr = d.error ?? lastErr;
      } catch { lastErr = "Network error while saving the task."; }
      if (i < 2) await new Promise((r) => setTimeout(r, 1500));
    }
    setPendingSave({ dropId, sig });
    setErr(`${lastErr} Your reward is already funded — tap “Finish saving” to complete it (this won't charge you again).`);
    setStatus("error");
  }

  if (status === "done") {
    return (
      <div className="border-2 border-ink rounded-2xl p-5 bg-lime shadow-brutal text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-ink text-lime flex items-center justify-center">
          <PartyPopper size={26} />
        </div>
        <p className="font-black text-lg mt-2">Reward drop is live!</p>
        <p className="text-sm text-ink/70 mt-1">{formatG$(amountWei)} G$ is funded and pinned at {spot.name}. Hunters do the task, you scan their code to approve.</p>
        <button onClick={onClose} className="btn-brutal mt-4 w-full py-3 rounded-xl font-black bg-ink text-lime">Done</button>
      </div>
    );
  }

  return (
    <div className="border-2 border-ink rounded-2xl p-4 bg-card shadow-brutal-sm space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 font-black text-sm"><Gift size={16} /> New reward drop · {spot.name}</p>
        <button onClick={onClose} className="w-7 h-7 rounded-full border-2 border-ink flex items-center justify-center"><X size={14} /></button>
      </div>

      <label className="block">
        <span className="text-[11px] font-black uppercase tracking-wide text-muted">The task (hunters must do this)</span>
        <input value={task} onChange={(e) => setTask(e.target.value.slice(0, TASK_MAX_LEN))} placeholder="Buy any coffee"
          className="mt-1 w-full border-2 border-ink rounded-xl px-3 py-2.5 text-sm font-semibold outline-none" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-black uppercase tracking-wide text-muted">Reward (G$)</span>
          <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} min="0"
            className="mt-1 w-full border-2 border-ink rounded-xl px-3 py-2.5 text-sm font-black outline-none" />
        </label>
        <label className="block">
          <span className="text-[11px] font-black uppercase tracking-wide text-muted">Expires in</span>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
            className="mt-1 w-full border-2 border-ink rounded-xl px-3 py-2.5 text-sm font-semibold outline-none bg-white">
            {DURATIONS.map((d) => <option key={d.s} value={d.s}>{d.label}</option>)}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-[11px] font-black uppercase tracking-wide text-muted">Map clue (optional)</span>
        <input value={clue} onChange={(e) => setClue(e.target.value.slice(0, 150))} placeholder={`e.g. At ${spot.name} counter`}
          className="mt-1 w-full border-2 border-ink rounded-xl px-3 py-2.5 text-sm font-semibold outline-none" />
      </label>

      {(err || problem) && <p className="text-xs font-bold text-danger">{err || problem}</p>}

      <button
        onClick={pendingSave ? () => saveTask(pendingSave.dropId, pendingSave.sig) : handleCreate}
        disabled={busy || (!pendingSave && !!problem)}
        className="btn-brutal w-full py-3 rounded-xl font-black text-sm bg-lime text-ink disabled:opacity-60 disabled:cursor-not-allowed">
        {status === "approving" ? "Approving G$…"
          : status === "creating" ? "Creating drop…"
          : status === "saving" ? "Saving task…"
          : pendingSave ? "Finish saving task"
          : `Fund ${amount || "?"} G$ reward`}
      </button>
    </div>
  );
}
