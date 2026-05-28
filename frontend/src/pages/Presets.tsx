import { useEffect, useMemo, useRef, useState } from "react";
import { api, authFetch, openWs } from "../api";

type PresetSummary = {
  id: string; name: string; description: string;
  target_type: string; author: string;
  step_count: number; builtin: boolean;
};

type PresetStep = {
  id: string; tool: string;
  options?: Record<string, unknown>;
  feed_output_to?: string[];
  condition?: unknown;
};

type PresetFull = PresetSummary & {
  steps: PresetStep[];
};

type Severity = "critical" | "high" | "medium" | "low" | "info";
const ALL_SEV: Severity[] = ["critical", "high", "medium", "low", "info"];

type Finding = {
  step: string; severity: Severity;
  title: string; detail: string;
};

type StepStatus = "pending" | "running" | "ok" | "error" | "stopped";

type StepState = {
  id: string; tool: string;
  status: StepStatus;
  elapsed?: number;
  detail?: string;     // populated on error
  progress?: string;   // latest step_progress msg
  summary?: Record<string, unknown>;
};

const SEV_STYLES: Record<Severity, { dot: string; text: string; bg: string }> = {
  critical: { dot: "bg-red-500",    text: "text-red-500",    bg: "bg-red-500/15 border-red-500/40" },
  high:     { dot: "bg-orange-500", text: "text-orange-500", bg: "bg-orange-500/15 border-orange-500/40" },
  medium:   { dot: "bg-yellow-500", text: "text-yellow-500", bg: "bg-yellow-500/15 border-yellow-500/40" },
  low:      { dot: "bg-blue-400",   text: "text-blue-400",   bg: "bg-blue-400/15 border-blue-400/30" },
  info:     { dot: "bg-gray-400",   text: "text-gray-400",   bg: "bg-gray-400/10 border-divider" },
};

const STATUS_ICON: Record<StepStatus, string> = {
  pending: "○",
  running: "◐",
  ok:      "●",
  error:   "✕",
  stopped: "■",
};

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: "text-ink-dim",
  running: "text-amber",
  ok:      "text-phos",
  error:   "text-danger",
  stopped: "text-ink-muted",
};


