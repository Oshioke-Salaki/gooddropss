"use client";
import { AdminGate } from "@/components/admin/ui";
import { CompetitionBody } from "@/components/admin/CompetitionBody";

export default function AdminCompetitionPage() {
  return <AdminGate><CompetitionBody /></AdminGate>;
}
