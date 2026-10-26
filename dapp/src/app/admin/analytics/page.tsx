"use client";
import { AdminGate } from "@/components/admin/ui";
import { AnalyticsBody } from "@/components/admin/AnalyticsBody";

export default function AnalyticsPage() {
  return <AdminGate><AnalyticsBody /></AdminGate>;
}
