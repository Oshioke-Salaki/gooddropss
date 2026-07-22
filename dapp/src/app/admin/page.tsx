"use client";
import { useState, useEffect } from "react";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { parseUnits, maxUint256 } from "viem";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, G_TOKEN_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { degToGps, formatG$ } from "@/lib/utils";
import { isAdminAddress } from "@/lib/admins";

const AMOUNT      = parseUnits("10", 18);
const EXPIRY_S    = 7 * 24 * 60 * 60;
const STORAGE_KEY = "gd_admin_seed_v3"; // bump version so old sessions don't conflict

// ── Types ──────────────────────────────────────────────────────────────────────

interface DropCoord {
  lat: number;
  lng: number;
  hint: string;
  cityLabel: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function jitteredRing(
  cx: number, cy: number,
  r: number, n: number,
  baseAngle: number, angleOffset: number,
  hint: string, cityLabel: string,
): DropCoord[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n + baseAngle + angleOffset;
    const jit = 1 + (Math.random() - 0.5) * 0.35;
    return { lat: cx + r * jit * Math.cos(a), lng: cy + r * jit * 1.35 * Math.sin(a), hint, cityLabel };
  });
}

function nudgedCenter(cx: number, cy: number, r: number, hint: string, cityLabel: string): DropCoord {
  return {
    lat: cx + (Math.random() - 0.5) * r * 0.4,
    lng: cy + (Math.random() - 0.5) * r * 0.4,
    hint, cityLabel,
  };
}

// ── Nairobi — 20 drops (1+4+6+4+5) ────────────────────────────────────────────

function generateNairobiDrops(): DropCoord[] {
  const cx = -1.2921, cy = 36.8219;
  const hint = "Find it in Nairobi, Kenya 🌿";
  const label = "🌿 Nairobi";
  const base = Math.random() * 2 * Math.PI;
  const r = 0.009;
  return [
    nudgedCenter(cx, cy, r, hint, label),
    ...jitteredRing(cx, cy, r,       4, base, 0,              hint, label),
    ...jitteredRing(cx, cy, r * 2,   6, base, Math.PI / 4,    hint, label),
    ...jitteredRing(cx, cy, r * 3.5, 4, base, Math.PI / 6,    hint, label),
    ...jitteredRing(cx, cy, r * 5,   5, base, Math.PI / 9,    hint, label),
  ]; // 1+4+6+4+5 = 20
}

// ── Southern Kaduna — 30 drops across 3 neighbourhoods (10 each) ───────────────
// Each neighbourhood: 1 centre + 3 inner + 3 mid + 3 outer = 10

function neighbourhoodDrops(
  cx: number, cy: number,
  hint: string, cityLabel: string,
): DropCoord[] {
  const base = Math.random() * 2 * Math.PI;
  const r = 0.0025; // ~275 m — tight urban radius to stay within each neighbourhood
  return [
    nudgedCenter(cx, cy, r, hint, cityLabel),
    ...jitteredRing(cx, cy, r,       3, base, 0,           hint, cityLabel),
    ...jitteredRing(cx, cy, r * 2,   3, base, Math.PI / 3, hint, cityLabel),
    ...jitteredRing(cx, cy, r * 3.2, 3, base, Math.PI / 6, hint, cityLabel),
  ]; // 1+3+3+3 = 10
}

function generateKadunaDrops(): DropCoord[] {
  return [
    // Barnawa — dense residential south of Kaduna town
    ...neighbourhoodDrops(10.4835, 7.4175, "Hidden in Barnawa, Kaduna 🌍",            "🌍 Barnawa"),
    // Narayi High Cost — upscale estate, around Narayi–Kakuri axis
    ...neighbourhoodDrops(10.4762, 7.4325, "Hidden in Narayi High Cost, Kaduna 🌍",   "🌍 Narayi High Cost"),
    // NAFDAC Road / Kakuri axis — around the NAFDAC office corridor
    ...neighbourhoodDrops(10.4698, 7.4495, "Hidden near NAFDAC Road, Kaduna 🌍",      "🌍 NAFDAC Road"),
  ]; // 10+10+10 = 30
}

// ── Full drop list ─────────────────────────────────────────────────────────────

function generateAllDrops(): DropCoord[] {
  return [
    ...generateNairobiDrops(),  // 20
    ...generateKadunaDrops(),   // 30
  ]; // 50 total
}

// ── Persistence ────────────────────────────────────────────────────────────────

interface Session {
  completed: number;
  startedAt: number;
  drops: DropCoord[];
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s: Session = JSON.parse(raw);
    if (!s.drops?.length || s.completed >= s.drops.length) { clearSession(); return null; }
    return s;
  } catch { return null; }
}

