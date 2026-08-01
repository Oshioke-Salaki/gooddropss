"use client";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Drop, LatLng } from "@/types";

// Shown inside ClaimSheet for a merchant TASK drop. The hunter does the task,
// taps "I did it" to mint a one-time QR, shows it to the merchant, and once the
// merchant approves (polled) the parent unlocks the normal claim.
type Step = "intro" | "minting" | "showing" | "approved" | "error";

export function TaskUnlock({
  drop, userLocation, address, onApproved,
}: { drop: Drop; userLocation: LatLng | null; address: string; onApproved: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [task, setTask] = useState<string | null>(null);
  const [nonce, setNonce] = useState("");
  const [err, setErr] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch the task text up front so the hunter knows what to do.
  useEffect(() => {
    let alive = true;
    fetch(`/api/task/info?dropId=${drop.id.toString()}`)
      .then((r) => r.json())
      .then((d) => { if (alive && d?.task) setTask(d.task); })
      .catch(() => {});
    return () => { alive = false; if (pollRef.current) clearInterval(pollRef.current); };
  }, [drop.id]);

  async function iDidIt() {
    if (!userLocation) { setErr("Turn on location so the merchant knows you're here."); setStep("error"); return; }
    setStep("minting"); setErr("");
    try {
      const res = await fetch("/api/task/qr", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropId: drop.id.toString(), address, lat: userLocation.lat, lng: userLocation.lng }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Couldn't create your code — try again."); setStep("error"); return; }
      setNonce(d.nonce); if (d.task) setTask(d.task); setStep("showing");
      startPolling();
    } catch { setErr("Network error — try again."); setStep("error"); }
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/task/status?dropId=${drop.id.toString()}&address=${address}`);
        const d = await r.json();
        if (d.approved) {
          if (pollRef.current) clearInterval(pollRef.current);
          setStep("approved");
          setTimeout(onApproved, 900);
        }
      } catch { /* keep polling */ }
    }, 3000);
  }

  return (
    <div style={{ border: "2px solid #111", borderRadius: 16, padding: 16, background: "#fff", fontFamily: "inherit" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 20 }}>🎁</span>
        <p style={{ margin: 0, fontWeight: 900, fontSize: 15 }}>Merchant reward</p>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#555", lineHeight: 1.5 }}>
        {task ? <>Do this to unlock: <b style={{ color: "#111" }}>{task}</b></> : "Complete the merchant's task to unlock this reward."}
      </p>

      {step === "intro" && (
        <button onClick={iDidIt}
          style={{ width: "100%", padding: 14, background: "#BFFD00", color: "#111", border: "2px solid #111", borderRadius: 12, boxShadow: "2px 2px 0 #111", fontWeight: 900, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
          I did it — show my code
        </button>
      )}

      {step === "minting" && <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#888" }}>Creating your code…</p>}

      {step === "showing" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "inline-block", background: "#fff", border: "2.5px solid #111", borderRadius: 14, padding: 14, boxShadow: "3px 3px 0 #111" }}>
            <QRCodeSVG value={nonce} size={172} level="M" />
          </div>
          <p style={{ margin: "12px 0 2px", fontWeight: 800, fontSize: 14 }}>Show this to the merchant to approve</p>
          <p style={{ margin: 0, fontSize: 12, color: "#888" }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: "#4ade80", marginRight: 6 }} />
            Waiting for approval… (code expires in ~2 min)
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#bbb", fontFamily: "monospace" }}>{nonce.slice(0, 8)}…</p>
        </div>
      )}

      {step === "approved" && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={{ fontSize: 34 }}>✅</div>
          <p style={{ margin: "6px 0 0", fontWeight: 900, fontSize: 16 }}>Approved — claiming your reward…</p>
        </div>
      )}

      {step === "error" && (
        <>
          <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#FF3B3B" }}>{err}</p>
          <button onClick={iDidIt}
            style={{ width: "100%", padding: 12, background: "#111", color: "#BFFD00", border: "none", borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}
