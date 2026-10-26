"use client";
import { AdminGate } from "@/components/admin/ui";
import { SuggestionsBody } from "@/components/admin/SuggestionsBody";

// The cookie gets you into the console; approvals are wallet-signed, so the
// page also needs an admin wallet connected.
export default function AdminSuggestionsPage() {
  return <AdminGate><SuggestionsBody /></AdminGate>;
}
