"use client";
import { AdminGate } from "@/components/admin/ui";
import { PlacesBody } from "@/components/admin/PlacesBody";

// The cookie gets you into the console; writes here are wallet-signed, so the
// page also needs an admin wallet connected.
export default function AdminPlacesPage() {
  return <AdminGate><PlacesBody /></AdminGate>;
}
