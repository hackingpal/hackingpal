import { useState } from "react";
import RequestForm, { initialRequestState, requestToInit, type RequestState }
  from "../components/webattack/RequestForm";
import { useAttackWS } from "../components/webattack/useAttackWS";
import AttackResults, { type Attempt, type Finding }
  from "../components/webattack/AttackResults";

type SsrfEvent =
  | { type: "started"; url: string; total_payloads: number }
  | { type: "attempt"; label: string; payload: string; status: number | null;
      length: number; elapsed_ms: number; hit: string | null }
  | { type: "finding"; severity: "info" | "warn" | "high";
      label: string; payload: string; evidence: string; confirmed: boolean }
  | { type: "done"; elapsed: number; findings: number;
      clouds: string[]; stopped: boolean }
  | { type: "error"; detail: string };

export default function Ssrf() {
  const [req, setReq] = useState<RequestState>(initialRequestState);
  const [exploit, setExploit] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [doneText, setDoneText] = useState("");

  const { status, error, timedOut, start, stop } = useAttackWS<SsrfEvent>(
    "/ws/ssrf",
    (ev) => {
      if (ev.type === "started") {
        setAttempts([]); setFindings([]); setDoneText("");
      } else if (ev.type === "attempt") {
        setAttempts((a) => [...a, {
          payload: `${ev.label}: ${ev.payload}`, status: ev.status,
          length: ev.length, elapsed_ms: ev.elapsed_ms,
          extra: { hit: ev.hit ?? "" },
        }]);
      } else if (ev.type === "finding") {
        setFindings((f) => [...f, {
          severity: ev.severity,
          payload: `${ev.label}: ${ev.payload}`,
          evidence: ev.evidence, confirmed: ev.confirmed,
          extra: { label: ev.label },
        }]);
      } else if (ev.type === "done") {
        setDoneText(`done in ${ev.elapsed}s · ${ev.findings} findings${
          ev.clouds.length ? ` · clouds: ${ev.clouds.join(", ")}` : ""
        }${ev.stopped ? " (stopped)" : ""}`);
      }
    },
    "/ssrf/scan",
  );

  const running = status === "connecting" || status === "running";

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <header>
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">SSRF</h2>
        <p className="text-[11px] text-ink-dim">
          Tests internal IPs (loopback variants, dec/hex/octal IPv4) and cloud IMDS endpoints
          (AWS, Azure, GCP). Place FUZZ where the target URL goes in the outer request.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3">
        <RequestForm state={req} setState={setReq} running={running} />

        <label className="flex items-center gap-2 text-[12px] cursor-pointer pt-2 border-t border-divider">
          <input type="checkbox" checked={exploit} disabled={running}
                 onChange={(e) => setExploit(e.target.checked)} />
          <span className="text-ink-primary">
            After confirmation: dump full IMDS (AWS credentials, GCP tokens, Azure managed identity)
          </span>
        </label>

        <div className="flex gap-2 items-center">
          {!running ? (
            <button onClick={() => start({ ...requestToInit(req), exploit })}
                    disabled={!req.url.trim() || !req.confirmAuth}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              Start SSRF Scan
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
        extraColumns={[{ key: "hit", label: "HIT" }]}
        doneText={doneText}
        promoteTool="ssrf"
        promoteTarget={req.url}
      />
    </div>
  );
}
