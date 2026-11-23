"use client";
import { useEffect } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Check } from "lucide-react";
import {
  AVATAR_BACKGROUNDS, AVATAR_CHARACTERS, AVATAR_TONES, avatarColor, avatarSrc,
  type AvatarChoice,
} from "@/lib/avatars";

/**
 * The avatar picker: a live preview, skin tone and background swatches, and the
 * twelve explorers drawn in the chosen tone and background, so what you tap is
 * exactly what you get. Controlled: the parent owns the choice and decides when
 * to save (onboarding, Edit profile and the global sheet all reuse this).
 */
export function AvatarStudio({
  value, onChange, disabled = false,
}: { value: AvatarChoice; onChange: (next: AvatarChoice) => void; disabled?: boolean }) {
  const set = (patch: Partial<AvatarChoice>) => { if (!disabled) onChange({ ...value, ...patch }); };
  const bg = avatarColor(value.background);

  // Warm the other skin tones of the current character, so switching tone in
  // the preview never waits on the network.
  useEffect(() => {
    for (const t of AVATAR_TONES) { const img = new Image(); img.src = avatarSrc(value.character, t.id); }
  }, [value.character]);

  return (
    <div className={disabled ? "pointer-events-none opacity-70" : ""}>
      {/* ── Live preview ─────────────────────────────────────────────── */}
      <div className="flex justify-center">
        <div
          className="relative w-[136px] h-[136px] rounded-full overflow-hidden motion-safe:transition-colors motion-safe:duration-300"
          style={{ background: bg }}
        >
          <AnimatePresence initial={false}>
            <m.img
              key={`${value.character}-${value.tone}`}
              src={avatarSrc(value.character, value.tone)}
              alt="Your avatar"
              draggable={false}
              initial={{ opacity: 0, scale: 0.94, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 32, opacity: { duration: 0.18 } }}
              className="absolute inset-0 w-full h-full object-cover select-none"
            />
          </AnimatePresence>
        </div>
      </div>

      {/* ── Skin tone + background ───────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-2 gap-4">
        <SwatchGroup label="Skin tone">
          {AVATAR_TONES.map((t) => (
            <Swatch
              key={t.id}
              name={`${t.name} skin`}
              color={t.swatch}
              on={value.tone === t.id}
              onClick={() => set({ tone: t.id })}
            />
          ))}
        </SwatchGroup>
        <SwatchGroup label="Background">
          {AVATAR_BACKGROUNDS.map((b) => (
            <Swatch
              key={b.id}
              name={`${b.name} background`}
              color={b.color}
              on={value.background === b.id}
              onClick={() => set({ background: b.id })}
            />
          ))}
        </SwatchGroup>
      </div>

      {/* ── Characters ───────────────────────────────────────────────── */}
      <p className="mt-6 text-sm/none text-nav-muted">Explorer</p>
      <div role="radiogroup" aria-label="Explorer" className="mt-3 grid grid-cols-4 sm:grid-cols-6 gap-3">
        {AVATAR_CHARACTERS.map((c) => {
          const on = value.character === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.name}
              disabled={disabled}
              onClick={() => set({ character: c.id })}
              className={`relative aspect-square w-full rounded-full cursor-pointer outline-none
                motion-safe:transition-[box-shadow,transform] motion-safe:duration-200
                focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2
                ${on ? "ring-[3px] ring-brand ring-offset-2 ring-offset-white" : "motion-safe:hover:scale-[1.05]"}`}
            >
              <span
                className="absolute inset-0 rounded-full overflow-hidden motion-safe:transition-colors motion-safe:duration-300"
                style={{ background: bg }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarSrc(c.id, value.tone)}
                  alt=""
                  draggable={false}
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover select-none"
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SwatchGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className="rounded-2xl bg-surface p-3.5">
      <p className="text-sm/none text-nav-muted">{label}</p>
      <div className="mt-3 flex items-center justify-between gap-2">{children}</div>
    </div>
  );
}

function Swatch({ name, color, on, onClick }: { name: string; color: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={name}
      title={name}
      onClick={onClick}
      className={`relative w-9 h-9 rounded-full cursor-pointer outline-none grid place-items-center
        motion-safe:transition-transform motion-safe:duration-200 focus-visible:ring-2 focus-visible:ring-brand
        ${on ? "ring-2 ring-heading ring-offset-2 ring-offset-surface" : "motion-safe:hover:scale-110"}`}
      style={{ background: color, boxShadow: "inset 0 0 0 1px rgba(18,22,7,.08)" }}
    >
      {on && <Check className="w-4 h-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,.35)]" strokeWidth={3} />}
    </button>
  );
}
