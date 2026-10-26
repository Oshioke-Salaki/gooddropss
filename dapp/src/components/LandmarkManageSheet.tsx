"use client";
import { useState, useEffect } from "react";
import { useSignMessage } from "wagmi";
import { Loader2, Trash2, EyeOff, Eye } from "lucide-react";
import {
  cleanLandmarkName, LANDMARK_NAME_MIN, LANDMARK_NAME_MAX, LANDMARK_NOTE_MAX,
} from "@/lib/landmarks";
import { updateLandmark, deleteLandmark } from "@/lib/landmarkClient";
import { Sheet } from "@/components/ui/Sheet";
import { CategoryChips, CategoryIcon, FIELD } from "@/components/LandmarkCreator";
import type { Landmark, LandmarkCategory } from "@/types";

function errMsg(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage
    ?? (e as Error)?.message ?? "";
  return /reject|denied|cancel/i.test(m) ? "" : (m || "Something went wrong.");
}

interface Props {
  landmark: Landmark | null;   // the tapped place; null = closed
  onClose: () => void;
  onChanged: () => void;       // saved / hidden / deleted → refresh the map
}

// Admin: tap a place on the map → edit its name/category/note, hide it, or delete
// it, right where you see it. Signature-based (free, no gas), server re-verifies
// the admin.
export function LandmarkManageSheet({ landmark, onClose, onChanged }: Props) {
  const { signMessageAsync } = useSignMessage();
  const sign = (m: string) => signMessageAsync({ message: m });

  const [name, setName]         = useState("");
  const [category, setCategory] = useState<LandmarkCategory>("landmark");
  const [note, setNote]         = useState("");
  const [busy, setBusy]         = useState<"" | "save" | "hide" | "delete">("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError]       = useState("");

  // Re-seed the form whenever a different place is opened.
  useEffect(() => {
    if (landmark) {
      setName(landmark.name);
      setCategory(landmark.category);
      setNote(landmark.note ?? "");
      setConfirmDel(false);
      setError("");
    }
  }, [landmark]);

  const cleanName = cleanLandmarkName(name);
  const nameOk = cleanName.length >= LANDMARK_NAME_MIN && cleanName.length <= LANDMARK_NAME_MAX;
  const dirty = !!landmark && (
    cleanName !== landmark.name ||
    category !== landmark.category ||
    (note.trim() || "") !== (landmark.note ?? "")
  );
  const anyBusy = busy !== "";

  async function save() {
    if (!landmark || !nameOk || anyBusy) return;
    setBusy("save"); setError("");
    try {
      await updateLandmark(sign, landmark.id, { name: cleanName, category, note: note.trim() });
      window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
      onChanged();
      onClose();
    } catch (e) { const m = errMsg(e); if (m) setError(m); }
    finally { setBusy(""); }
  }

  async function toggleHide() {
    if (!landmark || anyBusy) return;
    setBusy("hide"); setError("");
    try {
      await updateLandmark(sign, landmark.id, { status: landmark.status === "active" ? "hidden" : "active" });
      window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
      onChanged();
      onClose();
    } catch (e) { const m = errMsg(e); if (m) setError(m); }
    finally { setBusy(""); }
  }

  async function remove() {
    if (!landmark || anyBusy) return;
    setBusy("delete"); setError("");
    try {
      await deleteLandmark(sign, landmark.id);
      window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
      onChanged();
      onClose();
    } catch (e) { const m = errMsg(e); if (m) setError(m); }
    finally { setBusy(""); }
  }

  if (!landmark) return null;

  const hidden = landmark.status === "hidden";
  const canSave = nameOk && dirty && !anyBusy;

  return (
    <Sheet title="Edit place" onClose={onClose} dismissible={!anyBusy} zIndex={3000}>
      <form className="flex flex-col" onSubmit={(e) => { e.preventDefault(); if (canSave) save(); }}>
        {/* Where it is, and whether hunters can currently see it. */}
        <div className="mt-3 flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-full bg-brand-soft text-brand flex items-center justify-center">
            <CategoryIcon category={landmark.category} className="w-4 h-4" />
          </span>
          <span className="text-sm/none text-nav-muted truncate">
            {landmark.lat.toFixed(5)}, {landmark.lng.toFixed(5)}
          </span>
          {hidden && (
            <span className="shrink-0 flex items-center gap-1 rounded-full bg-surface px-2.5 py-1.5 text-xs/none text-nav-muted">
              <EyeOff className="w-3 h-3" strokeWidth={2} /> Hidden
            </span>
          )}
        </div>

        <label className="block mt-5">
          <span className="sr-only">Place name</span>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setError(""); }}
            placeholder="Place name"
            maxLength={LANDMARK_NAME_MAX + 8}
            disabled={anyBusy}
            className={`${FIELD} h-14 text-base/none`}
          />
        </label>

        <div className="mt-3">
          <CategoryChips value={category} onChange={setCategory} disabled={anyBusy} />
        </div>

        <label className="block mt-3">
          <span className="sr-only">Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g. main gate)"
            maxLength={LANDMARK_NOTE_MAX}
            disabled={anyBusy}
            className={`${FIELD} h-12 text-sm/none`}
          />
        </label>

        <p role="status" aria-live="polite" className="min-h-4 mt-3 px-5 text-sm/[130%] text-danger">
          {error}
        </p>

        <button
          type="submit"
          disabled={!canSave}
          className="mt-3 w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2
            cursor-pointer motion-safe:transition-colors hover:bg-brand/90
            disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
        >
          {busy === "save"
            ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing…</>
            : "Save changes"}
        </button>

        {/* Secondary: hide/show + delete (two-tap confirm) */}
        <div className="flex gap-2.5 mt-3">
          <button
            type="button"
            onClick={toggleHide}
            disabled={anyBusy}
            className="flex-1 h-11 rounded-full border border-line bg-white text-sm/none text-heading
              flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-surface
              disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "hide"
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : hidden
                ? <><Eye className="w-4 h-4" strokeWidth={2} /> Show on map</>
                : <><EyeOff className="w-4 h-4" strokeWidth={2} /> Hide</>}
          </button>
          {confirmDel ? (
            <button
              type="button"
              onClick={remove}
              disabled={anyBusy}
              className="flex-1 h-11 rounded-full bg-danger text-white text-sm/none
                flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-opacity hover:opacity-90
                disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "delete"
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <><Trash2 className="w-4 h-4" strokeWidth={2} /> Confirm delete</>}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setConfirmDel(true); setError(""); }}
              disabled={anyBusy}
              className="flex-1 h-11 rounded-full border border-danger/30 bg-white text-sm/none text-danger
                flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-danger/5
                disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="w-4 h-4" strokeWidth={2} /> Delete
            </button>
          )}
        </div>

        <p className="mt-4 text-xs/[140%] text-nav-muted text-center">
          You sign to confirm — free, no gas.
        </p>
      </form>
    </Sheet>
  );
}
