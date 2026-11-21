"use client";
import { useState, useEffect, useRef } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { readLinkedRoot } from "@/lib/walletLink";
import { IDENTITY_ADDRESS, IDENTITY_ABI } from "@/lib/identity";

const ZERO = "0x0000000000000000000000000000000000000000";

// One question, one call: is this wallet (or the root it's linked to) a verified
// GoodDollar human right now? getWhitelistedRoot answers exactly that, and it's
// the first thing the claim SDK's status routine checks, without the 6-8 calls
// that follow (entitlement, other chains, claim times) which we never use.
// Every component asking on the same page shares one in-flight answer.
const inflight = new Map<string, { at: number; p: Promise<boolean> }>();
type Reader = { readContract: (args: { address: `0x${string}`; abi: typeof IDENTITY_ABI; functionName: "getWhitelistedRoot"; args: [`0x${string}`] }) => Promise<unknown> };
function readWhitelisted(client: Reader, addr: string, fresh: boolean): Promise<boolean> {
  const k = addr.toLowerCase();
  const hit = inflight.get(k);
  if (!fresh && hit && Date.now() - hit.at < 10_000) return hit.p;
  const p = client
    .readContract({ address: IDENTITY_ADDRESS, abi: IDENTITY_ABI, functionName: "getWhitelistedRoot", args: [addr as `0x${string}`] })
    .then((root) => typeof root === "string" && root.toLowerCase() !== ZERO);
  inflight.set(k, { at: Date.now(), p });
  p.catch(() => { if (inflight.get(k)?.p === p) inflight.delete(k); });
  return p;
}

export type VerificationStatus = "loading" | "verified" | "not_verified" | "error";

const GRACE_PERIOD_MS = 5 * 60 * 1000;

// Last known answers per wallet, kept for the whole visit. Every page mounts
// its own nav, so without these each page change started from "loading" and
// the account area flickered as if signing in again. We show the last answer
// at once and re-check quietly in the background.
const statusCache = new Map<string, VerificationStatus>();
const rootCache = new Map<string, string | null>();

