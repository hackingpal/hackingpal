// Tasteful wrappers around Dopamine (`@dopaminefx/effects`) so the rest of the
// app fires effects without thinking about moods or intensities. This is a
// security toolkit, not a confetti app — defaults skew restrained.
//
// Loaded lazily on first call so the WebGL setup doesn't ship in the initial
// render bundle.
//
// Respects prefers-reduced-motion: every helper becomes a no-op when the user
// has reduced motion on.

const PREFERS_REDUCED = typeof window !== "undefined"
  && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let modPromise: Promise<typeof import("@dopaminefx/effects")> | null = null;

async function load() {
  if (PREFERS_REDUCED) return null;
  if (!modPromise) modPromise = import("@dopaminefx/effects");
  return modPromise;
}

type Origin = { x: number; y: number };

/** Light electric-violet pulse — used on scan completion + run button start. */
export async function pulse(origin?: Origin | Element) {
  const m = await load();
  if (!m) return;
  try {
    await m.celebrate({
      mood: "electric",
      intensity: 0.45,
      whimsy: 0.3,
      origin: toOrigin(origin),
    } as any);
  } catch { /* never let effects break the app */ }
}

/** Stronger electric-violet success — for big wins (engagement created, etc.). */
export async function celebrateBig(origin?: Origin | Element) {
  const m = await load();
  if (!m) return;
  try {
    await m.celebrate({
      mood: "celebratory",
      intensity: 0.75,
      whimsy: 0.55,
      origin: toOrigin(origin),
    } as any);
  } catch { /* ignore */ }
}

/** Calligraphic ink stroke — for authorization-confirmed checkbox toggle. */
export async function inkConfirm(origin?: Origin | Element) {
  const m = await load();
  if (!m) return;
  try {
    await m.celebrateInk({
      mood: "serene",
      intensity: 0.5,
      whimsy: 0.25,
      origin: toOrigin(origin),
    } as any);
  } catch { /* ignore */ }
}

/** Error stamp — for critical findings or failed handshakes. Use sparingly. */
export async function failStamp(origin?: Origin | Element) {
  const m = await load();
  if (!m) return;
  try {
    await m.fail({
      intensity: 0.6,
      whimsy: 0.2,
      origin: toOrigin(origin),
    } as any);
  } catch { /* ignore */ }
}

function toOrigin(o?: Origin | Element): Origin | undefined {
  if (!o) return undefined;
  if (o instanceof Element) {
    const r = o.getBoundingClientRect();
    return {
      x: (r.left + r.width / 2) / window.innerWidth,
      y: (r.top + r.height / 2) / window.innerHeight,
    };
  }
  return o;
}
