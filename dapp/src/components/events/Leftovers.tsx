"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import { confirmTx } from "@/lib/txOutcome";
import { toast } from "@/lib/toast";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { friendlyClaimError } from "@/lib/claimErrors";
import { formatG$ } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { span } from "./format";

interface Mine { id: string; amountWei: string; expiry: number }

// The contract takes back many drops in one transaction; keep each one well
// inside a block's gas.
const CHUNK = 40;

/**
 * After the event (or a cancellation): this host's unclaimed drops, and one
 * tap to take the G$ back once they've expired. Each host sees and reclaims
 * only the drops they placed themselves; that's what the contract allows.
 */
export function Leftovers({ eventId, address, now }: { eventId: string; address: string; now: number }) {
  const { writeContractAsync } = useSponsoredWrite();
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Failing to load must never look like "nothing left to take back".
  const [loadErr, setLoadErr] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/drops?dropper=${address.toLowerCase()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { mine: Mine[] };
      setMine(d.mine);
      setLoadErr(false);
    } catch { setLoadErr(true); }
  }, [eventId, address]);
  useEffect(() => { load(); }, [load]);

  if (!mine && loadErr) {
    return (
      <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 flex flex-col gap-3" role="alert">
        <h2 className="text-lg/none text-heading">Your unclaimed G$</h2>
        <p className="text-sm/[145%] text-nav-muted">Couldn&apos;t check for drops nobody found. Your G$ is safe.</p>
        <button type="button" disabled={retrying}
          onClick={async () => { setRetrying(true); await load(); setRetrying(false); }}
          className="h-11 rounded-full border border-line text-sm/none text-heading flex items-center justify-center gap-2 cursor-pointer hover:bg-surface disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${retrying ? "animate-spin" : ""}`} /> {retrying ? "Checking…" : "Try again"}
        </button>
      </section>
    );
  }
  if (!mine || (mine.length === 0 && !done)) return null;

  const ready = mine.filter((d) => d.expiry <= now);
  const waiting = mine.filter((d) => d.expiry > now);
  const sum = (xs: Mine[]) => xs.reduce((s, d) => s + BigInt(d.amountWei), 0n);
  const nextAt = waiting[0]?.expiry;

  async function reclaim() {
    setBusy(true);
    setError("");
    try {
      const ids = ready.map((d) => BigInt(d.id));
      const total = sum(ready);
      for (let i = 0; i < ids.length; i += CHUNK) {
        const tx = await writeContractAsync({
          address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "reclaimManyExpired", args: [ids.slice(i, i + CHUNK)],
        });
        await confirmTx(tx);
      }
      setDone(formatG$(total));
      toast.success(`${formatG$(total)} G$ is back in your wallet`);
      track("event_leftovers_reclaimed");
      // The indexer catches up a few seconds behind the chain.
      setMine((m) => m?.filter((d) => d.expiry > now) ?? m);
      window.setTimeout(load, 8000);
    } catch (e) {
      const fe = friendlyClaimError(e);
      if (fe.kind !== "rejected") setError(fe.kind === "network" || fe.kind === "gas" ? fe.message : "Couldn't take them back. Try again.");
      load(); // some may have come back before the failure: show what's left
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 flex flex-col gap-3" aria-labelledby="left-h">
      <h2 id="left-h" className="text-lg/none text-heading">Your unclaimed G$</h2>
      {done && (
        <p className="rounded-2xl bg-brand-soft text-brand px-4 py-3 text-sm/[145%] flex items-center gap-2" role="status">
          <Check className="w-4 h-4 shrink-0" /> {done} G$ is back in your wallet.
        </p>
      )}
      {ready.length > 0 && (
        <>
          <p className="text-sm/[145%] text-nav-muted">
            {ready.length} {ready.length === 1 ? "drop" : "drops"} nobody found, {formatG$(sum(ready))} G$ in all. Take it back in one go.
          </p>
          <button type="button" onClick={reclaim} disabled={busy}
            className="h-12 rounded-full bg-brand text-white text-sm/none flex items-center justify-center gap-2 cursor-pointer hover:bg-brand/90 disabled:opacity-60 disabled:cursor-wait">
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Taking it back…</> : <><Undo2 className="w-4 h-4" /> Take back {formatG$(sum(ready))} G$</>}
          </button>
        </>
      )}
      {waiting.length > 0 && (
        <p className="text-sm/[145%] text-nav-muted flex items-start gap-2">
          <Clock className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {formatG$(sum(waiting))} G$ in {waiting.length} {waiting.length === 1 ? "drop" : "drops"} can come back{" "}
            {nextAt && nextAt - now >= 60 ? `in ${span(nextAt - now)}` : "in a minute"}, once {waiting.length === 1 ? "it expires" : "they expire"}.
          </span>
        </p>
      )}
      {error && <p className="text-sm/[145%] text-danger" role="alert">{error}</p>}
    </section>
  );
}
