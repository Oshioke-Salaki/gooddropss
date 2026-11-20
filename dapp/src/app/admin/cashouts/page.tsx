"use client";
import { AdminGate, AdminPage } from "@/components/admin/ui";
import { CashOutsCard } from "@/components/admin/CashOutsCard";

export default function CashOutsPage() {
  return (
    <AdminGate>
      <AdminPage title="Cash outs" subtitle="G$ our users have turned into naira in their own bank accounts, through GoodCash.">
        <CashOutsCard />
      </AdminPage>
    </AdminGate>
  );
}
