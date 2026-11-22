"use client";
// TEMPORARY, LOCAL ONLY: exercises the real useSponsoredWrite hook from the
// app's normal Magic sign-in. Not linked anywhere; never committed.
import { useState } from "react";
import { useAccount } from "wagmi";
import { formatEther, maxUint256, type Address } from "viem";
import { publicClient } from "@/lib/publicClient";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import { canSponsor, policyAllows, toCall, SPONSOR_CONFIGURED } from "@/lib/sponsor";
import { ERC20_ABI, GOOD_DROPS_ADDRESS, G_TOKEN_ADDRESS } from "@/lib/contracts";

type Line = { t: string; ok?: boolean };

export default function QaSponsor() {
  const { address, connector } = useAccount();
  const { writeContractAsync } = useSponsoredWrite();
  const [log, setLog] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const say = (t: string, ok?: boolean) => setLog((l) => [...l, { t, ok }]);
  const params = { address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [GOOD_DROPS_ADDRESS, maxUint256] } as const;

  async function check() {
    setLog([]);
    say(`Configured: ${SPONSOR_CONFIGURED}`, SPONSOR_CONFIGURED);
    say(`Connected: ${address ?? "none"} via ${connector?.id ?? "-"}`, connector?.id === "magic");
    if (connector?.id !== "magic") say("Not a Magic wallet: disconnect it and sign in with email or Google to test sponsorship.", false);
    const t0 = performance.now();
    const can = await canSponsor(address, connector?.id);
    say(`Magic session matches (shared with app sign-in): ${can} in ${Math.round(performance.now() - t0)}ms`, can);
    if (address) say(`Policy allows this call: ${await policyAllows(address as Address, [toCall(params)])}`);
  }

  async function run() {
    if (!address) return;
    setBusy(true);
    try {
      const before = await publicClient.getBalance({ address });
      const t0 = performance.now();
      const hash = await writeContractAsync(params);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      // Sponsored hashes are already mined; a normal wallet tx may not be yet.
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      const after = await publicClient.getBalance({ address });
      const sponsored = rc.from.toLowerCase() !== address.toLowerCase();
      say(`Done in ${secs}s, status ${rc.status}`, rc.status === "success");
      say(sponsored ? `Sponsored: gas paid by ${rc.from}` : "NOT sponsored: you paid the gas", sponsored);
      say(`Your CELO ${formatEther(before)} -> ${formatEther(after)}`, before === after);
      say(`https://celoscan.io/tx/${hash}`);
    } catch (e) {
      say(`Failed: ${(e as Error).message}`, false);
    }
    setBusy(false);
  }

  const btn = "h-12 px-6 rounded-full bg-brand text-white disabled:opacity-50 cursor-pointer";
  return (
    <main className="min-h-dvh bg-surface font-sans p-4 sm:p-10">
      <div className="max-w-[640px] mx-auto bg-white rounded-3xl p-6 flex flex-col gap-4">
        <h1 className="text-xl text-heading">Sponsorship: real app path</h1>
        <p className="text-sm text-nav-muted">Sign in on the app normally first (email or Google). The action re-approves GoodDrops to spend your G$, which droppers already do. It moves no G$.</p>
        <div className="flex gap-3 flex-wrap">
          <button className={btn} disabled={busy} onClick={check}>1. Check</button>
          <button className={btn} disabled={busy || !address} onClick={run}>2. Run sponsored approve</button>
        </div>
        <ol className="flex flex-col gap-2 text-sm font-mono break-all">
          {log.map((l, i) => <li key={i} className={l.ok === false ? "text-red-600" : l.ok ? "text-green-700" : "text-heading"}>{l.t}</li>)}
        </ol>
      </div>
    </main>
  );
}
