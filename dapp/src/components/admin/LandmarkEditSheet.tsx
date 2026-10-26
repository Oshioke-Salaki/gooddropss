"use client";
import { useState } from "react";
import { useSignMessage } from "wagmi";
import { Sheet } from "@/components/ui/Sheet";
import { updateLandmark } from "@/lib/landmarkClient";
import {
  LANDMARK_CATEGORIES, cleanLandmarkName, LANDMARK_NAME_MIN, LANDMARK_NAME_MAX, LANDMARK_NOTE_MAX,
} from "@/lib/landmarks";
import type { Landmark, LandmarkCategory } from "@/types";
import { Button, ChoiceChip, Hint, Input, landmarkIcon } from "./ui";

export function landmarkErr(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage
    ?? (e as Error)?.message ?? "";
  return /reject|denied|cancel/i.test(m) ? "" : (m || "Something went wrong.");
}

/**
 * Edit a landmark's name / category / note. Shared by Places (live map) and
 * Suggestions (pending queue) — saving never touches `status`, so a suggestion
 * stays in the queue until the admin explicitly approves it.
 */
export function LandmarkEditSheet({
  landmark, title, subtitle, onClose, onSaved,
}: { landmark: Landmark; title: string; subtitle?: string; onClose: () => void; onSaved: () => void }) {
  const { signMessageAsync } = useSignMessage();
  const [name, setName]         = useState(landmark.name);
  const [category, setCategory] = useState<LandmarkCategory>(landmark.category);
  const [note, setNote]         = useState(landmark.note ?? "");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  const cleanName = cleanLandmarkName(name);
  const nameOk = cleanName.length >= LANDMARK_NAME_MIN && cleanName.length <= LANDMARK_NAME_MAX;

  async function save() {
    if (!nameOk || saving) return;
    setSaving(true); setError("");
    try {
      await updateLandmark(
        (m) => signMessageAsync({ message: m }),
        landmark.id,
        { name: cleanName, category, note: note.trim() },
      );
      onSaved();
    } catch (e) { const m = landmarkErr(e); if (m) setError(m); }
    finally { setSaving(false); }
  }

  return (
    <Sheet title={title} onClose={onClose} dismissible={!saving} width={480}>
      {subtitle && <p className="text-sm/[140%] text-nav-muted mt-3">{subtitle}</p>}
      <form className="mt-6 flex flex-col" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Input
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          maxLength={LANDMARK_NAME_MAX + 8}
          placeholder="Place name"
          aria-label="Place name"
          disabled={saving}
          className="h-14! text-base/none!"
        />

        <div className="no-scrollbar flex gap-2 overflow-x-auto -mx-6 px-6 mt-4 pb-1">
          {LANDMARK_CATEGORIES.map((c) => {
            const Icon = landmarkIcon(c.id);
            return (
              <ChoiceChip key={c.id} on={category === c.id} onClick={() => setCategory(c.id)} disabled={saving} className="shrink-0">
                <Icon className="w-4 h-4" strokeWidth={2} /> {c.label}
              </ChoiceChip>
            );
          })}
        </div>

        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={LANDMARK_NOTE_MAX}
          placeholder="Optional note"
          aria-label="Note"
          disabled={saving}
          className="mt-4"
        />

        <Hint text={error} tone="bad" className="mt-3 px-5" />

        <div className="flex gap-3 mt-3">
          <Button type="button" onClick={onClose} disabled={saving} className="h-14!">Cancel</Button>
          <Button type="submit" variant="primary" busy={saving} disabled={!nameOk} className="flex-1 h-14! text-base/none!">
            {saving ? "Signing…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
