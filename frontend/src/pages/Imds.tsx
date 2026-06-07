import { useState } from "react";
import RequestForm, { initialRequestState, requestToInit, type RequestState }
  from "../components/webattack/RequestForm";
import { useAttackWS } from "../components/webattack/useAttackWS";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";
import ResultGroup from "../components/ResultGroup";

type Cloud = "aws" | "azure" | "gcp";

type ImdsEvent =
  | { type: "started"; clouds: Cloud[]; total: number }
  | { type: "probe"; cloud: Cloud; path: string; status: number | null;
      elapsed_ms: number; hit: string | null; evidence: string }
  | { type: "done"; elapsed: number; clouds_hit: Cloud[]; stopped: boolean }
  | { type: "error"; detail: string };

type Probe = ImdsEvent & { type: "probe" };

const CLOUD_LABEL: Record<Cloud, string> = {
  aws: "AWS", azure: "Azure", gcp: "GCP",
};

export default function Imds() {
  const [req, setReq] = useState<RequestState>(initialRequestState);
  const [clouds, setClouds] = useState<Set<Cloud>>(new Set(["aws", "azure", "gcp"]));
  const [probes, setProbes] = useState<Probe[]>([]);
  const [doneText, setDoneText] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const { status, error, start, stop } = useAttackWS<ImdsEvent>(
    "/ws/imds",
    (ev) => {
      if (ev.type === "started") {
        setProbes([]);
        setDoneText("");
        setStartedAt(Date.now());
      } else if (ev.type === "probe") {
        setProbes((p) => [...p, ev]);
      } else if (ev.type === "done") {
        setDoneText(
          `done in ${ev.elapsed}s · clouds reachable: ${
            ev.clouds_hit.length ? ev.clouds_hit.join(", ") : "none"
          }${ev.stopped ? " (stopped)" : ""}`
        );
      }
    },
    "/imds/scan",
  );

  const running = status === "connecting" || status === "running";

  function toggle(c: Cloud) {
    setClouds((s) => {
      const next = new Set(s);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }

  // Group probes by cloud for display
  const byCloud: Record<Cloud, Probe[]> = { aws: [], azure: [], gcp: [] };
  for (const p of probes) byCloud[p.cloud].push(p);

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <header>
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">IMDS TESTER</h2>
        <p className="text-[11px] text-ink-dim">
          Cloud-metadata diagnostic. Probes AWS / Azure / GCP IMDS endpoints
          through the target URL (place <code className="text-amber">FUZZ</code> where
          the SSRF sink reads its target). Use this to confirm what's reachable
          from a vulnerable host without going through the full SSRF page.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3">
        <RequestForm state={req} setState={setReq} running={running} />

        <div className="border-t border-divider pt-3">
          <div className="text-[11px] text-ink-muted tracking-wider mb-1">CLOUDS TO PROBE</div>
          <div className="flex gap-2 text-[12px]">
            {(["aws", "azure", "gcp"] as Cloud[]).map((c) => (
              <label key={c} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={clouds.has(c)}
                       disabled={running} onChange={() => toggle(c)} />
                <span className="text-ink-primary">{CLOUD_LABEL[c]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-2 items-center">
          {!running ? (
            <button onClick={() => start({
              ...requestToInit(req), clouds: [...clouds],
            })} disabled={!req.url.trim() || !req.confirmAuth || clouds.size === 0}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              Start IMDS Probe
            </button>
          ) : (
            <button onClick={stop}
                    className="px-3 py-1.5 rounded bg-bg-base border border-danger text-danger text-[12px]">
              Stop
            </button>
          )}
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
          {doneText && <span className="text-[11px] text-ink-dim">{doneText}</span>}
        </div>
      </div>

      {/* Per-cloud grouped results */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {probes.length === 0 && !running && (
          <EmptyState
            icon="☁︎"
            title="Cloud metadata probe"
            description="Probes AWS, Azure & GCP IMDS endpoints through a target URL (FUZZ marker). Use to confirm SSRF reachability."
            hint={<>Tip: drop <code className="text-amber">FUZZ</code> where the SSRF sink reads its target URL.</>}
          />
        )}
        {(["aws", "azure", "gcp"] as Cloud[]).map((c) => {
          if (!clouds.has(c) || byCloud[c].length === 0) return null;
          const anyHit = byCloud[c].some((p) => p.hit);
          const sev = anyHit ? "critical" : "info";
          return (
            <ResultGroup
              key={c}
              title={`${CLOUD_LABEL[c]} ${anyHit ? "✓ reachable" : ""}`}
              count={byCloud[c].length}
              severity={sev}
            >
              <div className="divide-y divide-divider">
                {byCloud[c].map((p, i) => {
                  const copyText = `${CLOUD_LABEL[c]} ${p.path} → ${p.status ?? "—"} (${p.elapsed_ms}ms)${p.hit ? ` HIT "${p.hit}"` : ""}`;
                  return (
                    <div
                      key={i}
                      style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                      className={"mhp-result-in group px-3 py-2 hover:bg-bg-row-alt transition " +
                                 (p.hit ? "mhp-critical-pulse" : "")}
                    >
                      <div className="flex items-center gap-2 text-[11px] mb-1">
                        <span className={p.hit ? "text-phos font-bold" : "text-ink-dim"}>
                          {p.hit ? "✓" : "·"}
                        </span>
                        <span className="font-mono text-ink-primary truncate flex-1">{p.path}</span>
                        <span className="text-ink-dim tabular-nums">{p.status ?? "—"} · {p.elapsed_ms}ms</span>
                        <CopyButton text={copyText} />
                      </div>
                      {p.hit && (
                        <div className="mt-1">
                          <div className="text-[10px] text-ink-muted mb-1">EVIDENCE (matched "{p.hit}"):</div>
                          <pre className="bg-bg-panel border border-divider rounded p-2
                                          text-[11px] text-phos whitespace-pre-wrap break-all
                                          max-h-32 overflow-y-auto">
                            {p.evidence.slice(0, 1500)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ResultGroup>
          );
        })}
      </div>

      {probes.length > 0 && (
        <StatsBar
          total={probes.length}
          critical={probes.filter((p) => p.hit).length}
          startedAt={startedAt}
          running={running}
          extra={running ? undefined : doneText || undefined}
        />
      )}
    </div>
  );
}
