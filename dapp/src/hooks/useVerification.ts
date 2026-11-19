"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useIdentitySDK } from "@goodsdks/identity-sdk";
import { makeClaimSDK, makeIdentitySDK } from "@/lib/goodSdk";
import { readLinkedRoot } from "@/lib/walletLink";

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
  const identitySDKFromHook = useIdentitySDK("production");

  // Build SDK manually if the hook returns null (e.g. before wagmi syncs)
  const identitySDK = useMemo(() => {
    if (identitySDKFromHook) return identitySDKFromHook;
    if (!publicClient || !walletClient) return null;
    return makeIdentitySDK(publicClient, walletClient);
  }, [identitySDKFromHook, publicClient, walletClient]);

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

  const checkVerification = async () => {
    if (!address || !publicClient || !identitySDK || !walletClient?.account?.address) return;

    try {
      // Only show "loading" when there's no earlier answer for this wallet.
      if (!isVerifying && !isPendingVerification && !(key && statusCache.has(key))) setStatus("loading");

      const claimSDK = makeClaimSDK({ account: address, publicClient, walletClient, identitySDK });

      const walletStatus = await claimSDK.getWalletClaimStatus();

      blips.current = 0;
      if (walletStatus.status === "not_whitelisted") {
        setStatus("not_verified");
      } else {
        setStatus("verified");
        setIsVerifying(false);
        setVerificationAttemptedAt(null);
      }
    } catch (error: unknown) {
      const msg: string = (error as { message?: string } | null)?.message ?? String(error);
      // GoodDollar SDK queries both Celo and Fuse — Fuse RPC failures are transient
      if (
        msg.includes("fuse-rpc") ||
        msg.includes("pokt.network") ||
        msg.includes("ERR_NAME_NOT_RESOLVED") ||
        msg.includes("network")
      ) {
        blips.current += 1;
        if (blips.current >= 4) { blips.current = 0; setStatus("error"); return; }
        if (blipTimer.current) window.clearTimeout(blipTimer.current);
        blipTimer.current = window.setTimeout(() => { void checkVerification(); }, 3000 * blips.current);
        return;
      }
      console.error("Verification check failed:", error);
      setStatus("error");
    }
  };

  const generateLink = async () => {
    if (!address || !publicClient || !walletClient || !identitySDK || isGeneratingLink) return;
    try {
      setIsGeneratingLink(true);
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
  }, [address, !!publicClient, !!identitySDK, !!walletClient?.account?.address]);

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
    await checkVerification();
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
      checkVerification();
    }, 5000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVerifying, verificationAttemptedAt, status, address, !!publicClient, !!identitySDK, !!walletClient?.account?.address]);

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
