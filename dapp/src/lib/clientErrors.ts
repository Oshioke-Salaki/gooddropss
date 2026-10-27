"use client";

// Lightweight client error reporting. Sends a compact, de-duplicated summary to
// /api/client-error, which logs it so it shows up in `vercel logs --level error`.
// Deliberately tiny: no third-party SDK, no PII (addresses, emails and tokens
// are scrubbed before anything leaves the browser).

const SENT = new Set<string>();
const MAX_PER_PAGE = 8;
let sentCount = 0;

// Errors we can't act on: browser quirks, wallet extensions, the user saying no.
const NOISE = [
  /ResizeObserver loop/i,
  /AbortError|aborted|The user aborted/i,
  /user rejected|user denied|rejected the request|cancel(l)?ed/i,
  /chrome-extension:|moz-extension:|safari-extension:/i,
  /MetaMask|inpage\.js|evmAsk|tronlink|phantom/i,
  /Non-Error promise rejection captured/i,
  // Plain network drops only; "Failed to fetch dynamically imported module"
  // means a stale build, which we do want to hear about.
  /^(TypeError: )?(Load failed|Failed to fetch)$|NetworkError/i,
];

function scrub(s: string): string {
  return s
    .replace(/0x[a-fA-F0-9]{40,}/g, "0x…")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>")
    .replace(/(token|key|secret|signature|auth)=[^&\s"]+/gi, "$1=<redacted>")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<jwt>");
}

export function reportClientError(err: unknown, source: string) {
  if (typeof window === "undefined") return;
  try {
    const e = err as { message?: string; stack?: string; digest?: string } | undefined;
    const message = scrub(String(e?.message ?? err ?? "Unknown error")).slice(0, 300);
    const stack = scrub(String(e?.stack ?? "")).split("\n").slice(0, 6).join("\n").slice(0, 900);
    if (!message || NOISE.some((r) => r.test(message) || r.test(stack))) return;

    const sig = `${source}|${message}|${stack.split("\n")[1] ?? ""}`;
    if (SENT.has(sig) || sentCount >= MAX_PER_PAGE) return;
    SENT.add(sig);
    sentCount++;

    const body = JSON.stringify({
      source,
      message,
      stack,
      digest: e?.digest ?? null,
      path: window.location.pathname,
      ua: navigator.userAgent.slice(0, 200),
      build: (window as unknown as { __NEXT_DATA__?: { buildId?: string } }).__NEXT_DATA__?.buildId ?? null,
    });
    // sendBeacon survives page unloads; fall back to a keepalive fetch.
    const sent = navigator.sendBeacon?.("/api/client-error", new Blob([body], { type: "application/json" }));
    if (!sent) {
      fetch("/api/client-error", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true })
        .catch(() => {});
    }
  } catch { /* reporting must never throw */ }
}

let installed = false;

/** Install the global listeners once. Safe to call from an effect. */
export function installClientErrorReporter() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => {
    // Resource load errors (img/script 404s) have no `error`; skip them.
    if (!ev.error) return;
    reportClientError(ev.error, "window.error");
  });
  window.addEventListener("unhandledrejection", (ev) => reportClientError(ev.reason, "unhandledrejection"));
}
