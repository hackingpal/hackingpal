import { useEffect, useMemo, useRef, useState } from "react";
import { api, authFetch, openWs } from "../api";

// ── Types ────────────────────────────────────────────────────────────────────

type PresetSummary = {
  id: string; name: string; description: string;
  target_type: string; author: string;
  category: string;
  mode_required: string;
  risk_level: "passive" | "low" | "medium" | "high" | "critical";
  estimated_duration: string;
  requires_auth: boolean;
  stop_on_critical: boolean;
  report_template: string;
  step_count: number;
  phase_count: number;
  schema: "v1" | "v2";
  builtin: boolean;
};

type V1Step = {
  id: string; tool: string;
  display_name?: string;
  options?: Record<string, unknown>;
  rationale?: string; success?: string; approval?: boolean;
};

type V2Step = V1Step & {
  output_keys?: string[];
  feed_to?: string[];
  condition?: string | null;
  on_finding?: "continue" | "pause" | "stop" | null;
};

type V2Phase = {
  id: number; name: string; description?: string;
  rate_limit?: number;
  condition?: string | null;
  steps: V2Step[];
};

type PresetFull = PresetSummary & {
  steps?: V1Step[];
  phases?: V2Phase[];
};

type Severity = "critical" | "high" | "medium" | "low" | "info";
const ALL_SEV: Severity[] = ["critical", "high", "medium", "low", "info"];

type Finding = {
  step: string; tool: string; severity: Severity;
  title: string; detail: string;
  ts: number;
  auto_promoted?: boolean;
};

type StepStatus = "pending" | "running" | "ok" | "error" | "stopped" | "skipped";

type StepState = {
  id: string; tool: string; phase?: number;
  status: StepStatus;
  elapsed?: number;
  detail?: string;
  progress?: string;
  summary?: Record<string, unknown>;
  display_name?: string;
};

type PhaseStatus = "pending" | "running" | "done" | "skipped";

type PhaseState = {
  id: number; name: string; status: PhaseStatus;
  findings: number;
  duration_seconds?: number;
  step_count: number;
};

// ── Style maps ───────────────────────────────────────────────────────────────

const SEV_STYLES: Record<Severity, { dot: string; text: string; bg: string; border: string }> = {
  critical: { dot: "bg-red-500",    text: "text-red-500",    bg: "bg-red-500/15",    border: "border-red-500/40" },
  high:     { dot: "bg-orange-500", text: "text-orange-500", bg: "bg-orange-500/15", border: "border-orange-500/40" },
  medium:   { dot: "bg-yellow-500", text: "text-yellow-500", bg: "bg-yellow-500/15", border: "border-yellow-500/40" },
  low:      { dot: "bg-blue-400",   text: "text-blue-400",   bg: "bg-blue-400/15",   border: "border-blue-400/30" },
  info:     { dot: "bg-gray-400",   text: "text-gray-400",   bg: "bg-gray-400/10",   border: "border-divider" },
};

const RISK_STYLES: Record<PresetSummary["risk_level"], { text: string; border: string; label: string }> = {
  passive:  { text: "text-gray-400",   border: "border-gray-400/40",   label: "PASSIVE" },
  low:      { text: "text-green-400",  border: "border-green-400/40",  label: "LOW" },
  medium:   { text: "text-yellow-400", border: "border-yellow-400/40", label: "MEDIUM" },
  high:     { text: "text-orange-400", border: "border-orange-400/40", label: "HIGH" },
  critical: { text: "text-red-500",    border: "border-red-500/40",    label: "CRITICAL" },
};

const STATUS_ICON: Record<StepStatus, string> = {
  pending: "○", running: "◐", ok: "●",
  error: "✕", stopped: "■", skipped: "⤳",
};

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: "text-ink-dim", running: "text-amber", ok: "text-phos",
  error: "text-danger", stopped: "text-ink-muted", skipped: "text-ink-muted",
};

