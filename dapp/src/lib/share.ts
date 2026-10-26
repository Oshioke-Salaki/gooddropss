// One way to share a link, used everywhere the app has a Share button.
//
// Why this exists: desktop browsers (Brave especially) expose navigator.share
// but refuse the call, and every Share button caught that error silently — the
// click just did nothing. Now:
//   • phones / touch devices → the native share sheet
//   • desktop, or the share sheet failing for any reason → copy the link
//   • the person cancelling the share sheet → nothing (that was their choice)

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export interface ShareData { title?: string; text?: string; url: string; files?: File[] }

/** Touch-first devices get the native sheet; desktop gets a copied link. */
export function prefersNativeShare(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  // Older in-app browsers (some wallet browsers) lack the async clipboard API.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

export async function shareOrCopy(data: ShareData): Promise<ShareOutcome> {
  if (prefersNativeShare()) {
    const payload = data.files && navigator.canShare?.({ files: data.files }) ? data : { ...data, files: undefined };
    try {
      await navigator.share(payload);
      return "shared";
    } catch (e) {
      if ((e as { name?: string } | null)?.name === "AbortError") return "cancelled";
      // Anything else (NotAllowedError, unsupported data): fall back to copying.
    }
  }
  const text = data.text ? `${data.text} ${data.url}` : data.url;
  return (await copyText(text)) ? "copied" : "failed";
}
