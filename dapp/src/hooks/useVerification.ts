"use client";
import { useState, useEffect, useMemo } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { IdentitySDK, useIdentitySDK } from "@goodsdks/identity-sdk";
import { ClaimSDK } from "@goodsdks/citizen-sdk";

export type VerificationStatus = "loading" | "verified" | "not_verified" | "error";

const GRACE_PERIOD_MS = 5 * 60 * 1000;

export function useVerification() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const identitySDKFromHook = useIdentitySDK("production");

  // Build SDK manually if the hook returns null (e.g. before wagmi syncs)
  const identitySDK = useMemo(() => {
    if (identitySDKFromHook) return identitySDKFromHook;
    if (!publicClient || !walletClient) return null;
    return new (IdentitySDK as any)(publicClient, walletClient, "production");
  }, [identitySDKFromHook, publicClient, walletClient]);

  const [status, setStatus] = useState<VerificationStatus>("loading");
  const [fvLink, setFvLink] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [verificationAttemptedAt, setVerificationAttemptedAt] = useState<number | null>(null);

  const isPendingVerification =
    !isVerifying && verificationAttemptedAt !== null && status !== "verified";

  const checkVerification = async () => {
    if (!address || !publicClient || !identitySDK || !walletClient?.account?.address) return;

    try {
      if (!isVerifying && !isPendingVerification) setStatus("loading");

      const claimSDK = new ClaimSDK({
        account: address,
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        identitySDK: identitySDK as any,
        env: "production",
      });

      const walletStatus = await claimSDK.getWalletClaimStatus();

      if (walletStatus.status === "not_whitelisted") {
        setStatus("not_verified");
      } else {
        setStatus("verified");
        setIsVerifying(false);
        setVerificationAttemptedAt(null);
      }
    } catch (error: any) {
      const msg: string = error?.message ?? String(error);
      // GoodDollar SDK queries both Celo and Fuse — Fuse RPC failures are transient
      if (
        msg.includes("fuse-rpc") ||
        msg.includes("pokt.network") ||
        msg.includes("ERR_NAME_NOT_RESOLVED") ||
        msg.includes("network")
      ) {
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
      const idSDK = new (IdentitySDK as any)(publicClient, walletClient, "production");
      const callbackUrl = window.location.origin + window.location.pathname;
      const linkResult = await idSDK.generateFVLink(false, callbackUrl, 42220);
      let finalLink = "";
      if (typeof linkResult === "string") finalLink = linkResult;
      else if (linkResult && (linkResult as any).link) finalLink = (linkResult as any).link;
      if (finalLink) {
        setFvLink(finalLink);
      } else {
        setStatus("error");
      }
    } catch (e) {
      console.error("Failed to generate FV link:", e);
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

  // Record timestamp when modal opens
  useEffect(() => {
    if (isVerifying) setVerificationAttemptedAt(Date.now());
  }, [isVerifying]);

  // Generate FV link once when modal opens
  useEffect(() => {
    if (isVerifying && !fvLink && !isGeneratingLink) generateLink();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVerifying, !!fvLink, isGeneratingLink]);

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
    refresh: checkVerification,
  };
}
