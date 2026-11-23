"use client";
import { useState } from "react";
import { Check, Loader2, UserPlus } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useProfile } from "@/hooks/useProfile";
import { friendlyClaimError } from "@/lib/claimErrors";
import { InviteRequestError } from "@/hooks/useReferral";
import {
  inviteOutcome, isFinalInvite, parseInviterInput, shortAddress,
  type InviteResult,
} from "@/lib/referral";

/** Sits above onboarding and other prompts: it's one tap and time-sensitive. */
const Z = 1470;

/** "@ada" when they have a name, else a short address. */
export function useInviterName(address: string | null | undefined): string {
  const profile = useProfile(address ?? undefined);
  if (!address) return "them";
  return profile?.username ? `@${profile.username}` : shortAddress(address);
}

/** The wallet said no, or the request failed: one plain sentence (or "" for a deliberate cancel). */
function errorText(e: unknown): string {
  if (e instanceof InviteRequestError) return e.message;
  const fe = friendlyClaimError(e);
  if (fe.kind === "rejected") return "";
  return "Couldn't confirm it. Please try again.";
}

function Outcome({ result, name, onClose }: { result: InviteResult; name: string; onClose: () => void }) {
  const o = inviteOutcome(result, name);
  const good = o.tone === "ok";
  return (
    <div className="flex flex-col items-center text-center gap-5 pt-2">
      <span className={`w-16 h-16 rounded-full flex items-center justify-center ${good ? "bg-brand text-white" : "bg-surface text-nav-muted"}`}>
        {good ? <Check className="w-8 h-8" strokeWidth={2.25} /> : <UserPlus className="w-8 h-8" strokeWidth={1.75} />}
      </span>
      <p role="status" className="text-base/[150%] text-heading">{o.text}</p>
      <button type="button" onClick={onClose}
        className="w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer hover:bg-brand/90">
        {good ? "Back to the hunt" : "Close"}
      </button>
    </div>
  );
}

// ── "You were invited": for wallets that show a prompt ───────────────────────

/**
 * Shown to someone who arrived through an invite link and signed in with a
 * wallet that asks before confirming anything (MiniPay, Valora, MetaMask…).
 * Magic wallets never see it: their invite is accepted in the background.
 */
export function ConfirmInviteSheet({ referrer, accept, onClose }: {
  referrer: string;
  accept: (referrer: string) => Promise<InviteResult>;
  /** `final`: nothing more to ask (accepted, or it can never count). */
  onClose: (final: boolean) => void;
}) {
  const name = useInviterName(referrer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InviteResult | null>(null);

  const confirm = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { setResult(await accept(referrer)); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const close = () => { if (!busy) onClose(!!result && (isFinalInvite(result.status) || result.status === "waiting")); };

  return (
    <Sheet title={result ? "Invite" : "You were invited"} onClose={close} dismissible={!busy} zIndex={Z} width={420}>
      {result ? <Outcome result={result} name={name} onClose={close} /> : (
        <div className="flex flex-col items-center text-center gap-5 pt-2">
          <ProfileAvatar address={referrer} size={72} />
          <p className="text-base/[150%] text-heading">
            <span className="font-medium">{name}</span> invited you to GoodDrops. Confirm it so they get credit when you start hunting.
          </p>
          <button type="button" onClick={confirm} disabled={busy}
            className="w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed">
            {busy && <Loader2 className="w-5 h-5 animate-spin" />}
            {busy ? "Confirm in your wallet…" : "Confirm invite"}
          </button>
          {error
            ? <p role="status" className="text-sm/[145%] text-danger -mt-1">{error}</p>
            : <p className="text-xs/[145%] text-nav-muted -mt-1">Free, one tap. Nothing leaves your wallet.</p>}
          <button type="button" onClick={close} disabled={busy}
            className="h-10 px-5 -mt-2 rounded-full text-sm/none text-nav-muted cursor-pointer hover:text-heading disabled:opacity-50">
            Not now
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ── "Who invited you?": the manual fallback ──────────────────────────────────

async function lookupUsername(username: string): Promise<string> {
  const r = await fetch(`/api/profile/resolve?username=${encodeURIComponent(username)}`);
  const j = await r.json().catch(() => null) as { address?: string; error?: string } | null;
  if (!r.ok || !j?.address) throw new InviteRequestError(j?.error ?? "Couldn't find that person.", r.status);
  return j.address;
}

/**
 * For someone whose invite didn't come with them (they opened the link on one
 * phone or browser and signed up on another). They type who invited them: a
 * username, or paste the invite link.
 */
export function InvitedBySheet({ self, accept, onClose }: {
  /** The signed-in wallet, so they can't pick themselves. */
  self: string;
  accept: (referrer: string) => Promise<InviteResult>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ r: InviteResult; who: string; typed: string | null } | null>(null);
  // What they typed reads best ("@ada"); a pasted link falls back to a lookup.
  const looked = useInviterName(result?.who);
  const name = result?.typed ?? looked;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const parsed = parseInviterInput(value);
    if (!parsed) { setError("Type their username, or paste their invite link."); return; }
    setBusy(true); setError("");
    try {
      const who = parsed.kind === "address" ? parsed.address : await lookupUsername(parsed.username);
      if (who.toLowerCase() === self.toLowerCase()) { setError("That's you. Type the name of the friend who invited you."); return; }
      setResult({ r: await accept(who), who, typed: parsed.kind === "username" ? `@${parsed.username}` : null });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const close = () => { if (!busy) onClose(); };

  return (
    <Sheet title="Who invited you?" onClose={close} dismissible={!busy} zIndex={Z} width={420}>
      {result ? <Outcome result={result.r} name={name} onClose={close} /> : (
        <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
          <p className="text-sm/[150%] text-nav-muted">
            If a friend invited you, add them here so they get credit. Use their GoodDrops username or paste their invite link.
          </p>
          <input
            value={value}
            onChange={(e) => { setValue(e.target.value); if (error) setError(""); }}
            placeholder="@username or invite link"
            autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"
            aria-label="Their username or invite link"
            className="h-14 w-full rounded-full bg-surface px-5 text-base/none text-heading outline-none border border-transparent focus:border-brand"
          />
          {error && <p role="status" className="text-sm/[145%] text-danger -mt-1 px-1">{error}</p>}
          <button type="submit" disabled={busy || !value.trim()}
            className="w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed">
            {busy && <Loader2 className="w-5 h-5 animate-spin" />}
            {busy ? "Confirming…" : "Add my inviter"}
          </button>
          <p className="text-xs/[145%] text-nav-muted text-center -mt-1">You can only add one person, and only while you&apos;re new.</p>
        </form>
      )}
    </Sheet>
  );
}
