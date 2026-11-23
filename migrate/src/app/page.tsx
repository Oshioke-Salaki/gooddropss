import { MigrateFlow } from "@/components/MigrateFlow";

export default function Page() {
  return (
    <main className="min-h-dvh flex flex-col">
      <MigrateFlow />
      <p className="mx-auto max-w-[400px] px-6 pb-10 text-center text-xs/[150%] text-nav-muted">
        Your old wallet stays yours. This only renews its GoodDollar verification, or connects it
        to your new GoodDrops account and moves your G$ across.
      </p>
    </main>
  );
}
