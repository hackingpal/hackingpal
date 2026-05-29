/**
 * ScopeBanner — drop-in scope verdict next to a target input.
 *
 * Calls `/scope/check` with the current target + active engagement id
 * and renders a coloured strip showing whether the target is in scope,
 * out of scope (deny), or external-but-allowed (warn).
 *
 * Usage::
 *
 *   <ScopeBanner target={target} />
 *
 * Or for multi-target inputs::
 *
 *   <ScopeBannerBulk targets={targets.split("\n")} />
 *
 * Designed to be visually small (one row) so it fits inline below an
 * input without redesigning the host page.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import { useActiveEngagementId } from "../lib/engagement";

type Verdict = "allow" | "warn" | "deny";
type CheckResp = {
  target: string;
  engagement_id: string | null;
  verdict: Verdict;
  reason: string;
  layers: { policy: string; scope: string };
};
type BulkResp = {
  engagement_id: string | null;
  count: number;
  deny_count: number;
  warn_count: number;
  results: { target: string; verdict: Verdict; reason: string;
             layers: { policy: string; scope: string } }[];
};

const COLORS: Record<Verdict, string> = {
  allow: "text-phos border-phos/40 bg-phos/5",
  warn:  "text-amber border-amber/40 bg-amber/5",
  deny:  "text-danger border-danger/50 bg-danger/10",
};

const LABELS: Record<Verdict, string> = {
  allow: "IN SCOPE",
  warn:  "EXTERNAL — CONFIRM",
  deny:  "OUT OF SCOPE",
};

export default function ScopeBanner({ target }: { target: string }) {
  const eid = useActiveEngagementId();
  const [resp, setResp] = useState<CheckResp | null>(null);

  useEffect(() => {
    if (!target.trim()) { setResp(null); return; }
    let cancelled = false;
    // Debounce by 300ms — typing in a target box shouldn't fire one
    // request per keystroke.
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ target: target.trim() });
      if (eid) params.set("engagement_id", eid);
      api<CheckResp>(`/scope/check?${params}`)
        .then((r) => { if (!cancelled) setResp(r); })
        .catch(() => { if (!cancelled) setResp(null); });
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [target, eid]);

  if (!target.trim() || !resp) return null;

  return (
    <div className={"flex items-center gap-2 px-2 py-1 rounded border text-[10px] " +
      COLORS[resp.verdict]}>
      <span className="font-bold tracking-wider">{LABELS[resp.verdict]}</span>
      <span className="text-ink-muted truncate">{resp.reason}</span>
      {!eid && (
        <span className="ml-auto text-ink-dim italic">lab mode</span>
      )}
    </div>
  );
}


export function ScopeBannerBulk({ targets }: { targets: string[] }) {
  const eid = useActiveEngagementId();
  const [resp, setResp] = useState<BulkResp | null>(null);

  // Stable string key so the effect doesn't refetch when the same list
  // re-renders with a different array identity.
  const cleaned = targets.map((t) => t.trim()).filter(Boolean);
  const key = cleaned.join("\n");

  useEffect(() => {
    if (cleaned.length === 0) { setResp(null); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const r = await api<BulkResp>("/scope/check-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets: cleaned, engagement_id: eid }),
        });
        if (!cancelled) setResp(r);
      } catch {
        if (!cancelled) setResp(null);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, eid]);

  if (cleaned.length === 0 || !resp) return null;

  const allow = resp.count - resp.deny_count - resp.warn_count;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-ink-muted tracking-wider">SCOPE</span>
        <span className={"px-1.5 rounded border " + COLORS.allow}>
          {allow} allow
        </span>
        {resp.warn_count > 0 && (
          <span className={"px-1.5 rounded border " + COLORS.warn}>
            {resp.warn_count} warn
          </span>
        )}
        {resp.deny_count > 0 && (
          <span className={"px-1.5 rounded border " + COLORS.deny}>
            {resp.deny_count} deny
          </span>
        )}
        {!eid && <span className="ml-auto text-ink-dim italic">lab mode</span>}
      </div>
      {(resp.deny_count > 0 || resp.warn_count > 0) && (
        <div className="text-[10px] text-ink-dim space-y-0.5 max-h-24 overflow-y-auto">
          {resp.results
            .filter((r) => r.verdict !== "allow")
            .slice(0, 10)
            .map((r) => (
              <div key={r.target} className="flex gap-2">
                <span className={"px-1 rounded border " + COLORS[r.verdict]}>
                  {r.verdict}
                </span>
                <span className="font-mono">{r.target}</span>
                <span>— {r.reason}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
