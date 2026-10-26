"use client";
import { useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useSwitchChain,
} from "wagmi";
import { celo } from "viem/chains";
import { parseUnits, isAddress, getAddress } from "viem";
import { X, Loader2, Check, ExternalLink, SendHorizontal } from "lucide-react";
import { G_TOKEN_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { formatG$ } from "@/lib/utils";
import { useSheetDrag } from "@/hooks/useSheetDrag";
import { useEscapeLayer, useFocusReturn } from "@/components/ui/layers";

interface Props {
  address: `0x${string}`;
  balance: bigint;
  onClose: () => void;
}

/**
 * Send G$ — an ERC-20 transfer on Celo, send-only.
 *
 * Guards, in order, so a failure is always explained rather than left spinning:
 *   1. address + amount validation (incl. "not your own wallet", "more than you have")
 *   2. wallet is switched to Celo (otherwise the write waits on a hidden prompt)
 *   3. the transfer is simulated first, so a revert surfaces as a readable message
 */
export function SendGModal({ address, balance, onClose }: Props) {
  // Below lg this is a bottom sheet: it slides up on open and can be thumbed
  // down from the header to dismiss. At lg and up the hook is inert.
  const { sheetRef, sheetStyle, handleProps } = useSheetDrag({
    onDismiss: onClose,
  });

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );
  const [err, setErr] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | "">("");

  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const sending = status === "sending";

  // Docked beside the wallet card on desktop (so not a Sheet), but a layer of
  // its own: Escape closes Send and leaves the wallet open, and focus goes back
  // to the "Send G$" row afterwards. The wallet already holds the scroll lock.
  // Not while a transfer is in flight — closing mid-send would hide the result.
  useEscapeLayer(true, () => {
    if (status !== "sending") onClose();
  });
  useFocusReturn(true, sheetRef);

  function reset() {
    setRecipient("");
    setAmount("");
    setErr("");
    setTxHash("");
    setStatus("idle");
  }

  async function handleSend() {
    setErr("");
    const raw = recipient.trim();
    if (!isAddress(raw)) {
      setErr("Enter a valid wallet address (0x… , 42 characters).");
      return;
    }
    const to = getAddress(raw); // checksum
    if (to.toLowerCase() === address.toLowerCase()) {
      setErr("You can't send G$ to your own address.");
      return;
    }

    let amountWei: bigint;
    try {
      amountWei = parseUnits(amount.trim(), 18);
    } catch {
      setErr("Enter a valid amount.");
      return;
    }
    if (amountWei <= 0n) {
      setErr("Amount must be greater than 0.");
      return;
    }
    if (amountWei > balance) {
      setErr("That's more G$ than you have.");
      return;
    }

    setStatus("sending");
    try {
      // 1. Wallet must be on Celo, or the write silently waits on a hidden
      //    chain-switch prompt (a classic "stuck spinner" cause).
      if (chainId !== celo.id) {
        try {
          await switchChainAsync({ chainId: celo.id });
        } catch {
          setStatus("error");
          setErr("Switch your wallet to the Celo network, then try again.");
          return;
        }
      }

      // 2. Pre-simulate so a would-be revert comes back as a clear message.
      if (publicClient) {
        try {
          await publicClient.simulateContract({
            account: address,
            address: G_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [to, amountWei],
          });
        } catch (e: unknown) {
          const m = (e as { shortMessage?: string }).shortMessage ?? "";
          setStatus("error");
          setErr(
            m
              ? `This transfer would fail: ${m}`
              : "This transfer would fail on-chain.",
          );
          return;
        }
      }

      // 3. Submit — this opens the wallet for approval.
      const hash = await writeContractAsync({
        address: G_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [to, amountWei],
      });
      setTxHash(hash);
      const rc = await publicClient?.waitForTransactionReceipt({ hash });
      if (rc && rc.status === "reverted") {
        setStatus("error");
        setErr("Transfer reverted on-chain.");
        return;
      }
      setStatus("done");
      // Nudge every balance instance to refetch immediately.
      window.dispatchEvent(new Event("gd:verified"));
    } catch (e: unknown) {
      const error = e as { shortMessage?: string; message?: string };
      const msg = error.shortMessage ?? error.message ?? "Transfer failed.";
      setStatus("error");
      if (/User rejected|denied|rejected the request/i.test(msg))
        setErr("You cancelled the transaction.");
      else if (/insufficient funds/i.test(msg))
        setErr("Not enough CELO for gas — top up a little CELO first.");
      else setErr(msg);
    }
  }

  const inputCls =
    "w-full border border-line p-4 text-sm/[100%] rounded-full placeholder:text-nav-muted text-black outline-none focus:border-brand transition-colors disabled:opacity-60";

  return (
    // A bottom sheet below lg (rounded top corners, clearing the home indicator),
    // an ordinary card at lg and up.
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-label="Send G$"
      tabIndex={-1}
      className="outline-none bg-white rounded-t-3xl lg:rounded-3xl p-6 flex flex-col gap-y-6 font-sans
        max-h-[85dvh] overflow-y-auto lg:max-h-none lg:overflow-visible panel-in-lg"
      style={{
        boxShadow: "0px 0px 12px 0px #0000000A",
        paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
        ...sheetStyle,
      }}
    >
      {/* Drag handle: the rail + the title row. handleProps ignores pointerdowns
          that land on a button, so tapping X still closes rather than starting
          a drag that never moves. */}
      <div {...handleProps}>
        {/* Thumb rail, mobile only — the affordance that says "you can pull this". */}
        <span
          aria-hidden
          className="lg:hidden block w-9 h-1 mx-auto -mt-2 mb-4 rounded-full bg-line"
        />
        <div className="flex items-center justify-between">
          <h2 className="text-base/[100%] text-heading">Send G$</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-black rounded-full bg-surface cursor-pointer hover:opacity-80 transition-opacity"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {status === "done" ? (
        /* Success — confirm, link the receipt, and offer another send. */
        <div className="flex flex-col gap-y-4 items-center text-center py-2">
          <div className="w-12 h-12 rounded-full bg-streak-bg flex items-center justify-center">
            <Check className="w-6 h-6 text-streak" />
          </div>
          <div>
            <p className="text-lg/[100%] text-heading mb-2">Sent</p>
            <p className="text-sm/[140%] text-nav-muted">
              {amount} G$ is on its way.
            </p>
          </div>
          {txHash && (
            <a
              href={`https://celoscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm/[100%] text-brand hover:underline"
            >
              View on Celoscan <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            onClick={reset}
            className="w-full bg-nav-active py-[22px] flex justify-center items-center rounded-full text-white cursor-pointer hover:opacity-90 transition-opacity"
          >
            Send more
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <label
              htmlFor="recipient"
              className="block text-sm/[100%] text-nav-muted"
            >
              Recipient wallet
            </label>
            <input
              id="recipient"
              type="text"
              placeholder="0x..."
              value={recipient}
              disabled={sending}
              onChange={(e) => {
                setRecipient(e.target.value);
                if (err) setErr("");
              }}
              className={inputCls}
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-3">
              <label htmlFor="amount" className="text-sm/[100%] text-nav-muted">
                Amount
              </label>
              <div className="flex items-center gap-x-3 text-sm/[100%]">
                <h5 className="text-nav-active">
                  Balance: {formatG$(balance)} G$
                </h5>
                <button
                  type="button"
                  onClick={() => setAmount(formatUnitsPlain(balance))}
                  disabled={sending}
                  className="bg-brand-soft rounded-full py-1.5 px-3 text-brand cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-60"
                >
                  Max
                </button>
              </div>
            </div>

            <div className="relative">
              <input
                id="amount"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                disabled={sending}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (err) setErr("");
                }}
                className={`${inputCls} pr-16`}
              />
              <div className="absolute top-1/2 right-6 -translate-y-1/2">
                <span className="text-nav-muted text-sm/[100%]">G$</span>
              </div>
            </div>
          </div>

          {err && <p className="text-sm/[140%] text-danger -mt-2">{err}</p>}

          <div>
            <button
              onClick={handleSend}
              disabled={sending || !recipient.trim() || !amount.trim()}
              className="w-full bg-nav-active py-4 flex justify-center items-center gap-2 rounded-full mb-4 text-white cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <SendHorizontal className="w-4 h-4" />
              )}
              {sending ? "Sending…" : "Send G$"}
            </button>
            <h5 className="text-center text-xs/[100%] text-nav-muted">
              Sends on Celo · a tiny bit of CELO covers gas
            </h5>
          </div>
        </>
      )}
    </div>
  );
}

// Full-precision decimal string for the Max button (never scientific notation).
function formatUnitsPlain(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export default SendGModal;
