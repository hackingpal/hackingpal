import { useState } from "react";
import AuthorizationGate from "../components/AuthorizationGate";
import { useAttackWS } from "../components/webattack/useAttackWS";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";
import PromoteToFindingButton from "../components/PromoteToFindingButton";

type S3Event =
  | { type: "started"; target: string; total: number }
  | { type: "bucket"; name: string; status: number; exists: boolean;
      listable: boolean; region: string | null; hint: string | null }
  | { type: "progress"; done: number; total: number; found: number }
  | { type: "done"; elapsed: number; found: number; listable: number; stopped: boolean }
  | { type: "error"; detail: string };

type Bucket = S3Event & { type: "bucket" };

export default function S3Scanner() {
  const [target, setTarget] = useState("");
  const [extra, setExtra] = useState("");  // comma-separated
  const [rate, setRate] = useState(10);
  const [showExisting, setShowExisting] = useState(true);
  const [showMissing, setShowMissing] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [doneText, setDoneText] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const { status, error, start, stop } = useAttackWS<S3Event>(
    "/ws/s3-scan",
    (ev) => {
      if (ev.type === "started") {
        setBuckets([]); setDoneText("");
        setProgress({ done: 0, total: ev.total });
        setStartedAt(Date.now());
      } else if (ev.type === "bucket") {
        setBuckets((b) => [...b, ev]);
      } else if (ev.type === "progress") {
        setProgress({ done: ev.done, total: ev.total });
      } else if (ev.type === "done") {
        setDoneText(`done in ${ev.elapsed}s · ${ev.found} exist · ${ev.listable} listable${ev.stopped ? " (stopped)" : ""}`);
      }
    },
    "/s3/scan",
  );

  const running = status === "connecting" || status === "running";

  function go() {
    if (!target.trim()) return;
    const extras = extra.split(",").map((s) => s.trim()).filter(Boolean);
    start({ target: target.trim(), extra_keywords: extras, rate_per_sec: rate,
            confirm_auth: true });
  }

  const existing = buckets.filter((b) => b.exists);
  const listable = buckets.filter((b) => b.listable);
  const filtered = buckets.filter((b) => {
    if (b.exists && showExisting) return true;
    if (!b.exists && showMissing) return true;
    return false;
  });

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <header>
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">S3 BUCKET SCANNER</h2>
        <p className="text-[11px] text-ink-dim">
          Permutation-based public S3 bucket finder. Given a target name we
          combine it with common patterns (prod / dev / backup / logs / data /
          assets / etc.) and probe each against s3.amazonaws.com.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
              TARGET NAME
            </label>
            <input value={target} onChange={(e) => setTarget(e.target.value)}
                   disabled={running}
                   placeholder="acme"
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                              text-[13px] font-mono focus:outline-none focus:border-accent" />
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
              EXTRA KEYWORDS (comma-separated)
            </label>
            <input value={extra} onChange={(e) => setExtra(e.target.value)}
                   disabled={running}
                   placeholder="data, internal, customers"
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                              text-[13px] font-mono focus:outline-none focus:border-accent" />
          </div>
        </div>

        <div className="flex items-center gap-3 text-[12px]">
          <span className="text-ink-muted">Rate:</span>
          <input type="range" min={1} max={30} value={rate}
                 onChange={(e) => setRate(parseInt(e.target.value))}
                 disabled={running} className="flex-1" />
          <span className="text-ink-primary tabular-nums w-10 text-right">{rate}/s</span>
        </div>

        <AuthorizationGate authorized={authorized} setAuthorized={setAuthorized}
                           toolName="S3 bucket enumeration" disabled={running} />
        <div className="flex items-center gap-2">
          {!running ? (
            <button onClick={go} disabled={!target.trim() || !authorized}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              Start Scan
            </button>
          ) : (
            <button onClick={stop}
                    className="px-3 py-1.5 rounded bg-bg-base border border-danger text-danger text-[12px]">
              Stop
            </button>
          )}
          {progress.total > 0 && (
            <span className="text-[11px] text-ink-dim tabular-nums">
              {progress.done} / {progress.total} probed · {existing.length} exist · {listable.length} listable
            </span>
          )}
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
          {doneText && <span className="text-[11px] text-ink-dim">{doneText}</span>}
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 text-[11px]">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showExisting}
                 onChange={(e) => setShowExisting(e.target.checked)} />
          <span className="text-ink-primary">Show existing</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showMissing}
                 onChange={(e) => setShowMissing(e.target.checked)} />
          <span className="text-ink-muted">Show non-existent</span>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto bg-bg-card border border-divider rounded">
        {buckets.length === 0 && !running ? (
          <EmptyState
            icon="🪣"
            title="S3 bucket enumeration"
            description="Permutation-based public-bucket finder. Probes <target>-prod, <target>-backup, <target>-data, … against s3.amazonaws.com."
            exampleTarget="acme"
            onExample={setTarget}
          />
        ) : (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-bg-panel border-b border-divider">
              <tr className="text-ink-muted text-[10px] tracking-wider">
                <th className="text-left px-3 py-1.5"></th>
                <th className="text-left px-3 py-1.5">BUCKET</th>
                <th className="text-left px-3 py-1.5 w-16">STATUS</th>
                <th className="text-left px-3 py-1.5 w-24">STATE</th>
                <th className="text-left px-3 py-1.5">HINT</th>
                <th className="px-3 py-1.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => {
                const sevClass = b.listable ? "text-phos" : b.exists ? "text-amber" : "text-ink-dim";
                const dot = b.listable ? "bg-phos" : b.exists ? "bg-amber" : "bg-ink-dim";
                const copyText = `${b.name} (${b.status || "?"}) ${b.listable ? "LISTABLE" : b.exists ? "private" : "missing"}${b.region ? ` [${b.region}]` : ""}${b.hint ? ` — ${b.hint}` : ""}`;
                return (
                  <tr
                    key={i}
                    style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                    className={"group border-b border-divider hover:bg-bg-nav-hover mhp-result-in " +
                               (b.listable ? "mhp-critical-pulse" : "")}
                  >
                    <td className="px-3 py-1.5">
                      <span className={"inline-block w-1.5 h-1.5 rounded-full " + dot} />
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      <a href={`https://${b.name}.s3.amazonaws.com/`} target="_blank" rel="noreferrer"
                         className={"hover:underline " + sevClass}>
                        {b.name}
                      </a>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-ink-muted tabular-nums">{b.status || "—"}</td>
                    <td className={"px-3 py-1.5 uppercase tracking-wider " + sevClass}>
                      {b.listable ? "listable" : b.exists ? "private" : "missing"}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted">
                      {b.hint || ""}{b.region ? ` → ${b.region}` : ""}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1 justify-end">
                        <CopyButton text={copyText} />
                        {b.exists && (
                          <PromoteToFindingButton
                            variant="compact"
                            seed={{
                              tool: "s3-scanner",
                              target: b.name,
                              title: b.listable
                                ? `S3 bucket listable: ${b.name}`
                                : `S3 bucket exists: ${b.name}`,
                              severity: b.listable ? "critical" : "high",
                              evidence: JSON.stringify(
                                { name: b.name, status: b.status, listable: b.listable,
                                  region: b.region, hint: b.hint },
                                null, 2,
                              ),
                            }}
                          />
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-dim italic">
                  Buckets exist but the current filter hides them — toggle filters above.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {buckets.length > 0 && (
        <StatsBar
          total={buckets.length}
          critical={listable.length}
          medium={existing.length - listable.length}
          startedAt={startedAt}
          running={running}
          extra={progress.total > 0 ? `${progress.done}/${progress.total} probed` : undefined}
        />
      )}
    </div>
  );
}
