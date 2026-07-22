import type { Landmark, LandmarkCategory } from "@/types";
import {
  cleanLandmarkName, landmarkCreateMessage, landmarkActionMessage, newLandmarkId,
} from "@/lib/landmarks";

type SignFn = (message: string) => Promise<string>;

async function parse(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/**
 * Create a landmark. Signs with the admin wallet. CRITICAL: the name is cleaned
 * BEFORE signing so the client's signed message is byte-identical to what the
 * server rebuilds (it cleans again) — otherwise signature recovery would fail.
 */
export async function createLandmark(
  sign: SignFn,
  data: { name: string; category: LandmarkCategory; lat: number; lng: number; note?: string },
): Promise<Landmark> {
  const id = newLandmarkId();
  const name = cleanLandmarkName(data.name);
  const timestamp = Date.now();
  const signature = await sign(
    landmarkCreateMessage({ id, name, category: data.category, lat: data.lat, lng: data.lng, timestamp }),
  );
  const res = await fetch("/api/landmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id, name, category: data.category, lat: data.lat, lng: data.lng,
      note: data.note, signature, timestamp,
    }),
  });
  const body = await parse(res);
  if (!res.ok) throw new Error((body.error as string) ?? "Could not save landmark");
  return body.landmark as Landmark;
}

export async function updateLandmark(
  sign: SignFn,
  id: string,
  changes: { name?: string; category?: LandmarkCategory; note?: string; status?: "active" | "hidden" },
): Promise<Landmark> {
  const timestamp = Date.now();
  const signature = await sign(landmarkActionMessage("update", id, timestamp));
  const res = await fetch(`/api/landmarks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...changes, signature, timestamp }),
  });
  const body = await parse(res);
  if (!res.ok) throw new Error((body.error as string) ?? "Could not update landmark");
  return body.landmark as Landmark;
}

export async function deleteLandmark(sign: SignFn, id: string): Promise<void> {
  const timestamp = Date.now();
  const signature = await sign(landmarkActionMessage("delete", id, timestamp));
  const res = await fetch(`/api/landmarks/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signature, timestamp }),
  });
  const body = await parse(res);
  if (!res.ok) throw new Error((body.error as string) ?? "Could not delete landmark");
}
