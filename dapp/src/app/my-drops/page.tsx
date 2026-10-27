"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Nav } from "@/components/Nav";
import { useMyDrops } from "@/hooks/useMyDrops";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { formatG$ } from "@/lib/utils";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { DROP_STATUS, type Drop } from "@/types";
import { RefreshCw, Undo2, Clock, Target, Gift, Loader2, Map as MapIcon } from "lucide-react";
import { DropCard, ClaimCard, QRShareModal, CARD, PILL } from "./cards";

// ── Page ──────────────────────────────────────────────────────────────────────

// Default reactivation window when a dropper revives an expired drop.
const REACTIVATE_SECONDS = 7 * 24 * 60 * 60; // 7 days
const REACTIVATE_LABEL   = "7 days";

type Tab = "created" | "claimed";
const TABS: { id: Tab; label: string; Icon: typeof Gift }[] = [
  { id: "created", label: "Created", Icon: Gift },
  { id: "claimed", label: "Claimed", Icon: Target },
];

export default function MyDropsPage() {
  const { address } = useAccount();
  const { authenticated, login, ready } = useAuth();
  // Wagmi can reconnect a stale connector from localStorage and report
  // isConnected=true with a leftover address even when the user has signed out —
  // which wrongly surfaced someone else's drops. Gate on the auth state too.
  const isConnected = authenticated && !!address;
  const { drops, loading, fetchDrops } = useMyDrops(isConnected ? address : undefined);
  const { writeContractAsync } = useSponsoredWrite();
  const [tab, setTab] = useState<Tab>("created");
  const [reclaiming, setReclaiming]     = useState<bigint | null>(null);
  const [reactivating, setReactivating] = useState<bigint | null>(null);
  const [bulkBusy, setBulkBusy]         = useState<"reclaim" | "reactivate" | null>(null);
  const [sharingDrop, setSharingDrop]   = useState<Drop | null>(null);
  // The hook starts with loading=false and no drops, so the first paint would
  // show the empty state for a frame. Hold the skeleton until the first fetch settles.
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchDrops().finally(() => { if (alive) setFetched(true); });
    return () => { alive = false; };
  }, [fetchDrops]);

  const myCreated = drops.filter(
    (d) => d.dropper.toLowerCase() === address?.toLowerCase()
  );
  const myClaimed = drops.filter(
    (d) =>
      d.claimer.toLowerCase() === address?.toLowerCase() &&
      d.status === DROP_STATUS.Claimed
  );

  // Expired-but-unclaimed drops the dropper can reclaim or reactivate.
  const nowSec = Math.floor(Date.now() / 1000);
  const expiredDrops = myCreated.filter(
    (d) => d.status === DROP_STATUS.Active && d.expiry < nowSec
  );
  const expiredTotalWei = expiredDrops.reduce((s, d) => s + d.amount, 0n);
  const anyBusy = reclaiming !== null || reactivating !== null || bulkBusy !== null;
  const showSkeleton = loading || !fetched;

  async function handleReclaim(dropId: bigint) {
    setReclaiming(dropId);
    try {
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS,
        abi: GOOD_DROPS_ABI,
        functionName: "reclaimExpired",
        args: [dropId],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      fetchDrops();
    } catch (e) {
      console.error(e);
    } finally {
      setReclaiming(null);
    }
  }

  async function handleReactivate(dropId: bigint) {
    setReactivating(dropId);
    try {
      // uint40 → viem expects a JS number (only >48-bit ints are bigint)
      const newExpiry = Math.floor(Date.now() / 1000) + REACTIVATE_SECONDS;
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS,
        abi: GOOD_DROPS_ABI,
        functionName: "extendExpiry",
        args: [dropId, newExpiry],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      fetchDrops();
    } catch (e) {
      console.error(e);
    } finally {
      setReactivating(null);
    }
  }

  async function handleReclaimAll() {
    if (expiredDrops.length === 0) return;
    setBulkBusy("reclaim");
    try {
      const ids = expiredDrops.map((d) => d.id);
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS,
        abi: GOOD_DROPS_ABI,
        functionName: "reclaimManyExpired",
        args: [ids],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      fetchDrops();
    } catch (e) {
      console.error(e);
    } finally {
      setBulkBusy(null);
    }
  }

  async function handleReactivateAll() {
    if (expiredDrops.length === 0) return;
    setBulkBusy("reactivate");
    try {
      const ids = expiredDrops.map((d) => d.id);
      // uint40 → viem expects a JS number (only >48-bit ints are bigint)
      const newExpiry = Math.floor(Date.now() / 1000) + REACTIVATE_SECONDS;
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS,
        abi: GOOD_DROPS_ABI,
        functionName: "extendManyExpiry",
        args: [ids, newExpiry],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      fetchDrops();
    } catch (e) {
      console.error(e);
    } finally {
      setBulkBusy(null);
    }
  }

  const tabIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <div className="pt-nav">
        <div className="px-4 lg:px-15 pt-10 pb-20">
          {/* ── Page header ─────────────────────────────────────────────── */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 lg:gap-6 mb-6">
            <div className="min-w-0 flex flex-col gap-y-3">
              <h1 className="text-[32px]/none lg:text-4xl/none text-heading">My drops</h1>
              <p className="text-sm/[140%] text-nav-muted">Everything you&apos;ve hidden, and everything you&apos;ve found.</p>
            </div>
            {isConnected && (
              <div className="flex gap-2 lg:gap-4">
                <StatPill value={myCreated.length} label="Created" loading={showSkeleton} />
                <StatPill value={myClaimed.length} label="Claimed" loading={showSkeleton} />
              </div>
            )}
          </div>

          {!ready ? (
            <div className="flex flex-col gap-y-6 max-w-[760px]">
              {[1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-3xl bg-white" />)}
            </div>
          ) : !isConnected ? (
            <div className={`${CARD} p-6 flex flex-col items-center text-center gap-y-4 mx-auto w-full max-w-[400px]`}>
              <span className="w-14 h-14 rounded-full bg-surface flex items-center justify-center text-heading">
                <Gift className="w-6 h-6" strokeWidth={1.75} />
              </span>
              <p className="text-xl/none text-heading">Sign in to see your drops</p>
              <p className="text-sm/[140%] text-nav-muted">Your hidden drops, your finds and your expired G$ live here.</p>
              <button
                type="button"
                onClick={() => login()}
                className="mt-2 h-12 px-6 rounded-full bg-brand text-white text-base/none cursor-pointer
                  motion-safe:transition-colors hover:bg-brand/90"
              >
                Sign in
              </button>
            </div>
          ) : (
            <div className="grid lg:grid-cols-[1fr_380px] gap-6 lg:gap-12 items-start">
              <div className="flex flex-col gap-y-6 min-w-0">
                {/* ── Tabs ─────────────────────────────────────────────── */}
                <div
                  role="tablist"
                  aria-label="My drops"
                  className="relative bg-white rounded-full p-1 flex items-center w-full lg:w-fit shrink-0"
                >
                  <div
                    aria-hidden
                    className="absolute top-1 left-1 h-10 w-[calc(50%-4px)] lg:w-35 rounded-full bg-brand
                      motion-safe:transition-transform motion-safe:duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ transform: `translateX(${tabIndex * 100}%)` }}
                  />
                  {TABS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={tab === id}
                      onClick={() => setTab(id)}
                      className={`relative z-10 h-10 flex-1 lg:flex-none lg:w-35 flex items-center justify-center gap-x-3 rounded-full text-sm/none cursor-pointer
                        motion-safe:transition-colors ${tab === id ? "text-white" : "text-nav-muted hover:text-heading"}`}
                    >
                      <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── Content ──────────────────────────────────────────── */}
                {showSkeleton ? (
                  <div className="flex flex-col gap-y-6">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-3xl bg-white" />)}
                  </div>
                ) : tab === "created" ? (
                  myCreated.length === 0 ? (
                    <EmptyState
                      icon={<Gift className="w-6 h-6" strokeWidth={1.75} />}
                      title="No drops yet"
                      body="Hide some G$ for the world to find — it only takes a minute."
                      cta="Drop G$"
                    />
                  ) : (
                    <div className="flex flex-col gap-y-6">
                      {myCreated.map((d) => (
                        <DropCard
                          key={String(d.id)}
                          drop={d}
                          onReclaim={handleReclaim}
                          onReactivate={handleReactivate}
                          isReclaiming={reclaiming === d.id || bulkBusy === "reclaim"}
                          isReactivating={reactivating === d.id || bulkBusy === "reactivate"}
                          onShare={setSharingDrop}
                        />
                      ))}
                    </div>
                  )
                ) : myClaimed.length === 0 ? (
                  <EmptyState
                    icon={<MapIcon className="w-6 h-6" strokeWidth={1.75} />}
                    title="No finds yet"
                    body="Open the map, walk to a drop and claim it — the G$ is yours."
                    cta="Open the map"
                  />
                ) : (
                  <div className="flex flex-col gap-y-6">
                    {myClaimed.map((d) => (
                      <ClaimCard key={String(d.id)} drop={d} onShare={setSharingDrop} />
                    ))}
                  </div>
                )}
              </div>

              {/* ── Side column: expired G$ ───────────────────────────── */}
              <aside className="flex flex-col gap-y-6 min-w-0 lg:sticky lg:top-[calc(var(--spacing-nav)+40px)]">
                {!showSkeleton && expiredDrops.length > 0 && (
                  <section className={`${CARD} p-6 flex flex-col gap-y-5`}>
                    <div className="flex items-center gap-4">
                      <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-streak-bg text-streak flex items-center justify-center">
                        <Clock className="w-5 h-5" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0 flex flex-col gap-y-2">
                        <p className="text-lg/none text-heading">
                          {expiredDrops.length} expired drop{expiredDrops.length !== 1 ? "s" : ""}
                        </p>
                        <p className="text-sm/none text-nav-muted">Holding {formatG$(expiredTotalWei)} G$</p>
                      </div>
                    </div>
                    <p className="text-sm/[140%] text-nav-muted">
                      Reactivate them for another {REACTIVATE_LABEL}, or reclaim your G$. One transaction handles them all.
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handleReactivateAll}
                        disabled={anyBusy}
                        className="h-12 rounded-full bg-brand text-white text-sm/none cursor-pointer flex items-center justify-center gap-2
                          motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
                      >
                        {bulkBusy === "reactivate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" strokeWidth={1.75} />}
                        {bulkBusy === "reactivate" ? "Reactivating…" : "Reactivate all"}
                      </button>
                      <button type="button" onClick={handleReclaimAll} disabled={anyBusy} className={`${PILL} h-12`}>
                        {bulkBusy === "reclaim" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" strokeWidth={1.75} />}
                        {bulkBusy === "reclaim" ? "Reclaiming…" : "Reclaim all"}
                      </button>
                    </div>
                  </section>
                )}

                <Link
                  href="/"
                  className={`${CARD} group p-2 pr-5 flex items-center gap-4 cursor-pointer motion-safe:transition-colors hover:bg-surface`}
                >
                  <span className="w-14 h-14 shrink-0 rounded-full bg-brand text-white flex items-center justify-center">
                    <MapIcon className="w-6 h-6" strokeWidth={1.75} />
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col gap-y-2">
                    <span className="text-base/none text-heading">Back to the map</span>
                    <span className="text-sm/none text-nav-muted truncate">Drop G$ or hunt what&apos;s nearby.</span>
                  </span>
                </Link>
              </aside>
            </div>
          )}
        </div>
      </div>

      {/* QR share modal */}
      {sharingDrop && (
        <QRShareModal drop={sharingDrop} onClose={() => setSharingDrop(null)} />
      )}
    </div>
  );
}

