import { useState } from "react";
import RequestForm, { initialRequestState, requestToInit, type RequestState }
  from "../components/webattack/RequestForm";
import { useAttackWS } from "../components/webattack/useAttackWS";
import AttackResults, { type Attempt, type Finding }
  from "../components/webattack/AttackResults";

type Mode = "time" | "output";

type CmdiEvent =
  | { type: "started"; modes: Mode[];
      baseline: { status: number | null; length: number; elapsed_ms: number } }
  | { type: "attempt"; mode: Mode | "exploit"; payload: string; label?: string;
      status: number | null; length: number; elapsed_ms: number }
  | { type: "finding"; severity: "info" | "warn" | "high";
      mode: Mode | "exploit"; payload: string; label?: string;
      evidence: string; confirmed: boolean }
  | { type: "done"; elapsed: number; findings: number; stopped: boolean }
  | { type: "error"; detail: string };

export default function Cmdi() {
  const [req, setReq] = useState<RequestState>(initialRequestState);
  const [modes, setModes] = useState<Set<Mode>>(new Set(["time", "output"]));
  const [exploit, setExploit] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [doneText, setDoneText] = useState("");

  const { status, error, timedOut, start, stop } = useAttackWS<CmdiEvent>(
    "/ws/cmdi",
    (ev) => {
      if (ev.type === "started") {
        setAttempts([]); setFindings([]); setDoneText("");
      } else if (ev.type === "attempt") {
        setAttempts((a) => [...a, {
          payload: ev.payload, status: ev.status, length: ev.length,
          elapsed_ms: ev.elapsed_ms,
          extra: { mode: ev.mode, label: ev.label ?? "" },
        }]);
      } else if (ev.type === "finding") {
        setFindings((f) => [...f, {
          severity: ev.severity, payload: ev.payload,
          evidence: ev.evidence, confirmed: ev.confirmed,
          extra: { mode: ev.mode, label: ev.label ?? "" },
        }]);
      } else if (ev.type === "done") {
        setDoneText(`done in ${ev.elapsed}s · ${ev.findings} findings${ev.stopped ? " (stopped)" : ""}`);
      }
    },
    "/cmdi/scan",
  );

  const running = status === "connecting" || status === "running";

  function toggleMode(m: Mode) {
    setModes((s) => {
      const next = new Set(s);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <header>
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">COMMAND INJECTION</h2>
        <p className="text-[11px] text-ink-dim">
          Time-based (sleep) + output-based (id/whoami/uname) detection. Unix and Windows payloads.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3">
        <RequestForm state={req} setState={setReq} running={running} />

        <div className="border-t border-divider pt-3 space-y-2">
          <div className="flex gap-3 text-[12px]">
            {(["time", "output"] as Mode[]).map((m) => (
              <label key={m} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={modes.has(m)}
                       disabled={running} onChange={() => toggleMode(m)} />
                <span className="text-ink-primary uppercase">{m}</span>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer">
            <input type="checkbox" checked={exploit} disabled={running}
                   onChange={(e) => setExploit(e.target.checked)} />
            <span className="text-ink-primary">After detection: read /etc/passwd</span>
          </label>
        </div>

        <div className="flex gap-2 items-center">
          {!running ? (
            <button onClick={() => start({
              ...requestToInit(req), modes: [...modes], exploit,
            })} disabled={!req.url.trim() || !req.confirmAuth || modes.size === 0}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              Start CMDi Scan
            </button>
          ) : (
            <button onClick={stop}
                    className="px-3 py-1.5 rounded bg-bg-base border border-danger text-danger text-[12px]">
              Stop
            </button>
          )}
          {timedOut && (
            <span className="text-[11px] text-amber">
              ⏱ {timedOut === "connect" ? "Backend not responding" : "Scan stalled"} — retry
            </span>
          )}
          {error && !timedOut && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      <AttackResults
        attempts={attempts}
        findings={findings}
        extraColumns={[{ key: "mode", label: "MODE" }, { key: "label", label: "LABEL" }]}
        doneText={doneText}
      />
    </div>
  );
}
