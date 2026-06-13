/**
 * Lab → tool intent handoff.
 *
 * When the user clicks a "Suggested next step" button on the Labs page,
 * Labs.tsx writes `{ tool: <route>, query: { target, ... }, at }` to
 * `sessionStorage["mhp:labIntent"]` and then calls `onJumpTo(route)`.
 *
 * The destination page reads the intent on mount via `useLabIntent(toolRoute)`.
 * Behavior:
 *
 *   • If there's no matching intent: returns null.
 *   • If the stored intent's `tool` matches: returns the `query` object
 *     and *clears* the storage so subsequent mounts (e.g. navigating
 *     away and back) don't see a stale intent.
 *   • Only fires once per mount — wrapped in `useState(initializer)` so
 *     it doesn't re-trigger on re-renders.
 */
import { useState } from "react";

export type LabIntent = Record<string, string>;

type StoredIntent = {
  tool: string;
  query: LabIntent;
  at: number;
};

const STORAGE_KEY = "mhp:labIntent";
// How long an intent stays consumable. 5 minutes covers slow page loads
// and accidental refreshes; anything older is probably stale state.
const TTL_MS = 5 * 60 * 1000;

/** One-shot read of the lab intent for a given tool route. Returns null
 * if none matches. Clears storage on a successful match. */
export function takeLabIntent(tool: string): LabIntent | null {
  if (typeof sessionStorage === "undefined") return null;
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch { return null; }
  if (!raw) return null;
  let parsed: StoredIntent;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Bad JSON — drop it so we don't keep re-parsing.
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
  if (!parsed || parsed.tool !== tool) return null;
  if (typeof parsed.at === "number" && Date.now() - parsed.at > TTL_MS) {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  return parsed.query ?? {};
}

/** React hook: returns the lab intent for this tool, or null. Only reads
 * once per mount — safe to use as `useState(intent?.target ?? default)`. */
export function useLabIntent(tool: string): LabIntent | null {
  const [intent] = useState<LabIntent | null>(() => takeLabIntent(tool));
  return intent;
}

/** Extract a bare host from `intent.target`, which may be a URL, a
 * bare hostname, or a host:port. Returns null if there's no usable host.
 * Used by pages whose target input is host-only (Fingerprint, SmbEnum). */
export function intentHost(intent: LabIntent | null): string | null {
  const t = intent?.target;
  if (!t) return null;
  try {
    // URL parsing succeeds for "http://host/...", "http://host:port/..." etc.
    return new URL(t).hostname || null;
  } catch { /* not a URL — fall through */ }
  // Bare "host" or "host:port"
  const m = t.match(/^([^:/]+)(?::\d+)?$/);
  return m?.[1] ?? t;
}
