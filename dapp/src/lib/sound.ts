// Tiny sounds for big moments, made with Web Audio (no files to download).
//
// Phones only let a page play sound after the person has touched it, and iOS
// also needs the audio engine started inside a touch. `primeAudio()` does that
// once, on the first tap anywhere; every claim involves several taps, so the
// chime is ready by the time a chest opens. If sound isn't allowed or
// supported, everything here silently does nothing.

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let primed = false;

function audio(): Ctx | null {
  if (ctx) return ctx;
  const AC = typeof window !== "undefined"
    ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    : undefined;
  if (!AC) return null;
  try { ctx = new AC(); } catch { ctx = null; }
  return ctx;
}

/** Unlock audio on the first tap anywhere. Safe to call many times. */
export function primeAudio(): void {
  if (primed || typeof window === "undefined") return;
  primed = true;
  const unlock = () => {
    const c = audio();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

/** One bell-like note: a quick attack and a soft exponential tail. */
function note(c: Ctx, freq: number, at: number, length: number, volume: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** The coin chime: two quick rising notes (E6, then B6). Quiet; never throws. */
export function playCoinChime(): void {
  try {
    const c = audio();
    if (!c || c.state !== "running" || document.hidden) return;
    const t = c.currentTime + 0.01;
    note(c, 1318.5, t, 0.18, 0.09);
    note(c, 1975.5, t + 0.085, 0.32, 0.07);
  } catch { /* sound is a nicety */ }
}

/** A short buzz on phones that support it (ignored elsewhere). */
export function buzz(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
