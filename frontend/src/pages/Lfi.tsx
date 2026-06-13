import { useState } from "react";
import RequestForm, { initialRequestState, requestToInit, type RequestState }
  from "../components/webattack/RequestForm";
import { useAttackWS } from "../components/webattack/useAttackWS";
import AttackResults, { type Attempt, type Finding }
  from "../components/webattack/AttackResults";
import { useLabIntent } from "../lib/labIntent";

type LfiEvent =
  | { type: "started"; url: string; total_payloads: number }
  | { type: "attempt"; payload: string; status: number | null;
      length: number; elapsed_ms: number; hit: string | null }
  | { type: "finding"; severity: "info" | "warn" | "high";
      kind: string; payload: string; evidence: string; confirmed: boolean }
  | { type: "progress"; done: number; total: number; findings: number }
  | { type: "done"; elapsed: number; findings: number; stopped: boolean }
  | { type: "error"; detail: string };

export default function Lfi() {
  const intent = useLabIntent("lfi");
  const [req, setReq] = useState<RequestState>(
    intent?.target ? { ...initialRequestState, url: intent.target } : initialRequestState,
  );
  const [exploit, setExploit] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [doneText, setDoneText] = useState("");

  const { status, error, start, stop } = useAttackWS<LfiEvent>(
    "/ws/lfi",
    (ev) => {
      if (ev.type === "started") {
        setAttempts([]); setFindings([]);
        setProgress({ done: 0, total: ev.total_payloads }); setDoneText("");
      } else if (ev.type === "attempt") {
        setAttempts((a) => [...a, {
          payload: ev.payload, status: ev.status, length: ev.length,
          elapsed_ms: ev.elapsed_ms, extra: { hit: ev.hit ?? "" },
        }]);
      } else if (ev.type === "finding") {
        setFindings((f) => [...f, {
          severity: ev.severity, payload: ev.payload,
          evidence: ev.evidence, confirmed: ev.confirmed,
          extra: { kind: ev.kind },
        }]);
      } else if (ev.type === "progress") {
        setProgress({ done: ev.done, total: ev.total });
      } else if (ev.type === "done") {
        setDoneText(`done in ${ev.elapsed}s · ${ev.findings} findings${ev.stopped ? " (stopped)" : ""}`);
      }
    },
    "/lfi/scan",
  );

  const running = status === "connecting" || status === "running";

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <header>
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">LFI / PATH TRAVERSAL</h2>
        <p className="text-[11px] text-ink-dim">
          Traversal payloads (`../`, %2e%2e%2f, double-encoded), absolute paths, PHP wrappers
          (php://filter base64 source disclosure), Windows variants. Place FUZZ where the file path lands.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3">
        <RequestForm state={req} setState={setReq} running={running} />

        <label className="flex items-center gap-2 text-[12px] cursor-pointer pt-2 border-t border-divider">
          <input type="checkbox" checked={exploit} disabled={running}
                 onChange={(e) => setExploit(e.target.checked)} />
          <span className="text-ink-primary">
            After confirmation: pull /etc/shadow, /etc/hosts, /proc/self/environ, etc.
          </span>
        </label>

        <div className="flex gap-2 items-center">
          {!running ? (
            <button onClick={() => start({ ...requestToInit(req), exploit })}
                    disabled={!req.url.trim() || !req.confirmAuth}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              Start LFI Scan
            </button>
          ) : (
            <button onClick={stop}
                    className="px-3 py-1.5 rounded bg-bg-base border border-danger text-danger text-[12px]">
              Stop
            </button>
          )}
          {progress.total > 0 && (
            <span className="text-[11px] text-ink-dim">
              {progress.done} / {progress.total} · {findings.length} findings
            </span>
          )}
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      <AttackResults
        attempts={attempts}
        findings={findings}
        extraColumns={[{ key: "hit", label: "HIT" }]}
        doneText={doneText}
      />
    </div>
  );
}
