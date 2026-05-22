import { useState } from "react";
import RequestForm, { initialRequestState, requestToInit, type RequestState, type KV }
  from "../components/webattack/RequestForm";
import { useAttackWS } from "../components/webattack/useAttackWS";

type IdorEvent =
  | { type: "started"; url: string; id_count: number; owner: string; attackers: string[] }
  | { type: "row"; id: string; owner: { status: number | null; length: number; elapsed_ms: number };
      attackers: Record<string, { status: number | null; length: number; elapsed_ms: number }> }
  | { type: "finding"; severity: "info" | "warn" | "high";
      id: string; attacker: string; evidence: string; confirmed: boolean }
  | { type: "progress"; done: number; total: number; findings: number }
  | { type: "done"; elapsed: number; findings: number; stopped: boolean }
  | { type: "error"; detail: string };

type AuthProfile = { name: string; headers: KV[]; cookies: KV[] };

const emptyProfile = (name: string): AuthProfile => ({ name, headers: [], cookies: [] });

function profileToObj(p: AuthProfile): Record<string, unknown> {
  const headers: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  for (const { key, value } of p.headers) if (key.trim()) headers[key.trim()] = value;
  for (const { key, value } of p.cookies) if (key.trim()) cookies[key.trim()] = value;
  return { name: p.name, headers, cookies };
}