/** "12 · Created" pill in the header. */
function StatPill({ value, label, loading }: { value: number; label: string; loading: boolean }) {
  return (
    <div className="bg-white rounded-full py-4 px-5 lg:px-6 flex items-center justify-center gap-x-2 lg:gap-x-3 flex-1 lg:flex-none min-w-0">
      {loading ? (
        <Skeleton className="h-4 lg:h-6 w-6 shrink-0" />
      ) : (
        <span className="text-heading text-base/none lg:text-2xl/none shrink-0">{value.toLocaleString("en-US")}</span>
      )}
      <span className="text-sm/none lg:text-base/none text-nav-muted truncate">{label}</span>
    </div>
  );
}

function EmptyState({ icon, title, body, cta }: { icon: React.ReactNode; title: string; body: string; cta: string }) {
  return (
    <div className={`${CARD} p-6 py-10 flex flex-col items-center text-center gap-y-4`}>
      <span className="w-14 h-14 rounded-full bg-surface flex items-center justify-center text-heading">{icon}</span>
      <p className="text-xl/none text-heading">{title}</p>
      <p className="text-sm/[140%] text-nav-muted max-w-[320px]">{body}</p>
      <Link
        href="/"
        className="mt-2 h-12 px-6 rounded-full bg-brand text-white text-base/none inline-flex items-center
          cursor-pointer motion-safe:transition-colors hover:bg-brand/90"
      >
        {cta}
      </Link>
    </div>
  );
}
