"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { Loader2, AlertCircle } from "lucide-react";

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
        finish();
      } catch (e) {
        console.error("[auth/callback] connect failed", e);
        setErr(describe(e));
      }
    })();
  }, [isConnected, connectors, connectAsync, router]);

  return (
    <div style={{
      minHeight: "100dvh", background: "#f5f4f0",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <div style={{
        width: "100%", maxWidth: 380, textAlign: "center",
        background: "#fff", border: "2.5px solid #111", borderRadius: 24,
        boxShadow: "6px 6px 0 #111", padding: "34px 26px",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 18 }}>
          <span style={{ fontWeight: 900, fontSize: 18 }}>good</span>
          <span style={{ background: "#111", color: "#BFFD00", padding: "2px 8px", fontSize: 13, fontWeight: 900, borderRadius: 4 }}>drops.</span>
        </div>

        {err ? (
          <>
            <AlertCircle size={40} color="#C81E1E" style={{ margin: "0 auto 12px", display: "block" }} />
            <p style={{ margin: "0 0 18px", fontWeight: 800, fontSize: 15, color: "#C81E1E" }}>{err}</p>
            <button
              onClick={() => router.replace("/")}
              style={{
                width: "100%", padding: "14px",
                background: "#BFFD00", color: "#111",
                border: "2.5px solid #111", borderRadius: 16,
                boxShadow: "4px 4px 0 #111",
                fontWeight: 900, fontSize: 15, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Back to GoodDrops
            </button>
          </>
        ) : (
          <>
            <Loader2 size={40} className="animate-spin" color="#111" style={{ margin: "0 auto 14px", display: "block" }} />
            <p style={{ margin: 0, fontWeight: 900, fontSize: 17 }}>Signing you in…</p>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#5a5a5a" }}>
              Setting up your wallet. This only takes a second.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
