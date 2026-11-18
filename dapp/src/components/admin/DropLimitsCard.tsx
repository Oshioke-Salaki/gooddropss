"use client";
import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { parseAbi, parseUnits, type Address } from "viem";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { publicClient } from "@/lib/publicClient";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import { Button, Card, Field, Hint, Input, SectionTitle } from "./ui";

const OWNER_ABI = parseAbi(["function owner() view returns (address)"]);
/** A sanity ceiling for typos (an extra zero), not a contract rule. */
const MAX_SANE_G = 1_000_000;
const whole = (wei: bigint | undefined) => (wei === undefined ? null : Number(wei / 10n ** 18n));

/**
 * The largest and smallest single drop, read live from the contract. The owner
 * wallet can change the maximum here; the drop form reads the same values, so a
 * change applies to everyone at once with no app release. Owner-only calls are
 * never sponsored, so the owner's own wallet pays the small network fee.
 */
export function DropLimitsCard() {
  const { address } = useAccount();
  const { writeContractAsync } = useSponsoredWrite();
  const { data: owner } = useReadContract({ address: GOOD_DROPS_ADDRESS, abi: OWNER_ABI, functionName: "owner" });
  const { data: maxWei, refetch: refetchMax } = useReadContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "maxDropAmount" });
  const { data: minWei } = useReadContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "minDropAmount" });

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);

  const max = whole(maxWei as bigint | undefined);
  const min = whole(minWei as bigint | undefined);
  const isOwner = !!address && !!owner && address.toLowerCase() === (owner as string).toLowerCase();

  const n = Number(value.replace(/[,\s]/g, ""));
  const valid = value.trim() !== "" && Number.isInteger(n) && min !== null && n >= Math.max(min, 1) && n <= MAX_SANE_G && n !== max;

  const save = async () => {
    if (!valid || !address || busy) return;
    setBusy(true);
    setMsg(null);
    const params = {
      address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "setMaxDropAmount" as const,
      args: [parseUnits(String(n), 18)] as const,
    };
    try {
      // Check first, so a mistake shows a reason instead of a failed send.
      await publicClient.simulateContract({ ...params, account: address as Address });
      const hash = await writeContractAsync(params as never);
      const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (rc.status !== "success") throw new Error("reverted");
      await refetchMax();
      setValue("");
      setMsg({ text: `Done. Drops can now be up to ${n.toLocaleString("en-US")} G$.`, tone: "ok" });
    } catch (e) {
      const m = e instanceof Error ? e.message.toLowerCase() : "";
      setMsg({
        text: /reject|denied|cancel/.test(m) ? "Cancelled in your wallet."
          : /insufficient funds|gas/.test(m) ? "Your wallet needs a little CELO for the network fee."
          : /ownable|unauthorized/.test(m) ? "Only the contract owner can change this."
          : "Couldn't save the new limit. Nothing changed. Try again.",
        tone: "bad",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6">
      <SectionTitle className="mb-2">Drop limits</SectionTitle>
      <p className="text-sm/[145%] text-nav-muted mb-5">
        The smallest and largest single drop anyone can hide. Read live from the contract; the drop form uses the same values.
      </p>
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-2xl bg-surface px-4 py-3">
          <div className="text-xs/none text-nav-muted mb-2">Smallest</div>
          <div className="text-xl/none text-heading">{min === null ? "…" : `${min.toLocaleString("en-US")} G$`}</div>
        </div>
        <div className="rounded-2xl bg-surface px-4 py-3">
          <div className="text-xs/none text-nav-muted mb-2">Largest</div>
          <div className="text-xl/none text-heading">{max === null ? "…" : `${max.toLocaleString("en-US")} G$`}</div>
        </div>
      </div>

      {isOwner ? (
        <>
          <form
            className="flex flex-col sm:flex-row sm:items-end gap-3"
            onSubmit={(e) => { e.preventDefault(); void save(); }}
          >
            <div className="flex-1 min-w-0">
              <Field label="New largest drop (G$)" hint={`Between ${(min ?? 1).toLocaleString("en-US")} and ${MAX_SANE_G.toLocaleString("en-US")}. Your wallet pays a small network fee.`}>
                <Input inputMode="numeric" placeholder="10,000" value={value} disabled={busy}
                  onChange={(e) => { setValue(e.target.value); setMsg(null); }} aria-label="New largest drop in G$" />
              </Field>
            </div>
            <Button type="submit" variant="primary" busy={busy} disabled={!valid} className="sm:mb-[26px]">
              {busy ? "Saving…" : "Save"}
            </Button>
          </form>
          {msg && <Hint text={msg.text} tone={msg.tone} className="mt-3" />}
        </>
      ) : (
        <p className="text-sm/[145%] text-nav-muted">
          Only the contract owner{owner ? ` (${(owner as string).slice(0, 6)}…${(owner as string).slice(-4)})` : ""} can change these.
        </p>
      )}
    </Card>
  );
}