export function useVerification() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  // The GoodDollar SDK is only needed to create the face-scan link, so it's
  // loaded at that moment rather than with every page.

  const key = address?.toLowerCase();
  const keyRef = useRef(key);
  keyRef.current = key;
  const [status, setStatusRaw] = useState<VerificationStatus>(() => (key && statusCache.get(key)) || "loading");
  const setStatus = (s: VerificationStatus) => {
    setStatusRaw(s);
    if (keyRef.current && (s === "verified" || s === "not_verified")) statusCache.set(keyRef.current, s);
  };
  // A different wallet shows its own last answer (or loading), never the previous one's.
  useEffect(() => {
    setStatusRaw((key && statusCache.get(key)) || "loading");
  }, [key]);
  const [fvLink, setFvLink] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [verificationAttemptedAt, setVerificationAttemptedAt] = useState<number | null>(null);
  // A failed link waits for the person to tap Try again. Without this, the
  // effect below re-ran on every failure, re-prompting the wallet in a loop.
  const [linkFailed, setLinkFailed] = useState(false);
  // Network blips are retried a few times before we admit an error, so the
  // status never sits on "loading" forever.
  const blips = useRef(0);
  // A wallet LINKED to another one (e.g. an email account joined to someone's
  // original MetaMask identity) can't face-verify itself: GoodDollar keeps the
  // verification on the original wallet. Renewing has to happen there, so the
  // popup sends them to /switch-to-email instead of a face scan that would fail.
  const [linkedRoot, setLinkedRoot] = useState<string | null>(() => (key && rootCache.get(key)) ?? null);
  useEffect(() => {
    setLinkedRoot((key && rootCache.get(key)) ?? null);
    if (!address || !key) return;
    let cancelled = false;
    readLinkedRoot(address).then((r) => { rootCache.set(key, r); if (!cancelled) setLinkedRoot(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [address, key]);
  const blipTimer = useRef<number | null>(null);

  const isPendingVerification =
    !isVerifying && verificationAttemptedAt !== null && status !== "verified";

  const checkVerification = async (fresh = false) => {
    // Reading needs no wallet signer, so this no longer waits for one.
    if (!address || !publicClient) return;

    try {
      // Only show "loading" when there's no earlier answer for this wallet.
      if (!isVerifying && !isPendingVerification && !(key && statusCache.has(key))) setStatus("loading");

      const whitelisted = await readWhitelisted(publicClient as unknown as Reader, address, fresh);
      if (keyRef.current !== address.toLowerCase()) return; // switched wallets meanwhile

      blips.current = 0;
      if (!whitelisted) {
        setStatus("not_verified");
      } else {
        setStatus("verified");
        setIsVerifying(false);
        setVerificationAttemptedAt(null);
      }
    } catch (error: unknown) {
      // A single read: any failure is a network blip. Retry a few times, backing
      // off, before admitting an error (an earlier answer stays on screen meanwhile).
      blips.current += 1;
      if (blips.current >= 4) {
        blips.current = 0;
        console.error("Verification check failed:", error);
        if (!(key && statusCache.has(key))) setStatus("error");
        return;
      }
      if (blipTimer.current) window.clearTimeout(blipTimer.current);
      blipTimer.current = window.setTimeout(() => { void checkVerification(true); }, 3000 * blips.current);
    }
  };

  const generateLink = async () => {
    if (!address || !publicClient || !walletClient || isGeneratingLink) return;
    try {
      setIsGeneratingLink(true);
      const { makeIdentitySDK } = await import("@/lib/goodSdk");
      const idSDK = makeIdentitySDK(publicClient, walletClient);
      const callbackUrl = window.location.href;
      // Typed as a string, but older SDK builds returned { link } — accept both.
      const linkResult: unknown = await idSDK.generateFVLink(false, callbackUrl, 42220);
      let finalLink = "";
      if (typeof linkResult === "string") finalLink = linkResult;
      else if (linkResult && typeof (linkResult as { link?: unknown }).link === "string") finalLink = (linkResult as { link: string }).link;
      if (finalLink) {
        setFvLink(finalLink);
      } else {
        setLinkFailed(true);
        setStatus("error");
      }
    } catch (e) {
      console.error("Failed to generate FV link:", e);
      setLinkFailed(true);
      setStatus("error");
    } finally {
      setIsGeneratingLink(false);
    }
  };

  // Initial check + re-check when key deps change
  useEffect(() => {
    checkVerification();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, !!publicClient]);

  // Record timestamp when modal opens; a fresh open gets a fresh link attempt.
  useEffect(() => {
    if (isVerifying) setVerificationAttemptedAt(Date.now());
    else setLinkFailed(false);
  }, [isVerifying]);

  useEffect(() => () => { if (blipTimer.current) window.clearTimeout(blipTimer.current); }, []);

  // Generate FV link once when modal opens (and again only when asked to).
  useEffect(() => {
    if (isVerifying && !fvLink && !isGeneratingLink && !linkFailed && !linkedRoot) generateLink();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVerifying, !!fvLink, isGeneratingLink, linkFailed, linkedRoot]);

  /** "Try again": retry whatever failed (the link, or the status check). */
  const refresh = async () => {
    if (linkFailed) { setStatus("loading"); setLinkFailed(false); return; } // the effect regenerates the link
    await checkVerification(true);
  };

  // Polling: while modal is open OR during grace period after close
  useEffect(() => {
    if (status === "verified") return;

    const attemptedAt = verificationAttemptedAt;
    const withinGrace = attemptedAt !== null && Date.now() - attemptedAt < GRACE_PERIOD_MS;

    if (!isVerifying && !withinGrace) return;

    const interval = setInterval(() => {
      if (!isVerifying && attemptedAt !== null && Date.now() - attemptedAt >= GRACE_PERIOD_MS) {
        clearInterval(interval);
        return;
      }
      checkVerification(true); // after a face scan: always ask the chain afresh
    }, 5000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVerifying, verificationAttemptedAt, status, address, !!publicClient]);

  return {
    status,
    isVerified: status === "verified",
    isLoading: status === "loading",
    fvLink,
    isVerifying,
    setIsVerifying,
    isGeneratingLink,
    isPendingVerification,
    refresh,
    /** Set when this wallet borrows its verification from another wallet. */
    linkedRoot,
  };
}
