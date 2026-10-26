"use client";
import { useState, useEffect } from "react";
import { useSignMessage } from "wagmi";
import { Ban, Check, Flag, Loader2, MapPinOff, MessageSquareWarning, Trash2, TriangleAlert } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { REPORT_REASONS, REPORT_DETAIL_MAX, type ReportReason } from "@/lib/reports";
import { submitReport } from "@/lib/reportClient";

interface Props {
  dropId: string | null;   // null = closed
  onClose: () => void;
}

// One icon per reason. The lib's `icon` field is an emoji for the admin queue;
// the sheet draws its own so the list reads like the rest of the app.
const REASON_ICONS: Record<ReportReason, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  not_there: MapPinOff,
  scam:      TriangleAlert,
  offensive: Ban,
  spam:      Trash2,
  other:     MessageSquareWarning,
};

// Lets a verified hunter flag a bad drop. Server enforces the verified-human
// gate; here we just surface its message if the signer isn't verified.
export function ReportDropSheet({ dropId, onClose }: Props) {
  const { signMessageAsync } = useSignMessage();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState(false);
  const [error, setError]   = useState("");

  useEffect(() => {
    if (dropId) { setReason(null); setDetail(""); setBusy(false); setDone(false); setError(""); }
  }, [dropId]);

  async function submit() {
    if (!dropId || !reason || busy) return;
    setBusy(true); setError("");
    try {
      await submitReport((m) => signMessageAsync({ message: m }), { dropId, reason, detail: detail.trim() || undefined });
      setDone(true);
      setTimeout(onClose, 1300);
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string; message?: string })?.shortMessage
        ?? (e as Error)?.message ?? "";
      setError(/reject|denied|cancel/i.test(m) ? "" : (m || "Couldn't send report. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (!dropId) return null;

  return (
    // Above the claim sheet it opens from.
    <Sheet title="Report this drop" onClose={onClose} dismissible={!busy && !done} zIndex={1500}>
      {done ? (
        <div className="flex flex-col items-center text-center pt-8 pb-2 gap-y-4">
          <span className="success-pop w-14 h-14 rounded-full bg-brand-soft text-brand flex items-center justify-center">
            <Check className="w-7 h-7" strokeWidth={2} />
          </span>
          <p className="text-xl/none text-heading">Report sent</p>
          <p className="text-sm/[140%] text-nav-muted">Thanks. Our team will take a look.</p>
        </div>
      ) : (
        <form className="pt-6 flex flex-col" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <p className="text-sm/[140%] text-nav-muted">What&rsquo;s wrong with it?</p>

          <div role="radiogroup" aria-label="Reason" className="mt-4 flex flex-col gap-2">
            {REPORT_REASONS.map((r) => {
              const active = reason === r.id;
              const Icon = REASON_ICONS[r.id];
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy}
                  onClick={() => { setReason(r.id); setError(""); }}
                  className={`flex items-center gap-3 w-full h-12 px-4 rounded-full border text-left text-sm/none
                    cursor-pointer motion-safe:transition-colors disabled:cursor-wait
                    ${active ? "border-brand bg-brand-soft text-heading" : "border-line bg-white text-heading hover:bg-surface"}`}
                >
                  <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? "text-brand" : "text-nav-muted"}`} strokeWidth={2} />
                  <span className="flex-1 min-w-0 truncate">{r.label}</span>
                  {active && <Check className="w-4 h-4 shrink-0 text-brand" strokeWidth={2} />}
                </button>
              );
            })}
          </div>

          <label className="block mt-4">
            <span className="sr-only">Details (optional)</span>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Add any detail (optional)"
              maxLength={REPORT_DETAIL_MAX}
              rows={2}
              disabled={busy}
              className="w-full rounded-2xl bg-surface px-5 py-4 text-sm/[140%] text-heading placeholder:text-nav-muted
                border border-transparent outline-none resize-none motion-safe:transition-colors focus:border-brand
                disabled:opacity-60"
            />
          </label>

          {/* Fixed-height slot so the button never jumps as the error comes and goes. */}
          <p role="status" aria-live="polite" className="h-4 mt-3 px-5 text-sm/none text-danger truncate">
            {error}
          </p>

          <button
            type="submit"
            disabled={!reason || busy}
            className="mt-3 w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
              flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-brand/90
              disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
          >
            {busy
              ? <><Loader2 className="w-5 h-5 animate-spin" /> Sending…</>
              : <><Flag className="w-[18px] h-[18px]" strokeWidth={2} /> Submit report</>}
          </button>
          <p className="mt-4 text-xs/[140%] text-nav-muted text-center">
            You sign to confirm. Free, no gas. Verified hunters only.
          </p>
        </form>
      )}
    </Sheet>
  );
}
