"use client";
import { Wallet } from "lucide-react";
import type { Connector } from "wagmi";
import { OptionRow } from "./OptionRow";

interface Props {
  connectors: readonly Connector[];
  /** Connector id currently mid-connect, so its row shows a spinner. */
  pendingId: string | null;
  busy: boolean;
  onPick: (c: Connector) => void;
}

/**
 * The "Choose a wallet" step.
 *
 * Body only — the card, header, back button and close button are AuthSheet's,
 * shared with the sign-in step so the card doesn't remount (and re-animate)
 * when you move between them.
 *
 * Rows come straight off wagmi's connector list, so a wallet appears here
 * exactly when the browser can actually connect to it. Only reached when more
 * than one is available; a lone wallet is connected directly.
 */
export function WalletSelectModal({ connectors, pendingId, busy, onPick }: Props) {
  return (
    <>
      <p className="text-sm/none text-nav-muted px-6 mt-6">
        Connect the wallet that holds your G$.
      </p>

      <div className="p-6 space-y-2.5">
        {connectors.map((c) => (
          <OptionRow
            key={c.uid}
            label={c.name}
            iconSrc={c.icon}
            iconFallback={<Wallet className="w-5 h-5 text-heading" />}
            onClick={() => onPick(c)}
            disabled={busy && pendingId !== c.id}
            busy={pendingId === c.id}
          />
        ))}
      </div>
    </>
  );
}
