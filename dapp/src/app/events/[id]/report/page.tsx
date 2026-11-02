import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isEventId } from "@/lib/events";
import ReportClient from "./ReportClient";

export const metadata: Metadata = { title: "Event report", robots: { index: false } };

export default async function EventReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isEventId(id)) notFound();
  return <ReportClient id={id} />;
}