function ProfileEditor({ p, setP, running, owner }: {
  p: AuthProfile; setP: (p: AuthProfile) => void; running: boolean; owner?: boolean;
}) {
  function updateKV(field: "headers" | "cookies", i: number, patch: Partial<KV>) {
    const arr = p[field].slice();
    arr[i] = { ...arr[i], ...patch };
    setP({ ...p, [field]: arr });
  }
  function addKV(field: "headers" | "cookies") {
    setP({ ...p, [field]: [...p[field], { key: "", value: "" }] });
  }
  function removeKV(field: "headers" | "cookies", i: number) {
    setP({ ...p, [field]: p[field].filter((_, j) => j !== i) });
  }
  return (
    <div className={"border rounded p-2 " + (owner ? "border-accent/40" : "border-divider")}>
      <input
        value={p.name}
        onChange={(e) => setP({ ...p, name: e.target.value })}
        disabled={running}
        className="w-full bg-transparent text-[12px] font-bold text-ink-primary mb-1 focus:outline-none"
      />
      {(["headers", "cookies"] as const).map((field) => (
        <div key={field} className="mb-1">
          <div className="text-[10px] text-ink-muted tracking-wider mb-0.5 flex items-center gap-2">
            {field.toUpperCase()}
            <button onClick={() => addKV(field)} disabled={running}
                    className="text-accent hover:underline disabled:opacity-40">+ add</button>
          </div>
          {p[field].map((kv, i) => (
            <div key={i} className="flex gap-1 mb-0.5">
              <input value={kv.key}
                     onChange={(e) => updateKV(field, i, { key: e.target.value })}
                     disabled={running}
                     placeholder={field === "headers" ? "Authorization" : "session"}
                     className="w-1/3 bg-bg-base border border-divider rounded px-1.5 py-0.5
                                text-[11px] font-mono focus:outline-none focus:border-accent" />
              <input value={kv.value}
                     onChange={(e) => updateKV(field, i, { value: e.target.value })}
                     disabled={running}
                     placeholder={field === "headers" ? "Bearer xyz" : "abc123"}
                     className="flex-1 bg-bg-base border border-divider rounded px-1.5 py-0.5
                                text-[11px] font-mono focus:outline-none focus:border-accent" />
              <button onClick={() => removeKV(field, i)} disabled={running}
                      className="text-ink-muted hover:text-danger px-1">×</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Idor() {
  const [req, setReq] = useState<RequestState>(initialRequestState);
  const [owner, setOwner] = useState<AuthProfile>(emptyProfile("owner"));
  const [attackers, setAttackers] = useState<AuthProfile[]>([emptyProfile("anon")]);
  const [idMode, setIdMode] = useState<"range" | "list">("range");
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(20);
  const [rangeStep, setRangeStep] = useState(1);
  const [idList, setIdList] = useState("1,2,3");

  const [rows, setRows] = useState<{ id: string; owner: any; attackers: any }[]>([]);
  const [findings, setFindings] = useState<{ id: string; attacker: string; evidence: string }[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [doneText, setDoneText] = useState("");

  const { status, error, start, stop } = useAttackWS<IdorEvent>(
    "/ws/idor",
    (ev) => {
      if (ev.type === "started") {
        setRows([]); setFindings([]); setDoneText("");
        setProgress({ done: 0, total: ev.id_count });
      } else if (ev.type === "row") {
        setRows((r) => [...r, { id: ev.id, owner: ev.owner, attackers: ev.attackers }]);
      } else if (ev.type === "finding") {
        setFindings((f) => [...f, { id: ev.id, attacker: ev.attacker, evidence: ev.evidence }]);
      } else if (ev.type === "progress") {
        setProgress({ done: ev.done, total: ev.total });
      } else if (ev.type === "done") {
        setDoneText(`done in ${ev.elapsed}s · ${ev.findings} suspected IDOR${ev.stopped ? " (stopped)" : ""}`);
      }
    },
    "/idor/scan",
  );

  const running = status === "connecting" || status === "running";

  function go() {
    const ids = idMode === "range"
      ? { start: rangeStart, end: rangeEnd, step: rangeStep }
      : idList.split(",").map((s) => s.trim()).filter(Boolean);
    start({
      ...requestToInit(req),
      ids,
      owner: profileToObj(owner),
      attackers: attackers.map(profileToObj),
    });
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <header>
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">IDOR</h2>
        <p className="text-[11px] text-ink-dim">
          Iterate IDs through the URL's FUZZ marker. For each ID, compare the OWNER's
          response (authorized) to each ATTACKER's response. A close match with different
          credentials suggests broken authorization.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3 overflow-y-auto max-h-[40%]">
        <RequestForm state={req} setState={setReq} running={running} />

        <div className="border-t border-divider pt-3">
          <div className="text-[11px] text-ink-muted tracking-wider mb-2">ID SET</div>
          <div className="flex gap-3 mb-2 text-[12px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={idMode === "range"}
                     onChange={() => setIdMode("range")} disabled={running} />
              <span className="text-ink-primary">Range</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={idMode === "list"}
                     onChange={() => setIdMode("list")} disabled={running} />
              <span className="text-ink-primary">List</span>
            </label>
          </div>
          {idMode === "range" ? (
            <div className="flex gap-2 text-[12px]">
              <label>start <input type="number" value={rangeStart}
                onChange={(e) => setRangeStart(parseInt(e.target.value) || 0)}
                disabled={running}
                className="w-16 bg-bg-base border border-divider rounded px-1.5 py-0.5
                           font-mono ml-1 focus:outline-none focus:border-accent" /></label>
              <label>end <input type="number" value={rangeEnd}
                onChange={(e) => setRangeEnd(parseInt(e.target.value) || 0)}
                disabled={running}
                className="w-16 bg-bg-base border border-divider rounded px-1.5 py-0.5
                           font-mono ml-1 focus:outline-none focus:border-accent" /></label>
              <label>step <input type="number" value={rangeStep}
                onChange={(e) => setRangeStep(parseInt(e.target.value) || 1)}
                disabled={running}
                className="w-12 bg-bg-base border border-divider rounded px-1.5 py-0.5
                           font-mono ml-1 focus:outline-none focus:border-accent" /></label>
            </div>
          ) : (
            <input value={idList} onChange={(e) => setIdList(e.target.value)}
                   disabled={running}
                   placeholder="1,2,3,abc-uuid,..."
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1
                              text-[12px] font-mono focus:outline-none focus:border-accent" />
          )}
        </div>

        <div className="border-t border-divider pt-3">
          <div className="text-[11px] text-ink-muted tracking-wider mb-2">AUTH PROFILES</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-accent tracking-wider mb-1">OWNER (legitimate user)</div>
              <ProfileEditor p={owner} setP={setOwner} running={running} owner />
            </div>
            <div>
              <div className="text-[10px] text-ink-muted tracking-wider mb-1 flex items-center gap-2">
                ATTACKERS
                <button onClick={() => setAttackers((a) => [...a, emptyProfile(`attacker${a.length}`)])}
                        disabled={running}
                        className="text-accent hover:underline disabled:opacity-40">+ add</button>
              </div>
              <div className="space-y-2">
                {attackers.map((a, i) => (
                  <div key={i} className="relative">
                    <ProfileEditor p={a} setP={(p) => {
                      const next = attackers.slice();
                      next[i] = p; setAttackers(next);
                    }} running={running} />
                    {attackers.length > 1 && (
                      <button onClick={() => setAttackers(attackers.filter((_, j) => j !== i))}
                              disabled={running}
                              className="absolute top-1 right-1 text-ink-muted hover:text-danger
                                         text-[12px] disabled:opacity-40">×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 items-center pt-2 border-t border-divider">
          {!running ? (
            <button onClick={go}
                    disabled={!req.url.trim() || !req.confirmAuth}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              Start IDOR Scan
            </button>
          ) : (
            <button onClick={stop}
                    className="px-3 py-1.5 rounded bg-bg-base border border-danger text-danger text-[12px]">
              Stop
            </button>
          )}
          {progress.total > 0 && (
            <span className="text-[11px] text-ink-dim">
              {progress.done} / {progress.total} ids · {findings.length} suspected IDOR
            </span>
          )}
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      {/* Findings */}
      <div>
        <div className="text-[11px] text-ink-muted tracking-wider mb-1">FINDINGS ({findings.length})</div>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {findings.length === 0 && (
            <div className="text-[12px] text-ink-dim italic">No suspected IDOR yet.</div>
          )}
          {findings.map((f, i) => (
            <div key={i} className="bg-danger/10 border border-divider rounded p-2 text-[12px]">
              <span className="text-danger font-bold mr-2">HIGH</span>
              id <span className="text-amber font-mono">{f.id}</span> reachable by{" "}
              <span className="text-amber">{f.attacker}</span> — <span className="text-ink-muted">{f.evidence}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto bg-bg-card border border-divider rounded">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-bg-sidebar border-b border-divider">
            <tr className="text-ink-muted text-[10px] tracking-wider">
              <th className="text-left px-2 py-1.5">ID</th>
              <th className="text-left px-2 py-1.5">OWNER</th>
              {attackers.map((a) => (
                <th key={a.name} className="text-left px-2 py-1.5">{a.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-divider hover:bg-bg-base">
                <td className="px-2 py-1 font-mono text-amber">{r.id}</td>
                <td className="px-2 py-1 font-mono">
                  <span className="text-phos">{r.owner.status ?? "—"}</span>
                  <span className="text-ink-dim ml-2">{r.owner.length}b</span>
                </td>
                {attackers.map((a) => {
                  const v = r.attackers[a.name];
                  if (!v) return <td key={a.name} className="px-2 py-1 text-ink-dim">—</td>;
                  const suspect = r.owner.status && v.status && r.owner.status < 300 && v.status < 300
                    && Math.abs(r.owner.length - v.length) / Math.max(r.owner.length, v.length, 1) < 0.1;
                  return (
                    <td key={a.name} className={"px-2 py-1 font-mono " +
                      (suspect ? "bg-danger/20" : "")}>
                      <span className={v.status && v.status < 300 ? "text-phos" : "text-ink-muted"}>
                        {v.status ?? "—"}
                      </span>
                      <span className="text-ink-dim ml-2">{v.length}b</span>
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={2 + attackers.length} className="px-2 py-4 text-ink-dim text-center">
                No rows yet.
              </td></tr>
            )}
          </tbody>
        </table>
        {doneText && (
          <div className="px-3 py-2 text-[11px] text-ink-dim border-t border-divider">{doneText}</div>
        )}
      </div>
    </div>
  );
}
