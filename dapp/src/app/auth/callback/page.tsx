"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { Loader2, AlertCircle } from "lucide-react";
import { Logo } from "@/components/Logo";
import { track } from "@/lib/analytics";

// Google OAuth returns here — a single, fixed URL, because Google matches
// redirect URIs exactly (so we can't bounce back to an arbitrary page).
//
// getRedirectResult REQUIRES a configuration object in @magic-ext/oauth2 v11
// (the version the wagmi connector pins). Its first statement is
// `configuration.optionalQueryString`, so calling it bare throws a synchronous
// TypeError and the OAuth code is never redeemed. The connector's own
// isAuthorized() does exactly that and swallows it — which is why its Google
// support silently does nothing. We redeem the code ourselves, correctly, and
// only hand wagmi a session that already exists.
//
// It also does history.replaceState() to strip the query string, so the search
// params are read-once: capture them before anything else can run.

type MagicSdk = {
  oauth2?: {
    getRedirectResult: (c: { optionalQueryString?: string }) => Promise<unknown>;
  };
  user?: { isLoggedIn: () => Promise<boolean> };
};

// Magic rejects with its own codes here (invalid_grant, unauthorized_client…).
// Keep the code visible: it's the difference between a user saying "it didn't
// work" and us knowing exactly which handshake failed.
function describe(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  return code
    ? `Google sign-in didn't complete (${code}). Please try again.`
    : "Google sign-in didn't complete. Please try again.";
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const [err, setErr] = useState("");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // Grab these synchronously — getRedirectResult wipes the query string.
    const search = window.location.search;
    const dest = sessionStorage.getItem("gd:returnTo") || "/";
    const finish = () => {
      sessionStorage.removeItem("gd:returnTo");
      router.replace(dest);
    };

    (async () => {
      if (isConnected) { finish(); return; }

      const connector = connectors.find((c) => c.id === "magic");
      if (!connector) { setErr("Sign-in isn't available right now."); return; }

      // The connector's own Magic instance (always built with OAuthExtension),
      // so the session it creates is the one wagmi will find.
      const sdk = (connector as unknown as { magic?: MagicSdk }).magic;
      if (!sdk?.oauth2 || !sdk.user) {
        setErr("Sign-in isn't available right now.");
        return;
      }

      // Redeem the Google authorization code → Magic session. Skip if a reload
      // brought us back here with the query string already spent.
      if (!(await sdk.user.isLoggedIn().catch(() => false))) {
        if (!search.includes("state=")) {
          setErr("Google sign-in didn't complete. Please try again.");
          return;
        }
        try {
          await sdk.oauth2.getRedirectResult({ optionalQueryString: search });
        } catch (e) {
          // Magic rejects with its own error codes here (invalid_grant,
          // unauthorized_client…). Show them — swallowing this is what made the
          // last two rounds of this bug impossible to diagnose.
          console.error("[auth/callback] getRedirectResult failed", e);
          if (!(await sdk.user.isLoggedIn().catch(() => false))) {
            setErr(describe(e));
            return;
          }
        }
      }

      try {
        // isAuthorized() short-circuits on isLoggedIn() → connects silently,
        // without falling through to the connector's email modal.
        await connectAsync({ connector });
        track("sign_in_completed", { method: "google" });
        finish();
      } catch (e) {
        console.error("[auth/callback] connect failed", e);
        setErr(describe(e));
      }
    })();
  }, [isConnected, connectors, connectAsync, router]);

  return (
    <div className="min-h-dvh bg-surface font-sans flex items-center justify-center p-5">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-[400px] bg-white rounded-3xl p-6 text-center flex flex-col items-center gap-y-4"
        style={{ boxShadow: "0px 0px 12px 0px #0000000A" }}
      >
        <Logo size="md" />

        {err ? (
          <>
            <span className="w-14 h-14 rounded-full bg-surface text-danger flex items-center justify-center">
              <AlertCircle className="w-7 h-7" strokeWidth={1.75} />
            </span>
            <p className="text-base/[140%] text-heading">{err}</p>
            <button
              type="button"
              onClick={() => router.replace("/")}
              className="mt-2 w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
                motion-safe:transition-colors hover:bg-brand/90"
            >
              Back to GoodDrops
            </button>
          </>
        ) : (
          <>
            <span className="w-14 h-14 rounded-full bg-brand-soft text-brand flex items-center justify-center">
              <Loader2 className="w-7 h-7 animate-spin" strokeWidth={1.75} />
            </span>
            <p className="text-xl/none text-heading">Signing you in…</p>
            <p className="text-sm/[140%] text-nav-muted">
              Setting up your wallet. This only takes a second.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
