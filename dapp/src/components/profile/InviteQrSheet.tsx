"use client";
import { useCallback, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Camera, Check, Copy } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { shortAddr } from "@/lib/utils";
import { track } from "@/lib/analytics";

/**
 * Your invite link as a big QR code, for inviting someone standing next to
 * you: they point their phone camera at it and land on GoodDrops with your
 * link, exactly as if you had sent it to them.
 */
export function InviteQrSheet({
  address,
  username,
  invite,
  onClose,
}: {
  address: string;
  username: string | null;
  invite: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      track("invite_link_copied");
    } catch { /* clipboard blocked: the link is printed below */ }
  }, [invite]);

  return (
    <Sheet title="Scan to join" onClose={onClose} width={400}>
      <div className="flex flex-col items-center text-center mt-5">
        <div className="flex items-center gap-2.5 min-w-0 max-w-full">
          <ProfileAvatar address={address} size={32} ringColor="transparent" />
          <span className="text-base/none text-heading truncate">
            {username ? `@${username}` : shortAddr(address)}
          </span>
        </div>

        {/* White quiet zone around the code so phone cameras lock on fast,
            even against a dark screen setting. */}
        <div className="mt-5 rounded-3xl border border-line bg-white p-5">
          <QRCodeSVG
            value={invite}
            size={232}
            level="M"
            marginSize={0}
            role="img"
            aria-label="QR code for your invite link"
            style={{ display: "block", width: "min(232px, 62vw)", height: "auto" }}
          />
        </div>

        <p className="flex items-center gap-2 text-sm/[140%] text-nav-muted mt-5">
          <Camera className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          Point a phone camera here to join through you
        </p>

        <button
          type="button"
          onClick={copy}
          className="mt-5 w-full h-11 rounded-full border border-line px-5 flex items-center justify-center gap-2
            text-sm/none text-heading cursor-pointer motion-safe:transition-colors hover:bg-surface min-w-0"
          title={invite}
        >
          {copied
            ? <Check className="w-[18px] h-[18px] text-brand shrink-0" />
            : <Copy className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />}
          <span className="truncate">{copied ? "Link copied" : invite.replace(/^https?:\/\//, "")}</span>
        </button>
      </div>
    </Sheet>
  );
}
