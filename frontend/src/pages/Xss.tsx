import { useState } from "react";
import RequestForm, { initialRequestState, requestToInit, type RequestState }
  from "../components/webattack/RequestForm";
import { useAttackWS } from "../components/webattack/useAttackWS";
import AttackResults, { type Attempt, type Finding }
  from "../components/webattack/AttackResults";
import { useLabIntent } from "../lib/labIntent";

type XssEvent =
  | { type: "started"; url: string; total_payloads: number }
  | { type: "attempt"; payload: string; status: number | null; length: number;
      elapsed_ms: number; reflected: boolean; context: string }
  | { type: "finding"; severity: "info" | "warn" | "high"; payload: string;
      context: string; evidence: string; confirmed: boolean }
  | { type: "progress"; done: number; total: number; findings: number }
  | { type: "done"; elapsed: number; findings: number; stopped: boolean }
  | { type: "error"; detail: string };

export default function Xss() {
  const intent = useLabIntent("xss");
  const [req, setReq] = useState<RequestState>(
    intent?.target ? { ...initialRequestState, url: intent.target } : initialRequestState,
  );
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [doneText, setDoneText] = useState("");

  const { status, error, start, stop } = useAttackWS<XssEvent>(
    "/ws/xss",
    (ev) => {
      if (ev.type === "started") {
        setAttempts([]); setFindings([]);
        setProgress({ done: 0, total: ev.total_payloads });
        setDoneText("");
      } else if (ev.type === "attempt") {
        setAttempts((a) => [...a, {
          payload: ev.payload, status: ev.status, length: ev.length,
          elapsed_ms: ev.elapsed_ms,
          extra: { reflected: ev.reflected ? "yes" : "no", context: ev.context },
        }]);
      } else if (ev.type === "finding") {
        setFindings((f) => [...f, {
          severity: ev.severity, payload: ev.payload,
          evidence: ev.evidence, confirmed: ev.confirmed,
          extra: { context: ev.context },
        }]);
      } else if (ev.type === "progress") {
        setProgress({ done: ev.done, total: ev.total });
      } else if (ev.type === "done") {
        setDoneText(`done in ${ev.elapsed}s · ${ev.findings} findings${ev.stopped ? " (stopped)" : ""}`);
      }
    },
    "/xss/scan",
  );

  const running = status === "connecting" || status === "running";

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <header>
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">REFLECTED XSS</h2>
        <p className="text-[11px] text-ink-dim">
          Polyglot + context-specific payloads. Confirmed = full payload reflected unescaped in an executable context.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3">
        <RequestForm state={req} setState={setReq} running={running} />
        <div className="flex gap-2 items-center pt-2 border-t border-divider">
          {!running ? (
            <button onClick={() => start({ ...requestToInit(req) })}
                    disabled={!req.url.trim() || !req.confirmAuth}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              Start XSS Scan
            </button>
          ) : (
            <button onClick={stop}
                    className="px-3 py-1.5 rounded bg-bg-base border border-danger text-danger text-[12px]">
              Stop
            </button>
          )}
          {progress.total > 0 && (
            <span className="text-[11px] text-ink-dim">
              {progress.done} / {progress.total} payloads · {findings.length} findings
            </span>
          )}
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      <AttackResults
        attempts={attempts}
        findings={findings}
        extraColumns={[{ key: "reflected", label: "REFL" }, { key: "context", label: "CTX" }]}
        doneText={doneText}
      />
    </div>
  );
}
