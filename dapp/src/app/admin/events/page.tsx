"use client";
import { EventsBody } from "@/components/admin/EventsBody";

// Review is cookie-authenticated (like Businesses), so no admin wallet is needed.
export default function AdminEventsPage() {
  return <EventsBody />;
}
