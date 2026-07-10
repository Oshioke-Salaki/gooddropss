import { MigrateFlow } from "@/components/MigrateFlow";

export default function Page() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 18px 60px",
        gap: 28,
      }}
    >
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 900, fontSize: 20, color: "#111" }}>good</span>
        <span style={{ background: "#111", color: "#BFFD00", padding: "3px 9px", fontSize: 15, fontWeight: 900, borderRadius: 4 }}>
          drops.
        </span>
      </div>

      <MigrateFlow />

      <p style={{ fontSize: 12, color: "#999", textAlign: "center", maxWidth: 380, lineHeight: 1.5 }}>
        Your identity is linked on-chain via GoodDollar. Your old wallet stays yours — this only
        connects it to your new one and moves your G$ across.
      </p>
    </main>
  );
}
