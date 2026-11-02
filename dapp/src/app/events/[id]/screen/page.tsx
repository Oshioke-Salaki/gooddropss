import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isEventId } from "@/lib/events";
import ScreenClient from "./ScreenClient";

export const metadata: Metadata = { title: "Live screen", robots: { index: false } };

export default async function EventScreenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isEventId(id)) notFound();
  return <ScreenClient id={id} />;
}