function saveSession(s: Session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── City display config ────────────────────────────────────────────────────────

const DISPLAY_CITIES = [
  { label: "🌿 Nairobi",         count: 20, offset: 0  },
  { label: "🌍 Barnawa",         count: 10, offset: 20 },
  { label: "🌍 Narayi High Cost",count: 10, offset: 30 },
  { label: "🌍 NAFDAC Road",     count: 10, offset: 40 },
];

const TOTAL_DROPS = 50;

// ── Component ──────────────────────────────────────────────────────────────────

type Phase = "idle" | "approving" | "dropping" | "done";

export default function AdminPage() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const isAdmin = isAdminAddress(address);

  // ── Owner: max drop limit ───────────────────────────────────────────────────
  const { data: maxDropWei, refetch: refetchMax } = useReadContract({
    address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "maxDropAmount",
  });
  const [newMax, setNewMax]         = useState("10000");
  const [limitPhase, setLimitPhase] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [limitErr, setLimitErr]     = useState("");
  async function updateMaxDrop() {
    const n = parseFloat(newMax);
    if (isNaN(n) || n <= 0) { setLimitErr("Enter a valid amount."); setLimitPhase("error"); return; }
    setLimitPhase("saving"); setLimitErr("");
    try {
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI,
        functionName: "setMaxDropAmount", args: [parseUnits(newMax.trim(), 18)],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refetchMax();
      setLimitPhase("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setLimitErr(err.shortMessage ?? err.message ?? "Failed — are you the contract owner?");
      setLimitPhase("error");
    }
  }

  const [session, setSession] = useState<Session | null>(null);
  const [phase,   setPhase]   = useState<Phase>("idle");
  const [done,    setDone]    = useState(0);
  const [failed,  setFailed]  = useState(0);
  const [current, setCurrent] = useState("");
  const [log,     setLog]     = useState<{ msg: string; ok: boolean }[]>([]);

  useEffect(() => {
    // Remove sessions from old storage key versions so they never auto-load
    localStorage.removeItem("gd_admin_seed_v1");
    localStorage.removeItem("gd_admin_seed_v2");
    setSession(loadSession());
  }, []);

  function addLog(msg: string, ok = true) {
    setLog(prev => [{ msg, ok }, ...prev].slice(0, 100));
  }

  async function run(drops: DropCoord[], startFrom: number, startedAt: number) {
    if (!address || !isAdmin) return;

    let completedSoFar = startFrom;
    setDone(startFrom);
    setFailed(0);
    setLog([]);
    if (startFrom > 0) addLog(`↩ Resuming from drop ${startFrom + 1} / ${drops.length}`);

    try {
      // ── Approve ────────────────────────────────────────────────────────────
      setPhase("approving");
      setCurrent("Checking G$ allowance…");
      const allowance = await publicClient.readContract({
        address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
        args: [address, GOOD_DROPS_ADDRESS],
      }) as bigint;

      if (allowance < AMOUNT * BigInt(drops.length - startFrom)) {
        setCurrent("Approving G$ spend (sign once)…");
        const tx = await writeContractAsync({
          address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve",
          args: [GOOD_DROPS_ADDRESS, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        addLog("✓ G$ approved");
      } else {
        addLog("✓ Allowance OK");
      }

      // ── Create drops ───────────────────────────────────────────────────────
      setPhase("dropping");
      const expiry = Math.floor(Date.now() / 1000) + EXPIRY_S;
      let failCount = 0;

      for (let i = startFrom; i < drops.length; i++) {
        const { lat, lng, hint, cityLabel } = drops[i];
        setCurrent(`[${i + 1}/${drops.length}] ${cityLabel}`);
        try {
          const tx = await writeContractAsync({
            address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createDrop",
            args: [degToGps(lat), degToGps(lng), AMOUNT as unknown as bigint, expiry, hint],
          });
          await publicClient.waitForTransactionReceipt({ hash: tx });
          completedSoFar++;
          setDone(completedSoFar);
          const updated: Session = { completed: completedSoFar, startedAt, drops };
          saveSession(updated);
          setSession(updated);
          addLog(`✓ Drop ${i + 1} — ${cityLabel}`);
        } catch (e: unknown) {
          const err = e as { shortMessage?: string; message?: string };
          failCount++;
          setFailed(failCount);
          addLog(`✗ Drop ${i + 1} failed: ${err.shortMessage ?? err.message ?? "unknown"}`, false);
        }
      }

      setPhase("done");
      setCurrent("");
      clearSession();
      setSession(null);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      addLog(`✗ Interrupted: ${err.shortMessage ?? err.message ?? "unknown"}`, false);
      const saved: Session = { completed: completedSoFar, startedAt, drops };
      saveSession(saved);
      setSession(saved);
      setPhase("idle");
      setCurrent("");
    }
  }

  function startFresh() {
    clearSession();
    const drops     = generateAllDrops();
    const startedAt = Date.now();
    const s: Session = { completed: 0, startedAt, drops };
    saveSession(s);
    setSession(s);
    run(drops, 0, startedAt);
  }

  function resume() {
    if (!session) return;
    run(session.drops, session.completed, session.startedAt);
  }

  // ── Not admin ──────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div style={{
        minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#111", fontFamily: "'Space Grotesk', sans-serif",
      }}>
        <p style={{ color: "#444", fontWeight: 700, fontSize: 16 }}>
          {address ? "Not authorised." : "Connect your wallet."}
        </p>
      </div>
    );
  }

  const total     = session?.drops.length ?? TOTAL_DROPS;
  const pct       = Math.round((done / total) * 100);
  const busy      = phase === "approving" || phase === "dropping";
  const hasResume = !!session && session.completed > 0 && phase === "idle";

  return (
    <div style={{
      minHeight: "100dvh", background: "#111",
      fontFamily: "'Space Grotesk', sans-serif",
      padding: "48px 20px",
    }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>

        {/* Header */}
        <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 800, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em" }}>
          Admin
        </p>
        <h1 style={{ margin: "0 0 8px", fontSize: 36, fontWeight: 900, color: "#BFFD00", letterSpacing: "-0.03em" }}>
          Nairobi + Kaduna Drop
        </h1>
        <p style={{ margin: "0 0 32px", fontSize: 13, color: "#555" }}>
          20 drops across Nairobi · 30 drops across southern Kaduna (Barnawa, Narayi High Cost, NAFDAC Road).
          Fresh random coordinates each run.
        </p>

        {/* Max drop limit (owner) */}
        <div style={{
          background: "#181818", border: "2px solid #333",
          borderRadius: 14, padding: "16px 18px", marginBottom: 20,
        }}>
          <p style={{ margin: "0 0 4px", fontWeight: 900, fontSize: 15, color: "#fff" }}>Max drop limit</p>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "#888" }}>
            Current: <b style={{ color: "#BFFD00" }}>{maxDropWei !== undefined ? `${formatG$(maxDropWei as bigint)} G$` : "…"}</b> per drop.
            Owner only — the drop form reflects this automatically.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number" min="1" value={newMax}
              onChange={(e) => { setNewMax(e.target.value); setLimitPhase("idle"); }}
              style={{
                flex: 1, padding: "11px 12px", background: "#111",
                border: "2px solid #333", borderRadius: 10, color: "#fff",
                fontWeight: 800, fontSize: 15, outline: "none", fontFamily: "inherit",
              }}
            />
            <button
              onClick={updateMaxDrop}
              disabled={limitPhase === "saving"}
              style={{
                padding: "11px 16px", background: "#BFFD00", color: "#111",
                border: "2px solid #BFFD00", borderRadius: 10, fontWeight: 900,
                fontSize: 14, cursor: limitPhase === "saving" ? "wait" : "pointer",
                fontFamily: "inherit", whiteSpace: "nowrap",
              }}
            >
              {limitPhase === "saving" ? "Setting…" : "Set max G$"}
            </button>
          </div>
          {limitPhase === "done" && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#BFFD00", fontWeight: 700 }}>
              ✓ Updated — the drop form now allows up to {formatG$((maxDropWei ?? 0n) as bigint)} G$.
            </p>
          )}
          {limitPhase === "error" && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#FF6B6B", fontWeight: 700 }}>{limitErr}</p>
          )}
        </div>

        {/* Resume banner */}
        {hasResume && (
          <div style={{
            background: "#1a2410", border: "2px solid #BFFD0060",
            borderRadius: 14, padding: "16px 18px", marginBottom: 20,
          }}>
            <p style={{ margin: "0 0 4px", fontWeight: 900, fontSize: 15, color: "#BFFD00" }}>
              ↩ Interrupted session found
            </p>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "#888" }}>
              {session!.completed} of {session!.drops.length} drops created before interruption.
              Resume picks up at drop #{session!.completed + 1} with the same coordinates — no duplicates.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={resume}
                style={{
                  flex: 1, padding: "12px",
                  background: "#BFFD00", color: "#111",
                  border: "2px solid #BFFD00", borderRadius: 10,
                  fontWeight: 900, fontSize: 14,
                  cursor: "pointer", fontFamily: "inherit",
                  boxShadow: "3px 3px 0 #BFFD0040",
                }}
              >
                Resume from #{session!.completed + 1}
              </button>
              <button
                onClick={startFresh}
                style={{
                  padding: "12px 16px",
                  background: "transparent", color: "#555",
                  border: "1.5px solid #333", borderRadius: 10,
                  fontWeight: 700, fontSize: 13,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                New locations
              </button>
            </div>
          </div>
        )}

        {/* Area cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          {DISPLAY_CITIES.map(({ label, count, offset }) => {
            const areaDone = Math.min(Math.max(done - offset, 0), count);
            const complete = areaDone === count;
            return (
              <div key={label} style={{
                background: complete ? "#1a2410" : "#1a1a1a",
                border: `1.5px solid ${complete ? "#BFFD0040" : "#2a2a2a"}`,
                borderRadius: 12, padding: "13px 15px",
              }}>
                <p style={{ margin: "0 0 3px", fontWeight: 800, fontSize: 13, color: complete ? "#BFFD00" : "#fff" }}>
                  {complete ? "✓ " : ""}{label}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: "#555" }}>
                  {busy || phase === "done"
                    ? `${areaDone}/${count} drops`
                    : `${count} drops · ${count * 10} G$`}
                </p>
              </div>
            );
          })}
        </div>

        {/* Totals */}
        <div style={{
          background: "#1a1a1a", border: "1.5px solid #2a2a2a",
          borderRadius: 12, padding: "14px 16px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 24,
        }}>
          <div>
            <p style={{ margin: "0 0 2px", fontWeight: 900, fontSize: 18, color: "#fff" }}>50 drops</p>
            <p style={{ margin: 0, fontSize: 12, color: "#555" }}>7-day expiry · 10 G$ each</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: "0 0 2px", fontWeight: 900, fontSize: 18, color: "#BFFD00" }}>500 G$</p>
            <p style={{ margin: 0, fontSize: 12, color: "#555" }}>total required</p>
          </div>
        </div>

        {/* Progress */}
        {(busy || phase === "done") && (
          <div style={{
            background: "#1a1a1a", border: "1.5px solid #2a2a2a",
            borderRadius: 12, padding: "16px", marginBottom: 16,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>
                {phase === "approving" ? "Approving…" : phase === "done" ? "Complete" : `${done} / ${total} drops`}
              </span>
              <span style={{ fontSize: 14, fontWeight: 900, color: "#BFFD00" }}>{pct}%</span>
            </div>
            <div style={{ height: 8, background: "#333", borderRadius: 100, overflow: "hidden", marginBottom: 10 }}>
              <div style={{
                height: "100%", borderRadius: 100,
                background: phase === "done" ? "#BFFD00" : "#BFFD0099",
                width: `${pct}%`, transition: "width 0.4s ease",
              }} />
            </div>
            {current && (
              <p style={{ margin: "0 0 6px", fontSize: 11, color: "#555", fontFamily: "monospace" }}>→ {current}</p>
            )}
            <div style={{ display: "flex", gap: 16 }}>
              <span style={{ fontSize: 11, color: "#BFFD00", fontWeight: 700 }}>✓ {done} created</span>
              {failed > 0 && <span style={{ fontSize: 11, color: "#FF3B3B", fontWeight: 700 }}>✗ {failed} failed</span>}
            </div>
          </div>
        )}

        {/* CTA */}
        {!hasResume && (
          <button
            onClick={startFresh}
            disabled={busy}
            style={{
              width: "100%", padding: "19px",
              background: phase === "done" ? "#1a2e1a" : busy ? "#1a1a1a" : "#BFFD00",
              color: phase === "done" ? "#BFFD00" : busy ? "#444" : "#111",
              border: "2px solid",
              borderColor: phase === "done" ? "#BFFD0040" : busy ? "#333" : "#BFFD00",
              borderRadius: 14,
              boxShadow: busy || phase === "done" ? "none" : "4px 4px 0 #BFFD0040",
              fontWeight: 900, fontSize: 17,
              cursor: busy ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
              marginBottom: 20,
            }}
          >
            {phase === "done"
              ? `✓ Done — ${done} drops live`
              : phase === "approving"
              ? "Approving G$…"
              : phase === "dropping"
              ? `Dropping… ${done}/${total}`
              : "🌍 Drop Nairobi + Kaduna"}
          </button>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div style={{
            background: "#0d0d0d", border: "1px solid #1f1f1f",
            borderRadius: 10, padding: "12px 14px",
            maxHeight: 240, overflowY: "auto",
          }}>
            {log.map((l, i) => (
              <p key={i} style={{
                margin: "0 0 3px", fontSize: 11, fontFamily: "monospace",
                color: l.ok ? (l.msg.startsWith("✓") ? "#BFFD00" : "#555") : "#FF3B3B",
              }}>
                {l.msg}
              </p>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
