"use client";
import { useState } from "react";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import { useAuth } from "@/hooks/useAuth";
import { parseUnits, WaitForTransactionReceiptTimeoutError, type Hex } from "viem";
import {
  Store, Gift, MapPin, Eye, ExternalLink, Loader2, UtensilsCrossed, ShoppingBag,
  Wrench, Bus, Clock, PauseCircle, type LucideIcon,
} from "lucide-react";
import { publicClient } from "@/lib/publicClient";
import { G_TOKEN_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { haversineDistance, formatG$, formatUsdApprox } from "@/lib/utils";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { Celebration } from "@/components/Celebration";
import { Sheet } from "@/components/ui/Sheet";
import { ShopReceipt } from "@/components/ShopReceipt";
import type { Spot, LatLng } from "@/types";
import { track } from "@/lib/analytics";
import { isSpotActive } from "@/lib/spotStatus";

// How close a customer must be to pay — generous enough for GPS drift indoors,
// tight enough that payment still guarantees the merchant real foot traffic.
const PAY_RADIUS_M = 150;

/** "2685" → "2.7km", "640" → "640m" — distances read better at a glance. */
function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace(/\.0$/, "")}km` : `${m}m`;
}

const CATEGORY_ICON: Record<string, LucideIcon> = {
  food: UtensilsCrossed, retail: ShoppingBag, services: Wrench, transport: Bus, other: Store,
};

// "confirming": the transfer was sent but the network hasn't confirmed it yet.
// The customer must NOT pay again; we keep waiting in the background.
type PayStatus = "idle" | "paying" | "confirming" | "done" | "error";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

interface Props {
  spot: Spot | null;
  userLocation: LatLng | null;
  onClose: () => void;
  /** Merchant-side "see how customers view it" — pay is disabled. */
  preview?: boolean;
}

/**
 * Pay-at-the-shop sheet. Opens from a spot pin on the map and, in preview
 * mode, from the merchant's own card. Payment is a plain G$ transfer to the
 * merchant's wallet, gated on being physically within PAY_RADIUS_M.
 */
export function ShopSheet({ spot, userLocation, onClose, preview = false }: Props) {
  if (!spot) return null;
  return <ShopSheetBody spot={spot} userLocation={userLocation} onClose={onClose} preview={preview} />;
}

// Split so the hooks and form state mount fresh for each shop — reopening on a
// different spot can never show the previous amount or a stale "paid" screen.
function ShopSheetBody({
  spot, userLocation, onClose, preview,
}: { spot: Spot; userLocation: LatLng | null; onClose: () => void; preview: boolean }) {
  const { address, isConnected } = useSignedInAccount();
  const { login } = useAuth();
  const { balance } = useGoodDollarProfile();
  const { writeContractAsync } = useSponsoredWrite();

  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<PayStatus>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [paidTx, setPaidTx] = useState("");
  const [paidAt, setPaidAt] = useState(0);

  const distance = userLocation
    ? Math.round(haversineDistance(userLocation.lat, userLocation.lng, spot.lat, spot.lng))
    : null;
  const inRange = distance !== null && distance <= PAY_RADIUS_M;

  let amountWei = 0n;
  try { amountWei = amount ? parseUnits(amount, 18) : 0n; } catch { /* partial input */ }
  const insufficient = amountWei > 0n && amountWei > balance;

  // A shop that isn't live (paused, under review, suspended) never takes money,
  // however the customer got here: an old poster, a shared link, a stale map.
  const accepting = isSpotActive(spot) && ADDR_RE.test(spot.wallet);
  const canPay = accepting && isConnected && inRange && amountWei > 0n && !insufficient && status === "idle";
  const usd = amountWei > 0n ? formatUsdApprox(amountWei) : null;

  async function handlePay() {
    if (!address || !canPay) return;
    setStatus("paying");
    setErrMsg("");
    try {
      const tx = await writeContractAsync({
        address: G_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [spot.wallet as `0x${string}`, amountWei],
      });
      setPaidTx(tx);
      await confirm(tx);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      const msg = err.shortMessage ?? err.message ?? "";
      setErrMsg(/reject|denied|cancel/i.test(msg) ? "" : (msg || "Payment failed — try again."));
      setStatus(/reject|denied|cancel/i.test(msg) ? "idle" : "error");
    }
  }

  // Wait for the network to confirm. A slow confirmation is NOT a failure: the
  // G$ may still land, so we switch to "confirming" (no retry button) and keep
  // waiting instead of inviting a second payment.
  async function confirm(tx: Hex) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 45_000 });
        if (receipt.status !== "success") {
          setStatus("error");
          setErrMsg("Payment failed. No G$ was sent.");
          return;
        }
        setPaidAt(Date.now());
        setStatus("done");
        track("shop_payment_succeeded", { amountG: Math.floor(Number(amountWei / 10n ** 18n)) });
        // Record it for the merchant's dashboard. The server reads the payment
        // from the chain itself, so only the tx hash is sent.
        fetch(`/api/spots/${spot.id}/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tx }),
        }).catch(() => {});
        return;
      } catch (e) {
        if (!(e instanceof WaitForTransactionReceiptTimeoutError)) {
          // Lost the connection while waiting: the payment may still land.
          await new Promise((r) => setTimeout(r, 4_000));
        }
        setStatus("confirming");
      }
    }
  }

  function close() {
    setAmount("");
    setStatus("idle");
    setErrMsg("");
    setPaidTx("");
    onClose();
  }

  const Icon = CATEGORY_ICON[spot.category] ?? Store;

  const ctaLabel =
    status === "paying" ? "Paying…"
    : status === "error" ? "Try again"
    : !inRange ? "Get closer to pay"
    : amountWei === 0n ? "Enter an amount"
    : insufficient ? "Not enough G$"
    : `Pay ${amount} G$`;

  return (
    <Sheet title="Pay with G$" onClose={close} dismissible={status !== "paying"}>
      {status === "confirming" ? (
        <div className="flex flex-col items-center text-center pt-8 pb-2 gap-y-4" role="status" aria-live="polite">
          <span className="w-16 h-16 rounded-full bg-surface text-heading flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin" strokeWidth={1.75} />
          </span>
          <p className="text-xl/none text-heading">Payment sent</p>
          <p className="text-sm/[140%] text-nav-muted max-w-[320px]">
            The network is taking longer than usual to confirm it. Please don&apos;t pay again.
            This screen updates as soon as it&apos;s confirmed.
          </p>
          <a
            href={`https://celoscan.io/tx/${paidTx}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm/none text-brand hover:underline"
          >
            Check the transaction <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      ) : status === "done" ? (
        <>
          <Celebration active count={30} />
          <ShopReceipt amount={amount} shop={spot.name} tx={paidTx} paidAt={paidAt} onDone={close} />
        </>
      ) : (
        <div className="flex flex-col gap-y-6 pt-6">
          {/* ── Shop ─────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-4 min-w-0">
            <span className="w-14 h-14 shrink-0 rounded-full bg-surface flex items-center justify-center text-heading">
              <Icon className="w-6 h-6" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex flex-col gap-y-2">
              <p className="text-lg/none text-heading truncate">{spot.name}</p>
              {spot.description && (
                <p className="text-sm/[140%] text-nav-muted line-clamp-2">{spot.description}</p>
              )}
              {spot.placeName && (
                <p className="flex items-center gap-1.5 text-sm/none text-nav-muted truncate">
                  <MapPin className="w-4 h-4 shrink-0" strokeWidth={2} />
                  <span className="truncate">{spot.placeName}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft text-brand px-3 py-2 text-sm/none">
              <Store className="w-4 h-4" strokeWidth={2} /> Accepts G$
            </span>
            {spot.discount && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-streak-bg text-streak px-3 py-2 text-sm/none min-w-0">
                <Gift className="w-4 h-4 shrink-0" strokeWidth={2} />
                <span className="truncate">{spot.discount}</span>
              </span>
            )}
          </div>

          {preview && (
            <div className="flex items-start gap-3 rounded-2xl bg-surface px-4 py-3 text-sm/[140%] text-nav-muted">
              <Eye className="w-4.5 h-4.5 shrink-0 mt-px text-heading" strokeWidth={1.75} />
              <span>Preview — this is how customers see your shop. Payment is disabled here.</span>
            </div>
          )}

          {!accepting && (
            <div className="flex items-start gap-3 rounded-2xl bg-surface px-4 py-3 text-sm/[140%] text-heading" role="status">
              {spot.status === "pending"
                ? <Clock className="w-4.5 h-4.5 shrink-0 mt-px" strokeWidth={1.75} />
                : <PauseCircle className="w-4.5 h-4.5 shrink-0 mt-px" strokeWidth={1.75} />}
              <span>
                {preview
                  ? spot.status === "pending"
                    ? "Customers can pay you once your shop is approved."
                    : "Your shop isn't live, so customers can't pay you right now."
                  : spot.status === "pending"
                    ? "This shop isn't open for G$ payments yet."
                    : "This shop isn't taking G$ payments right now."}
              </span>
            </div>
          )}

          {(accepting || preview) && (
            <>
            {/* ── Proximity gate ───────────────────────────────────────────── */}
            <div
              className={`flex items-center gap-3 rounded-full p-2 pr-5 border ${
                inRange ? "border-transparent bg-brand-soft" : "border-line bg-white"
              }`}
            >
              <span
                className={`w-11.5 h-11.5 shrink-0 rounded-full flex items-center justify-center ${
                  inRange ? "bg-white text-brand" : "bg-surface text-heading"
                }`}
              >
                <MapPin className="w-5 h-5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex flex-col gap-y-1">
                <p className={`text-base/none ${inRange ? "text-brand" : "text-heading"}`}>
                  {!userLocation ? "Turn on location to pay here"
                    : inRange ? "You're at the shop"
                    : `${fmtDistance(distance!)} away`}
                </p>
                <p className={`text-sm/[140%] ${inRange ? "text-brand/70" : "text-nav-muted"}`}>
                  {inRange ? "Payment unlocked — pay in person with G$" : `Get within ${PAY_RADIUS_M}m to unlock payment`}
                </p>
              </div>
            </div>

            {/* ── Amount ───────────────────────────────────────────────────── */}
            <div>
              <label className="relative block">
                <span className="sr-only">Amount to pay in G$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="0"
                  value={amount}
                  disabled={status === "paying"}
                  onChange={(e) => { setAmount(e.target.value); if (status === "error") { setStatus("idle"); setErrMsg(""); } }}
                  className="w-full h-14 rounded-full bg-surface pl-5 pr-14 text-base/none text-heading
                    placeholder:text-nav-muted border border-transparent outline-none
                    motion-safe:transition-colors focus:border-brand disabled:opacity-60"
                />
                <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-base/none text-nav-muted">
                  G$
                </span>
              </label>
              <p
                role="status"
                aria-live="polite"
                className={`h-4 mt-3 px-5 text-sm/none truncate flex justify-between gap-3 ${
                  errMsg ? "text-danger" : insufficient ? "text-danger" : "text-nav-muted"
                }`}
              >
                <span className="truncate">
                  {errMsg ? errMsg : insufficient ? "Not enough G$" : `Balance: ${balance === 0n ? "0" : formatG$(balance)} G$`}
                </span>
                {!errMsg && usd && <span className="shrink-0">{usd}</span>}
              </p>
            </div>
            </>
          )}

          {/* ── CTA ──────────────────────────────────────────────────────── */}
          {preview ? (
            <button
              type="button"
              disabled
              className="w-full h-14 rounded-full bg-[#A4A4A4] text-white text-base/none cursor-not-allowed"
            >
              Preview only
            </button>
          ) : !accepting ? (
            <button
              type="button"
              disabled
              className="w-full h-14 rounded-full bg-[#A4A4A4] text-white text-base/none cursor-not-allowed"
            >
              Not taking G$ right now
            </button>
          ) : !isConnected ? (
            <button
              type="button"
              onClick={login}
              className="w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
                motion-safe:transition-colors hover:bg-brand/90"
            >
              Sign in to pay
            </button>
          ) : (
            <button
              type="button"
              onClick={status === "error" ? () => { setStatus("idle"); setErrMsg(""); } : handlePay}
              disabled={status === "paying" || (status !== "error" && !canPay)}
              className="w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
                flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-brand/90
                disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
            >
              {status === "paying" && <Loader2 className="w-5 h-5 animate-spin" />}
              {ctaLabel}
            </button>
          )}

          <p className="text-xs/[140%] text-nav-muted text-center -mt-2">
            G$ goes straight to the shop&apos;s wallet — no middleman, near-zero fees.
          </p>
        </div>
      )}
    </Sheet>
  );
}
