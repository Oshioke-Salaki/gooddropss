import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { fetchHunterProfile } from "@/lib/subgraph";
import { getUsername } from "@/lib/serverProfile";
import { UserHandle } from "@/components/UserHandle";
import { formatG$, shortAddr, getDropRarity, RARITY } from "@/lib/utils";
import { DROP_STATUS, type Drop } from "@/types";
import { ArrowLeft, Target, Coins, Zap, Star, Crown, Shield, Award } from "lucide-react";

interface PageProps { params: Promise<{ address: string }> }

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { address } = await params;
  const username = await getUsername(address);
  const name = username ? `@${username}` : shortAddr(address);
  const canonical = `/hunter/${address.toLowerCase()}`;
  return {
    title: `${name} — Hunter`,
    description: `See ${name}'s GoodDrops stats, achievements and claim history — real G$ found in the wild.`,
    alternates: { canonical },
    openGraph: {
      title: `${name} — GoodDrops Hunter`,
      description: `${name}'s GoodDrops stats, achievements and claim history.`,
      url: canonical,
      type: "profile",
    },
  };
}

// ── Achievements ──────────────────────────────────────────────────────────────

interface Achievement {
  id: string;
  name: string;
  desc: string;
  Icon: React.ElementType;
  color: string;
  earned: boolean;
}

