import { useState } from "react";
import RequestForm, { initialRequestState, requestToInit, type RequestState }
  from "../components/webattack/RequestForm";
import { useAttackWS } from "../components/webattack/useAttackWS";
import AttackResults, { type Attempt, type Finding }
  from "../components/webattack/AttackResults";

type Method = "error" | "boolean" | "time" | "union";

type SqliEvent =
  | { type: "started"; methods: Method[];
      baseline: { status: number | null; length: number; elapsed_ms: number } }
  | { type: "attempt"; method: Method | "exploit"; payload: string;
      status: number | null; length: number; elapsed_ms: number; label?: string }
  | { type: "finding"; severity: "info" | "warn" | "high";
      method: Method | "exploit"; dbms?: string; payload: string;
      evidence: string; confirmed: boolean }
  | { type: "done"; elapsed: number; findings: number; dbms?: string | null; stopped: boolean }
  | { type: "error"; detail: string };

export default function Sqli() {
  const [req, setReq] = useState<RequestState>(initialRequestState);
  const [methods, setMethods] = useState<Set<Method>>(new Set(["error", "boolean", "time"]));
  const [exploit, setExploit] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [doneText, setDoneText] = useState("");

  const { status, error, timedOut, start, stop } = useAttackWS<SqliEvent>(
    "/ws/sqli",
    (ev) => {
      if (ev.type === "started") {
        setAttempts([]); setFindings([]); setDoneText("");
      } else if (ev.type === "attempt") {
        setAttempts((a) => [...a, {
          payload: ev.payload, status: ev.status, length: ev.length,
          elapsed_ms: ev.elapsed_ms,
          extra: { method: ev.method, label: ev.label ?? "" },
        }]);
      } else if (ev.type === "finding") {
        setFindings((f) => [...f, {
          severity: ev.severity, payload: ev.payload,
          evidence: ev.evidence, confirmed: ev.confirmed,
          extra: { method: ev.method, dbms: ev.dbms ?? "" },
        }]);
      } else if (ev.type === "done") {
        setDoneText(`done in ${ev.elapsed}s · ${ev.findings} findings${ev.dbms ? ` · dbms=${ev.dbms}` : ""}${ev.stopped ? " (stopped)" : ""}`);
      }
    },
    "/sqli/scan",
  );

  const running = status === "connecting" || status === "running";

  function toggleMethod(m: Method) {
    setMethods((s) => {
      const next = new Set(s);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <header>
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">SQL INJECTION</h2>
        <p className="text-[11px] text-ink-dim">
          Error / boolean / time / union detection. On confirm + exploit, extracts DBMS version.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3">
        <RequestForm state={req} setState={setReq} running={running} />

        <div className="border-t border-divider pt-3 space-y-2">
          <div>
            <div className="text-[11px] text-ink-muted tracking-wider mb-1">DETECTION METHODS</div>
            <div className="flex gap-3 text-[12px]">
              {(["error", "boolean", "time", "union"] as Method[]).map((m) => (
                <label key={m} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={methods.has(m)}
                         disabled={running}
                         onChange={() => toggleMethod(m)} />
                  <span className="text-ink-primary uppercase">{m}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer">
            <input type="checkbox" checked={exploit}
                   disabled={running}
                   onChange={(e) => setExploit(e.target.checked)} />
            <span className="text-ink-primary">After confirmation: pull DBMS version</span>
          </label>
        </div>

        <div className="flex gap-2 items-center">
          {!running ? (
            <button onClick={() => start({
              ...requestToInit(req), methods: [...methods], exploit,
            })} disabled={!req.url.trim() || !req.confirmAuth || methods.size === 0}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              Start SQLi Scan
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
        extraColumns={[{ key: "method", label: "METHOD" }]}
        doneText={doneText}
      />
    </div>
  );
}
