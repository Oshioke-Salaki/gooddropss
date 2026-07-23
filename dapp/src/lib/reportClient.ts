import { reportMessage, type ReportReason } from "@/lib/reports";

type SignFn = (message: string) => Promise<string>;

// Submit a drop report. Signs with the hunter's wallet; the server re-checks the
// signature and that the signer is a verified human.
export async function submitReport(
  sign: SignFn,
  data: { dropId: string; reason: ReportReason; detail?: string },
): Promise<void> {
  const timestamp = Date.now();
  const signature = await sign(reportMessage(data.dropId, data.reason, timestamp));
  const res = await fetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dropId: data.dropId, reason: data.reason, detail: data.detail,
      signature, timestamp,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Could not submit report");
}