function computeAchievements(created: Drop[], claimed: Drop[]): Achievement[] {
  const fastClaim = claimed.some(
    (d) => d.claimedAt > 0 && (d.claimedAt - d.expiry + 30 * 24 * 3600) < 300
  );
  const whale     = created.some((d) => Number(d.amount) / 1e18 >= 200);
  const legendary = claimed.some((d) => getDropRarity(d.amount) === "legendary");

  return [
    {
      id: "first_hunt", name: "First Hunt",   desc: "Claimed your first drop",
      Icon: Target,  color: "#00CFFF", earned: claimed.length > 0,
    },
    {
      id: "first_drop", name: "Drop Maker",  desc: "Created your first drop",
      Icon: Coins,   color: "#BFFD00", earned: created.length > 0,
    },
    {
      id: "speed",      name: "Speed Demon", desc: "Claimed within 5 minutes of creation",
      Icon: Zap,     color: "#FFD700", earned: fastClaim,
    },
    {
      id: "whale",      name: "Whale",       desc: "Dropped 200+ G$ in one go",
      Icon: Star,    color: "#FF6B6B", earned: whale,
    },
    {
      id: "legendary",  name: "Legend",      desc: "Claimed a Legendary drop",
      Icon: Crown,   color: "#FFD700", earned: legendary,
    },
    {
      id: "collector",  name: "Collector",   desc: "Claimed 5 or more drops",
      Icon: Shield,  color: "#BFFD00", earned: claimed.length >= 5,
    },
    {
      id: "pioneer",    name: "Pioneer",     desc: "Created 10+ drops",
      Icon: Award,   color: "#00CFFF", earned: created.length >= 10,
    },
  ];
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function avatarColor(address: string): string {
  const hash = address.slice(2, 8);
  const n = parseInt(hash, 16);
  const hue = n % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? "#BFFD0014" : "#0e0f1a",
      border: `1.5px solid ${accent ? "#BFFD0033" : "#1e1e2e"}`,
      borderRadius: 16, padding: "16px 20px", textAlign: "center",
    }}>
      <p style={{ margin: 0, fontSize: 26, fontWeight: 900, color: accent ? "#BFFD00" : "#fff" }}>{value}</p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#444", fontWeight: 600 }}>{label}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function HunterPage({ params }: PageProps) {
  const { address } = await params;
  const profile = await fetchHunterProfile(address);
  if (!profile) notFound();

  const { dropsCreated, dropsClaimed } = profile;
  const totalDropped = dropsCreated.reduce((s, d) => s + d.amount, 0n);
  const totalClaimed = dropsClaimed.reduce((s, d) => s + d.amount, 0n);
  const achievements = computeAchievements(dropsCreated, dropsClaimed);
  const earned       = achievements.filter((a) => a.earned);
  const locked       = achievements.filter((a) => !a.earned);

  return (
    <div style={{
      minHeight: "100dvh",
      background: "#08090f",
      color: "#fff",
      fontFamily: "'Space Grotesk', sans-serif",
      paddingBottom: 40,
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 12,
        borderBottom: "1px solid #1e1e2e",
        position: "sticky", top: 0,
        background: "#0a0b12", zIndex: 10,
      }}>
        <Link href="/leaderboard" style={{
          background: "#1a1a2e", border: "1px solid #333", borderRadius: 10,
          width: 38, height: 38, display: "flex", alignItems: "center",
          justifyContent: "center", color: "#888", textDecoration: "none",
        }}>
          <ArrowLeft size={18} />
        </Link>
        <span style={{ color: "#555", fontSize: 14, fontWeight: 600 }}>Hunter Profile</span>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px" }}>

        {/* Avatar + address */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "36px 0 28px", gap: 12,
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: "50%",
            background: avatarColor(address),
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 32, fontWeight: 900, color: "#111",
            boxShadow: `0 0 32px ${avatarColor(address)}60`,
          }}>
            {address.slice(2, 4).toUpperCase()}
          </div>
          <div style={{ textAlign: "center" }}>
            <UserHandle address={address} style={{ display: "block", fontWeight: 900, fontSize: 20 }} />
            <p style={{ margin: "4px 0 0", color: "#444", fontSize: 12, fontFamily: "monospace" }}>
              {address.toLowerCase()}
            </p>
          </div>
          {earned.length > 0 && (
            <div style={{
              background: "#BFFD0014", border: "1px solid #BFFD0033",
              borderRadius: 100, padding: "4px 14px",
              fontSize: 12, fontWeight: 700, color: "#BFFD00",
            }}>
              {earned.length} / {achievements.length} achievements
            </div>
          )}
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 28 }}>
          <Stat label="Drops Created" value={String(dropsCreated.length)} />
          <Stat label="Drops Claimed" value={String(dropsClaimed.length)} />
          <Stat label="G$ Dropped"  value={formatG$(totalDropped)} accent />
          <Stat label="G$ Claimed"  value={formatG$(totalClaimed)} accent />
        </div>

        {/* Achievements */}
        <Section title="Achievements">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {earned.map(({ id, name, desc, Icon, color }) => (
              <div key={id} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#0e0f1a", border: `1.5px solid ${color}33`,
                borderRadius: 12, padding: "10px 14px",
                flex: "1 1 calc(50% - 5px)", minWidth: 130,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: `${color}20`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon size={16} color={color} />
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: "#fff" }}>{name}</p>
                  <p style={{ margin: 0, fontSize: 10, color: "#444", lineHeight: 1.3 }}>{desc}</p>
                </div>
              </div>
            ))}
            {locked.map(({ id, name, Icon }) => (
              <div key={id} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#080910", border: "1.5px solid #151520",
                borderRadius: 12, padding: "10px 14px",
                flex: "1 1 calc(50% - 5px)", minWidth: 130,
                opacity: 0.4,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: "#1a1a2e",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon size={16} color="#333" />
                </div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#333" }}>{name}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Recent claims */}
        {dropsClaimed.length > 0 && (
          <Section title="Recent Claims">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {dropsClaimed.slice(0, 5).map((d) => {
                const r = RARITY[getDropRarity(d.amount)];
                return (
                  <div key={String(d.id)} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    background: "#0e0f1a", border: "1px solid #1e1e2e",
                    borderRadius: 14, padding: "12px 14px",
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: `${r.color}20`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Target size={18} color={r.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
                        {formatG$(d.amount)} G$
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "#444" }}>
                        Drop #{String(d.id)} · {r.label}
                      </p>
                    </div>
                    {d.claimedAt > 0 && (
                      <p style={{ margin: 0, fontSize: 11, color: "#333" }}>
                        {new Date(d.claimedAt * 1000).toLocaleDateString("en", { month: "short", day: "numeric" })}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <p style={{
        margin: "0 0 12px", fontSize: 11, fontWeight: 800,
        color: "#444", letterSpacing: "0.1em", textTransform: "uppercase",
      }}>
        {title}
      </p>
      {children}
    </div>
  );
}