const PHASE_STATUS_DOT: Record<PhaseStatus, string> = {
  pending: "bg-ink-dim",
  running: "bg-amber animate-pulse",
  done:    "bg-phos",
  skipped: "bg-ink-muted",
};

// ── Component ────────────────────────────────────────────────────────────────

export default function Presets() {
  const [library, setLibrary] = useState<PresetSummary[]>([]);
  const [selected, setSelected] = useState<PresetFull | null>(null);
  const [target, setTarget] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [running, setRunning] = useState(false);
  const [stepStates, setStepStates] = useState<StepState[]>([]);
  const [phaseStates, setPhaseStates] = useState<PhaseState[]>([]);
  const [activePhase, setActivePhase] = useState<number | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [doneSummary, setDoneSummary] = useState("");
  const [wsError, setWsError] = useState("");
  const [pausedFinding, setPausedFinding] = useState<Finding | null>(null);
  const [sortBySev, setSortBySev] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);

  const [showBuilder, setShowBuilder] = useState(false);
  const [builderJson, setBuilderJson] = useState<string>("");
  const [builderError, setBuilderError] = useState("");

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async function refreshLibrary() {
    try {
      const r = await api<{ presets: PresetSummary[]; tools: string[] }>("/presets");
      setLibrary(r.presets);
    } catch (e) {
      setWsError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void refreshLibrary(); }, []);

  // Close any in-flight run on unmount.
  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  async function select(p: PresetSummary) {
    try {
      const full = await api<PresetFull>(`/presets/${encodeURIComponent(p.id)}`);
      setSelected(full);
      initRunState(full);
      setFindings([]);
      setDoneSummary("");
      setWsError("");
      setPausedFinding(null);
    } catch (e) {
      setWsError(e instanceof Error ? e.message : String(e));
    }
  }

  function initRunState(full: PresetFull) {
    if (full.phases?.length) {
      const phases = full.phases.map((ph): PhaseState => ({
        id: ph.id, name: ph.name, status: "pending",
        findings: 0, step_count: ph.steps.length,
      }));
      setPhaseStates(phases);
      setActivePhase(phases[0]?.id ?? null);
      const steps = full.phases.flatMap((ph) => ph.steps.map((s): StepState => ({
        id: s.id, tool: s.tool, phase: ph.id, status: "pending",
        display_name: s.display_name,
      })));
      setStepStates(steps);
    } else {
      setPhaseStates([]);
      setActivePhase(null);
      const steps = (full.steps ?? []).map((s): StepState => ({
        id: s.id, tool: s.tool, status: "pending",
        display_name: s.display_name,
      }));
      setStepStates(steps);
    }
  }

  // ── WS ────────────────────────────────────────────────────────────────────

  function start() {
    if (!selected || !target.trim() || !authorized || running) return;
    setWsError("");
    setRunning(true);
    setDoneSummary("");
    setFindings([]);
    setPausedFinding(null);
    initRunState(selected);

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
    ws.onerror = () => setWsError("WebSocket error");
    ws.onclose = () => {
      setRunning(false);
      wsRef.current = null;
    };
  }

  function sendAction(action: "stop" | "continue") {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ action })); } catch { /* ignore */ }
    if (action === "continue") setPausedFinding(null);
  }

  // ── Event router ──────────────────────────────────────────────────────────

  function handleEvent(ev: any) {
    const t = ev.type;
    if (t === "preset_start") {
      // initialized in start()
    } else if (t === "phase_start") {
      const pid: number = ev.phase;
      setActivePhase(pid);
      setPhaseStates((ps) => ps.map((p) =>
        p.id === pid ? { ...p, status: "running" } : p));
    } else if (t === "phase_complete") {
      const pid: number = ev.phase;
      setPhaseStates((ps) => ps.map((p) =>
        p.id === pid ? {
          ...p, status: "done",
          findings: ev.findings ?? p.findings,
          duration_seconds: ev.duration_seconds,
        } : p));
    } else if (t === "phase_skipped") {
      const pid: number = ev.phase;
      setPhaseStates((ps) => ps.map((p) =>
        p.id === pid ? { ...p, status: "skipped" } : p));
    } else if (t === "step_start") {
      setStepStates((s) => s.map((x) =>
        x.id === ev.step ? { ...x, status: "running" } : x));
    } else if (t === "step_progress") {
      setStepStates((s) => s.map((x) =>
        x.id === ev.step ? { ...x, progress: ev.msg } : x));
    } else if (t === "step_result") {
      setStepStates((s) => s.map((x) =>
        x.id === ev.step ? { ...x, summary: ev.summary } : x));
    } else if (t === "step_skipped") {
      setStepStates((s) => s.map((x) =>
        x.id === ev.step ? { ...x, status: "skipped", detail: ev.reason } : x));
    } else if (t === "step_done") {
      setStepStates((s) => s.map((x) =>
        x.id === ev.step ? {
          ...x, status: ev.status as StepStatus,
          elapsed: ev.elapsed, detail: ev.detail,
        } : x));
    } else if (t === "finding") {
      const sev: Severity = (ALL_SEV as string[]).includes(ev.severity)
        ? ev.severity as Severity : "info";
      const f: Finding = {
        step: ev.step || "", tool: ev.tool || "",
        severity: sev, title: ev.title || "",
        detail: ev.detail || "", ts: Date.now(),
        auto_promoted: ev.auto_promoted,
      };
      setFindings((cur) => [...cur, f]);
    } else if (t === "critical_finding") {
      const sev: Severity = "critical";
      const inner = ev.finding || {};
      const f: Finding = {
        step: inner.step || ev.step || "", tool: inner.tool || "",
        severity: sev, title: inner.title || "Critical finding",
        detail: inner.detail || "", ts: Date.now(),
        auto_promoted: true,
      };
      setPausedFinding(f);
    } else if (t === "done") {
      setDoneSummary(
        `Completed in ${ev.elapsed}s · ${ev.findings_total} findings`
        + (ev.stopped ? " (stopped)" : ""),
      );
    } else if (t === "error") {
      setWsError(ev.detail || "engine error");
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const sevCounts = useMemo(() => {
    const c: Record<Severity, number> = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
    };
    for (const f of findings) c[f.severity] = (c[f.severity] || 0) + 1;
    return c;
  }, [findings]);

  const totalSteps = stepStates.length || 1;
  const doneSteps = stepStates.filter((s) =>
    s.status === "ok" || s.status === "error"
    || s.status === "stopped" || s.status === "skipped").length;
  const progressPct = Math.round((doneSteps / totalSteps) * 100);

  const sortedFindings = useMemo(() => {
    if (!sortBySev) return [...findings].sort((a, b) => b.ts - a.ts);
    const rank = (s: Severity) => ALL_SEV.indexOf(s);
    return [...findings].sort((a, b) => {
      const r = rank(a.severity) - rank(b.severity);
      return r !== 0 ? r : b.ts - a.ts;
    });
  }, [findings, sortBySev]);

  const stepsForActivePhase = useMemo(() => {
    if (activePhase == null) return stepStates;
    return stepStates.filter((s) => s.phase === activePhase);
  }, [stepStates, activePhase]);

  // ── Persistence (custom presets) ──────────────────────────────────────────

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

  const isV2 = !!selected?.phases?.length;

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 pt-4 pb-2">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">PLAYBOOKS</h2>
        <p className="text-[11px] text-ink-dim">
          Multi-phase assessments with feed-forward, conditions, and auto-promoted
          findings. Built-ins are read-only; save your own via{" "}
          <span className="text-amber">Build Custom Preset</span>.
        </p>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-12 gap-3 px-4 pb-3 overflow-hidden">

        {/* ── LEFT: library ──────────────────────────────────────────── */}
        <div className="col-span-3 flex flex-col min-h-0">
          <div className="text-[11px] text-ink-muted tracking-wider mb-1">LIBRARY</div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            {library.length === 0 && (
              <div className="text-[12px] text-ink-dim italic">No presets yet.</div>
            )}
            {library.map((p) => {
              const isSel = selected?.id === p.id;
              const rs = RISK_STYLES[p.risk_level] ?? RISK_STYLES.low;
              return (
                <div key={p.id}
                     onClick={() => void select(p)}
                     className={"border rounded p-2 cursor-pointer transition-colors " +
                       (isSel
                         ? "bg-bg-card border-accent"
                         : "bg-bg-card border-divider hover:border-ink-muted")}>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-ink-primary truncate">{p.name}</span>
                    {p.builtin
                      ? <span className="ml-auto text-[9px] text-phos shrink-0">BUILT-IN</span>
                      : (
                        <button onClick={(e) => { e.stopPropagation(); void deletePreset(p); }}
                                className="ml-auto text-[10px] text-ink-dim hover:text-danger"
                                title="Delete user preset">✕</button>
                      )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className={"text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border " + rs.border + " " + rs.text}>
                      {rs.label}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-divider text-ink-muted">
                      {p.target_type}
                    </span>
                    {p.schema === "v2" && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent/40 text-accent">
                        {p.phase_count}Φ
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-muted mt-1 line-clamp-2">{p.description}</div>
                  <div className="text-[10px] text-ink-dim mt-1">
                    {p.step_count} step{p.step_count === 1 ? "" : "s"}
                    {p.estimated_duration && <> · ~{p.estimated_duration}</>}
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

        {/* ── MIDDLE: runner ─────────────────────────────────────────── */}
        <div className="col-span-6 flex flex-col min-h-0">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-ink-dim italic
                            border border-divider rounded">
              Select a preset on the left to configure a run.
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="bg-bg-card border border-divider rounded p-3 mb-2">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-[13px] font-bold text-ink-primary">{selected.name}</span>
                  {(() => {
                    const rs = RISK_STYLES[selected.risk_level] ?? RISK_STYLES.low;
                    return (
                      <span className={"text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border " + rs.border + " " + rs.text}>
                        {rs.label}
                      </span>
                    );
                  })()}
                  {selected.estimated_duration && (
                    <span className="text-[10px] text-ink-dim">~{selected.estimated_duration}</span>
                  )}
                </div>
                <div className="text-[11px] text-ink-muted mb-2">{selected.description}</div>
                <div className="flex items-center gap-2">
                  <input value={target} onChange={(e) => setTarget(e.target.value)}
                         disabled={running}
                         placeholder={selected.target_type === "url"
                           ? "https://target.example.com"
                           : selected.target_type === "ip" ? "10.0.0.1"
                           : selected.target_type === "cidr" ? "10.0.0.0/24"
                           : "target.example.com"}
                         className="flex-1 bg-bg-base border border-divider rounded px-2 py-1.5
                                    text-[12px] font-mono focus:outline-none focus:border-accent" />
                  <label className="flex items-center gap-1 text-[11px] text-ink-muted cursor-pointer">
                    <input type="checkbox" checked={authorized}
                           onChange={(e) => setAuthorized(e.target.checked)}
                           disabled={running} />
                    Authorized
                  </label>
                  {!running ? (
                    <button onClick={start}
                            disabled={!target.trim() || !authorized}
                            className="px-3 py-1.5 rounded border border-accent text-[12px]
                                       text-accent hover:bg-accent hover:text-bg-base disabled:opacity-40">
                      Run
                    </button>
                  ) : (
                    <button onClick={() => sendAction("stop")}
                            className="px-3 py-1.5 rounded border border-danger text-[12px]
                                       text-danger hover:bg-danger hover:text-bg-base">
                      Stop
                    </button>
                  )}
                </div>
                {(running || doneSummary) && (
                  <div className="mt-2">
                    <div className="h-1 bg-bg-base rounded overflow-hidden">
                      <div className="h-full bg-accent transition-all"
                           style={{ width: `${progressPct}%` }} />
                    </div>
                    <div className="text-[10px] text-ink-dim mt-1">
                      {doneSummary || `${doneSteps}/${totalSteps} steps`}
                    </div>
                  </div>
                )}
              </div>

              {/* Critical-finding pause banner */}
              {pausedFinding && (
                <div className={"border rounded p-3 mb-2 " + SEV_STYLES.critical.bg + " " + SEV_STYLES.critical.border}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={"inline-block w-2 h-2 rounded-full " + SEV_STYLES.critical.dot} />
                    <span className={"text-[11px] font-bold uppercase tracking-wider " + SEV_STYLES.critical.text}>
                      Critical finding — paused
                    </span>
                  </div>
                  <div className="text-[12px] text-ink-primary mb-1">{pausedFinding.title}</div>
                  <div className="text-[10px] text-ink-muted mb-2 font-mono break-all">{pausedFinding.detail}</div>
                  <div className="flex gap-2">
                    <button onClick={() => sendAction("continue")}
                            className="px-3 py-1 rounded border border-phos text-[11px] text-phos hover:bg-phos hover:text-bg-base">
                      Continue
                    </button>
                    <button onClick={() => sendAction("stop")}
                            className="px-3 py-1 rounded border border-danger text-[11px] text-danger hover:bg-danger hover:text-bg-base">
                      Stop
                    </button>
                  </div>
                </div>
              )}

              {/* Phase tabs (v2 only) */}
              {isV2 && phaseStates.length > 0 && (
                <div className="flex items-center gap-1 mb-2 border-b border-divider overflow-x-auto pb-1">
                  {phaseStates.map((ph) => {
                    const isActive = activePhase === ph.id;
                    return (
                      <button key={ph.id}
                              onClick={() => setActivePhase(ph.id)}
                              className={"flex items-center gap-1.5 px-2 py-1 rounded-t text-[11px] " +
                                "border-b-2 transition shrink-0 " +
                                (isActive
                                  ? "border-accent text-ink-primary"
                                  : "border-transparent text-ink-muted hover:text-ink-primary")}>
                        <span className={"inline-block w-1.5 h-1.5 rounded-full " + PHASE_STATUS_DOT[ph.status]} />
                        <span className="font-bold">P{ph.id}</span>
                        <span className="truncate max-w-[120px]">{ph.name}</span>
                        {ph.findings > 0 && (
                          <span className="text-[9px] px-1 rounded bg-accent/20 text-accent">
                            {ph.findings}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Steps list */}
              <div className="flex-1 min-h-0 overflow-y-auto bg-bg-card border border-divider rounded p-2">
                {stepsForActivePhase.length === 0 && (
                  <div className="text-[11px] text-ink-dim italic text-center py-4">
                    {isV2 ? "No steps in this phase." : "No steps."}
                  </div>
                )}
                {stepsForActivePhase.map((s) => (
                  <div key={s.id} className="flex items-start gap-2 py-1.5 border-b border-divider/50 last:border-b-0">
                    <span className={"font-mono text-[14px] leading-none mt-0.5 " + STATUS_COLOR[s.status]}>
                      {STATUS_ICON[s.status]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-ink-primary">
                          {s.display_name || s.id}
                        </span>
                        <span className="text-[10px] font-mono text-ink-dim">{s.tool}</span>
                        {s.elapsed != null && (
                          <span className="ml-auto text-[10px] text-ink-dim font-mono">{s.elapsed}s</span>
                        )}
                      </div>
                      {s.progress && s.status === "running" && (
                        <div className="text-[10px] text-amber mt-0.5">{s.progress}</div>
                      )}
                      {s.detail && (
                        <div className="text-[10px] text-danger mt-0.5 font-mono break-words">{s.detail}</div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Phase summary row */}
                {isV2 && activePhase != null && (() => {
                  const ph = phaseStates.find((p) => p.id === activePhase);
                  if (!ph || (ph.status !== "done" && ph.status !== "skipped")) return null;
                  return (
                    <div className="mt-2 pt-2 border-t border-divider text-[10px] text-ink-muted italic">
                      Phase {ph.id} {ph.status === "skipped" ? "skipped" : `complete`}
                      {ph.status === "done" && <> — {ph.findings} finding{ph.findings === 1 ? "" : "s"}, {ph.duration_seconds}s</>}
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>

        {/* ── RIGHT: findings panel ──────────────────────────────────── */}
        <div className="col-span-3 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] text-ink-muted tracking-wider">FINDINGS</div>
            <button onClick={() => setSortBySev((v) => !v)}
                    className="text-[10px] text-ink-dim hover:text-ink-primary">
              {sortBySev ? "sort: severity" : "sort: newest"}
            </button>
          </div>
          {/* Severity counters */}
          <div className="flex gap-2 mb-2 text-[11px]">
            {ALL_SEV.map((sev) => sevCounts[sev] > 0 && (
              <span key={sev} className={"flex items-center gap-1 " + SEV_STYLES[sev].text}>
                <span className={"inline-block w-2 h-2 rounded-full " + SEV_STYLES[sev].dot} />
                {sevCounts[sev]}
              </span>
            ))}
            {findings.length === 0 && (
              <span className="text-[11px] text-ink-dim italic">none yet</span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            {sortedFindings.map((f, i) => {
              const ss = SEV_STYLES[f.severity];
              return (
                <div key={i} className={"border rounded p-2 " + ss.bg + " " + ss.border}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={"text-[9px] uppercase tracking-wider font-bold " + ss.text}>
                      {f.severity}
                    </span>
                    {f.tool && (
                      <span className="text-[9px] font-mono text-ink-dim">{f.tool}</span>
                    )}
                    {f.auto_promoted && (
                      <span className="ml-auto text-[8px] text-ink-dim uppercase">auto</span>
                    )}
                  </div>
                  <div className="text-[12px] text-ink-primary">{f.title}</div>
                  {f.detail && (
                    <div className="text-[10px] text-ink-muted mt-0.5 font-mono break-all line-clamp-2">
                      {f.detail}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {wsError && (
        <div className="px-4 pb-2 text-[11px] text-danger">{wsError}</div>
      )}

      {/* Builder modal */}
      {showBuilder && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6"
             onClick={() => setShowBuilder(false)}>
          <div className="bg-bg-card border border-divider rounded p-4 max-w-2xl w-full"
               onClick={(e) => e.stopPropagation()}>
            <div className="text-[13px] font-bold text-ink-primary mb-2">Build Custom Preset</div>
            <div className="text-[11px] text-ink-muted mb-2">
              Paste a valid `.mhp` JSON definition. Supports both v1 (flat steps)
              and v2 (phases) schemas.
            </div>
            <textarea value={builderJson}
                      onChange={(e) => setBuilderJson(e.target.value)}
                      rows={16}
                      className="w-full bg-bg-base border border-divider rounded p-2
                                 text-[11px] font-mono focus:outline-none focus:border-accent"
                      placeholder='{"id":"my_preset","name":"...","target_type":"domain","steps":[...]}' />
            {builderError && (
              <div className="text-[11px] text-danger mt-1">{builderError}</div>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setShowBuilder(false)}
                      className="px-3 py-1.5 rounded border border-divider text-[12px] text-ink-muted">
                Cancel
              </button>
              <button onClick={() => void saveCustom()}
                      className="px-3 py-1.5 rounded border border-accent text-[12px] text-accent hover:bg-accent hover:text-bg-base">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