export default function Presets() {
  const [library, setLibrary] = useState<PresetSummary[]>([]);
  const [selected, setSelected] = useState<PresetFull | null>(null);
  const [target, setTarget] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [running, setRunning] = useState(false);
  const [stepStates, setStepStates] = useState<StepState[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [doneSummary, setDoneSummary] = useState("");
  const [wsError, setWsError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  const [showBuilder, setShowBuilder] = useState(false);
  const [builderJson, setBuilderJson] = useState<string>("");
  const [builderError, setBuilderError] = useState("");

  async function refreshLibrary() {
    try {
      const r = await api<{ presets: PresetSummary[]; tools: string[] }>("/presets");
      setLibrary(r.presets);
    } catch (e) {
      setWsError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void refreshLibrary(); }, []);

  // Close any in-flight preset run if the user navigates away.
  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  async function select(p: PresetSummary) {
    try {
      const full = await api<PresetFull>(`/presets/${encodeURIComponent(p.id)}`);
      setSelected(full);
      setStepStates(full.steps.map((s) => ({
        id: s.id, tool: s.tool, status: "pending",
      })));
      setFindings([]);
      setDoneSummary("");
      setWsError("");
    } catch (e) {
      setWsError(e instanceof Error ? e.message : String(e));
    }
  }

  function start() {
    if (!selected || !target.trim() || !authorized || running) return;
    setWsError("");
    setRunning(true);
    setDoneSummary("");
    setFindings([]);
    setStepStates(selected.steps.map((s) => ({
      id: s.id, tool: s.tool, status: "pending",
    })));

    const ws = openWs("/ws/preset-run");
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({
        preset: selected.id, target: target.trim(), authorized: true,
      }));
    };
    ws.onmessage = (msgEv) => {
      let ev: any;
      try { ev = JSON.parse(msgEv.data); } catch { return; }
      handleEvent(ev);
    };
    ws.onerror = () => {
      setWsError("WebSocket error");
    };
    ws.onclose = () => {
      setRunning(false);
      wsRef.current = null;
    };
  }

  function stop() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ action: "stop" })); } catch { /* ignore */ }
  }

  function handleEvent(ev: any) {
    const t = ev.type;
    if (t === "preset_start") {
      // no-op; UI already initialized in start()
    } else if (t === "step_start") {
      setStepStates((s) => s.map((x) =>
        x.id === ev.step ? { ...x, status: "running" } : x));
    } else if (t === "step_progress") {
      setStepStates((s) => s.map((x) =>
        x.id === ev.step ? { ...x, progress: ev.msg } : x));
    } else if (t === "step_result") {
      setStepStates((s) => s.map((x) =>
        x.id === ev.step ? { ...x, summary: ev.summary } : x));
    } else if (t === "step_done") {
      setStepStates((s) => s.map((x) =>
        x.id === ev.step ? {
          ...x, status: ev.status as StepStatus,
          elapsed: ev.elapsed, detail: ev.detail,
        } : x));
    } else if (t === "finding") {
      const sev: Severity = (ALL_SEV as string[]).includes(ev.severity)
        ? ev.severity as Severity : "info";
      setFindings((f) => [...f, {
        step: ev.step || "", severity: sev,
        title: ev.title || "", detail: ev.detail || "",
      }]);
    } else if (t === "done") {
      setDoneSummary(
        `Completed in ${ev.elapsed}s · ${ev.findings_total} findings`
        + (ev.stopped ? " (stopped)" : ""),
      );
    } else if (t === "error") {
      setWsError(ev.detail || "engine error");
    }
  }

  // ── Derived counts ────────────────────────────────────────────────────────
  const sevCounts = useMemo(() => {
    const c: Record<Severity, number> = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
    };
    for (const f of findings) c[f.severity] = (c[f.severity] || 0) + 1;
    return c;
  }, [findings]);

  const totalSteps = stepStates.length || 1;
  const doneSteps = stepStates.filter((s) =>
    s.status === "ok" || s.status === "error" || s.status === "stopped").length;
  const progressPct = Math.round((doneSteps / totalSteps) * 100);

  async function saveCustom() {
    setBuilderError("");
    let parsed: any;
    try { parsed = JSON.parse(builderJson); }
    catch (e) {
      setBuilderError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    try {
      const r = await authFetch(`/presets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!r.ok) {
        const detail = await r.json().catch(() => ({}));
        throw new Error(detail.detail ?? `HTTP ${r.status}`);
      }
      setShowBuilder(false);
      setBuilderJson("");
      await refreshLibrary();
    } catch (e) {
      setBuilderError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deletePreset(p: PresetSummary) {
    if (p.builtin) return;
    if (!confirm(`Delete preset "${p.name}"?`)) return;
    try {
      const r = await authFetch(`/presets/${encodeURIComponent(p.id)}`,
                                { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (selected?.id === p.id) setSelected(null);
      await refreshLibrary();
    } catch (e) {
      setWsError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      <header className="px-4 pt-4 pb-2">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">PLAYBOOKS</h2>
        <p className="text-[11px] text-ink-dim">
          Composed assessments — each step calls a tool in-process, streams
          findings into one panel. Built-ins are read-only; save your own
          via <span className="text-amber">Build Custom Preset</span>.
        </p>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-12 gap-3 px-4 pb-3 overflow-hidden">

        {/* ── LEFT: library ──────────────────────────────────────────── */}
        <div className="col-span-4 flex flex-col min-h-0">
          <div className="text-[11px] text-ink-muted tracking-wider mb-1">LIBRARY</div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            {library.length === 0 && (
              <div className="text-[12px] text-ink-dim italic">No presets yet.</div>
            )}
            {library.map((p) => {
              const isSel = selected?.id === p.id;
              return (
                <div key={p.id}
                     onClick={() => void select(p)}
                     className={"border rounded p-2 cursor-pointer transition-colors " +
                       (isSel
                         ? "bg-bg-card border-accent"
                         : "bg-bg-card border-divider hover:border-ink-muted")}>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-ink-primary">{p.name}</span>
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5
                                     rounded border border-divider text-ink-muted">
                      {p.target_type}
                    </span>
                    {p.builtin
                      ? <span className="ml-auto text-[9px] text-phos">BUILT-IN</span>
                      : (
                        <button onClick={(e) => { e.stopPropagation(); void deletePreset(p); }}
                                className="ml-auto text-[10px] text-ink-dim hover:text-danger"
                                title="Delete user preset">✕</button>
                      )}
                  </div>
                  <div className="text-[11px] text-ink-muted mt-1 line-clamp-2">{p.description}</div>
                  <div className="text-[10px] text-ink-dim mt-1">
                    {p.step_count} step{p.step_count === 1 ? "" : "s"} · {p.author}
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={() => setShowBuilder(true)}
                  className="mt-2 px-2 py-1.5 rounded border border-divider text-[12px]
                             text-ink-primary hover:border-accent hover:text-accent">
            + Build Custom Preset
          </button>
        </div>

        {/* ── RIGHT: runner ──────────────────────────────────────────── */}
        <div className="col-span-8 flex flex-col min-h-0">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-ink-dim italic
                            border border-divider rounded">
              Select a preset on the left to configure a run.
            </div>
          ) : (
            <>
              {/* Header: name + counts */}
              <div className="bg-bg-card border border-divider rounded p-3 mb-2">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[13px] font-bold text-ink-primary">{selected.name}</span>
                  <span className="text-[10px] text-ink-dim">{selected.description}</span>
                  <span className="ml-auto flex gap-2 text-[11px]">
                    {ALL_SEV.map((sev) => sevCounts[sev] > 0 && (
                      <span key={sev} className={"flex items-center gap-1 " + SEV_STYLES[sev].text}>
                        <span className={"inline-block w-2 h-2 rounded-full " + SEV_STYLES[sev].dot} />
                        {sevCounts[sev]}
                      </span>
                    ))}
                  </span>
                </div>
                {/* Target + auth + start/stop */}
                <div className="flex items-center gap-2">
                  <input value={target} onChange={(e) => setTarget(e.target.value)}
                         disabled={running}
                         placeholder={selected.target_type === "url"
                           ? "https://target.example.com"
                           : "target.example.com / 1.2.3.4 / 10.0.0.0/24"}
                         className="flex-1 bg-bg-base border border-divider rounded px-2 py-1.5
                                    text-[12px] font-mono focus:outline-none focus:border-accent" />
                  <label className="flex items-center gap-1 text-[11px] text-ink-muted cursor-pointer">
                    <input type="checkbox" checked={authorized}
                           onChange={(e) => setAuthorized(e.target.checked)}
                           disabled={running} />
                    I have authorization to test this target
                  </label>
                  {!running ? (
                    <button onClick={start}
                            disabled={!target.trim() || !authorized}
                            className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                                       disabled:opacity-40 disabled:cursor-not-allowed">
                      Start
                    </button>
                  ) : (
                    <button onClick={stop}
                            className="px-3 py-1.5 rounded bg-bg-base border border-danger
                                       text-danger text-[12px]">
                      Stop
                    </button>
                  )}
                </div>
                {/* Progress bar */}
                {stepStates.length > 0 && (
                  <div className="mt-2">
                    <div className="h-1 bg-bg-base border border-divider rounded overflow-hidden">
                      <div className="h-full bg-accent transition-all"
                           style={{ width: `${progressPct}%` }} />
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-ink-dim mt-1">
                      <span>{doneSteps}/{totalSteps} steps</span>
                      {doneSummary && <span className="text-phos">{doneSummary}</span>}
                      {wsError && <span className="text-danger">⚠ {wsError}</span>}
                    </div>
                  </div>
                )}
              </div>

              {/* Steps + findings split */}
              <div className="flex-1 min-h-0 grid grid-cols-12 gap-2">
                {/* Steps */}
                <div className="col-span-5 bg-bg-card border border-divider rounded p-2
                                overflow-y-auto">
                  <div className="text-[10px] text-ink-muted tracking-wider mb-1">STEPS</div>
                  {stepStates.map((s) => (
                    <div key={s.id} className="py-1.5 border-b border-divider last:border-b-0">
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className={"w-4 text-center " + STATUS_COLOR[s.status]}>
                          {STATUS_ICON[s.status]}
                        </span>
                        <span className="font-mono text-ink-primary">{s.id}</span>
                        <span className="text-[10px] text-ink-dim">{s.tool}</span>
                        {s.elapsed !== undefined && (
                          <span className="ml-auto text-[10px] text-ink-dim tabular-nums">
                            {s.elapsed}s
                          </span>
                        )}
                      </div>
                      {s.progress && s.status === "running" && (
                        <div className="text-[10px] text-ink-muted ml-6">{s.progress}</div>
                      )}
                      {s.detail && (
                        <div className="text-[10px] text-danger ml-6">⚠ {s.detail}</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Findings */}
                <div className="col-span-7 bg-bg-card border border-divider rounded p-2
                                overflow-y-auto">
                  <div className="text-[10px] text-ink-muted tracking-wider mb-1">
                    FINDINGS ({findings.length})
                  </div>
                  {findings.length === 0 && (
                    <div className="text-[11px] text-ink-dim italic">
                      No findings yet — start a run.
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {findings.map((f, i) => (
                      <div key={i} className={"rounded border p-1.5 " + SEV_STYLES[f.severity].bg}>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className={"inline-block w-1.5 h-1.5 rounded-full " + SEV_STYLES[f.severity].dot} />
                          <span className={"font-bold uppercase tracking-wider text-[10px] " + SEV_STYLES[f.severity].text}>
                            {f.severity}
                          </span>
                          <span className="text-ink-primary font-bold">{f.title}</span>
                          <span className="ml-auto text-[9px] text-ink-dim font-mono">{f.step}</span>
                        </div>
                        {f.detail && (
                          <div className="text-[11px] text-ink-muted mt-0.5">{f.detail}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Custom preset builder (minimal JSON editor for v1) ──────── */}
      {showBuilder && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-bg-card border border-divider rounded p-4 w-[640px] max-h-[80vh] flex flex-col">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-[13px] font-bold text-ink-primary">BUILD CUSTOM PRESET</h3>
              <button onClick={() => { setShowBuilder(false); setBuilderError(""); }}
                      className="ml-auto text-[11px] text-ink-dim hover:text-ink-primary">close</button>
            </div>
            <p className="text-[11px] text-ink-muted mb-2">
              Paste a preset JSON. The schema is the same as built-in <code className="text-amber">.mhp</code> files;
              drag-and-drop builder is on the roadmap.
            </p>
            <textarea value={builderJson}
                      onChange={(e) => setBuilderJson(e.target.value)}
                      spellCheck={false}
                      placeholder='{"id":"my_recon","name":"My Recon","target_type":"domain","steps":[{"id":"w","tool":"whois"}]}'
                      className="flex-1 min-h-[280px] bg-bg-base border border-divider rounded p-2
                                 text-[11px] font-mono text-ink-primary
                                 focus:outline-none focus:border-accent" />
            {builderError && (
              <div className="text-[11px] text-danger mt-1">⚠ {builderError}</div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <button onClick={saveCustom} disabled={!builderJson.trim()}
                      className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                                 disabled:opacity-40 disabled:cursor-not-allowed">
                Save
              </button>
              <button onClick={() => { setShowBuilder(false); setBuilderError(""); }}
                      className="px-3 py-1.5 rounded border border-divider text-[12px] text-ink-primary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
