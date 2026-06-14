/**
 * Self-Assess — paste an app target, get a baseline security check + an
 * AI-tailored playbook.
 *
 * Two flows:
 *   1. "Run baseline check" — runs the built-in `baseline_home_app` preset
 *      via /ws/preset-run, streams findings live. Safe in Lab mode.
 *   2. "Get AI plan" — POSTs to /triage, renders the recommended playbook
 *      as a readable card stack. "Save as my playbook" hands it to the
 *      existing Presets store so the user can run it from the Playbooks
 *      page with the full streaming UI.
 *
 * The page is engagement-aware: if an engagement is active, both flows
 * scope-check through the same path the rest of the app uses.
 */
import { useEffect, useRef, useState } from "react";
import { api, authFetch, openWs, parseError } from "../api";

type TargetKind = "web_app" | "api" | "network_host" | "iot" | "unknown";
type Exposure   = "localhost" | "lan" | "public" | "unknown";

type ProbeSummary = {
  canonical_target: string;
  resolved_ips: string[];
  http_status: number | null;
  http_server: string | null;
  http_powered_by: string | null;
  http_redirect: string | null;
  security_headers_present: string[];
  security_headers_missing: string[];
  cms_hint: string | null;
  tls_version: string | null;
  tls_cert_cn: string | null;
  tls_cert_expiry: string | null;
  tls_alpn: string | null;
  elapsed_ms: number;
};

type RecommendedStep = {
  id: string;
  tool: string;
  rationale: string;
  success: string;
  approval: boolean;
  options: Record<string, unknown>;
};

type RecommendedPlaybook = {
  id: string;
  name: string;
  description: string;
  category: string;
  target_type: string;
  mode_required: string;
  author: string;
  steps: RecommendedStep[];
};

type TriageResponse = {
  probe: ProbeSummary;
  narrative: string;
  severity_guess: "low" | "medium" | "high";
  severity_reason: string;
  playbook: RecommendedPlaybook;
};

type Severity = "critical" | "high" | "medium" | "low" | "info";

type Finding = {
  step: string;
  tool: string;
  severity: Severity;
  title: string;
  detail: string;
  ts: number;
};

type StepStatus = "pending" | "running" | "ok" | "error" | "stopped" | "skipped";

type LiveStep = {
  id: string;
  tool: string;
  status: StepStatus;
  detail?: string;
  progress?: string;
};

const SEV_DOT: Record<Severity, string> = {
  critical: "bg-red-500",
  high:     "bg-orange-500",
  medium:   "bg-yellow-500",
  low:      "bg-blue-400",
  info:     "bg-gray-400",
};

const SEV_TEXT: Record<Severity, string> = {
  critical: "text-red-500",
  high:     "text-orange-500",
  medium:   "text-yellow-500",
  low:      "text-blue-400",
  info:     "text-ink-muted",
};

const SEV_BORDER: Record<TriageResponse["severity_guess"], string> = {
  low:    "border-blue-400/40",
  medium: "border-yellow-500/40",
  high:   "border-orange-500/40",
};

const STATUS_ICON: Record<StepStatus, string> = {
  pending: "○",
  running: "◐",
  ok: "●",
  error: "✕",
  stopped: "■",
  skipped: "⤳",
};

const BASELINE_PRESET_ID = "baseline_home_app";

type Props = { onJumpTo: (id: string) => void };

export default function SelfAssess({ onJumpTo }: Props) {
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<TargetKind>("web_app");
  const [exposure, setExposure] = useState<Exposure>("localhost");
  const [stackHints, setStackHints] = useState("");
  const [notes, setNotes] = useState("");
  const [authorized, setAuthorized] = useState(false);

  // Baseline run state
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<LiveStep[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [doneSummary, setDoneSummary] = useState("");
  const [wsError, setWsError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  // AI triage state
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageError, setTriageError] = useState("");
  const [triage, setTriage] = useState<TriageResponse | null>(null);
  const [savedAs, setSavedAs] = useState<string | null>(null);

  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  function reset() {
    setSteps([]);
    setFindings([]);
    setDoneSummary("");
    setWsError("");
    setTriage(null);
    setTriageError("");
    setSavedAs(null);
  }

  // ── Baseline preset run ──────────────────────────────────────────────────

  function startBaseline() {
    if (!target.trim() || !authorized || running) return;
    reset();
    setRunning(true);

    const ws = openWs("/ws/preset-run");
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({
        preset: BASELINE_PRESET_ID,
        target: target.trim(),
        authorized: true,
        confirm: true, // self-assess flow already confirmed via the checkbox above
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

  function stopBaseline() {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ action: "stop" })); } catch { /* ignore */ }
    }
  }

  function handleEvent(ev: any) {
    const t = ev.type;
    if (t === "preset_start") {
      const incoming: LiveStep[] = (ev.steps ?? []).map((s: any) => ({
        id: s.id, tool: s.tool, status: "pending" as StepStatus,
      }));
      if (incoming.length) setSteps(incoming);
    } else if (t === "step_start") {
      setSteps((s) => s.map((x) =>
        x.id === ev.step ? { ...x, status: "running" } : x));
    } else if (t === "step_progress") {
      setSteps((s) => s.map((x) =>
        x.id === ev.step ? { ...x, progress: ev.msg } : x));
    } else if (t === "step_done") {
      setSteps((s) => s.map((x) =>
        x.id === ev.step
          ? { ...x, status: ev.status as StepStatus, detail: ev.detail }
          : x));
    } else if (t === "step_skipped") {
      setSteps((s) => s.map((x) =>
        x.id === ev.step ? { ...x, status: "skipped", detail: ev.reason } : x));
    } else if (t === "finding") {
      const sev: Severity = (["critical", "high", "medium", "low", "info"] as Severity[])
        .includes(ev.severity) ? ev.severity : "info";
      setFindings((cur) => [...cur, {
        step: ev.step || "", tool: ev.tool || "", severity: sev,
        title: ev.title || "", detail: ev.detail || "", ts: Date.now(),
      }]);
    } else if (t === "done") {
      setDoneSummary(
        `Done in ${ev.elapsed ?? "?"}s · ${ev.findings_total ?? findings.length} findings`
        + (ev.stopped ? " (stopped)" : ""),
      );
    } else if (t === "error" || ev.error) {
      setWsError(ev.detail || ev.error || "preset run failed");
    }
  }

  // ── AI triage ────────────────────────────────────────────────────────────

  async function runTriage() {
    if (!target.trim() || triageLoading) return;
    setTriageLoading(true);
    setTriageError("");
    setTriage(null);
    setSavedAs(null);
    try {
      const res = await api<TriageResponse>("/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: target.trim(),
          kind,
          exposure,
          stack_hints: stackHints.trim(),
          notes: notes.trim(),
        }),
        timeoutMs: 90_000,
      });
      setTriage(res);
    } catch (e) {
      setTriageError(e instanceof Error ? e.message : String(e));
    } finally {
      setTriageLoading(false);
    }
  }

  async function savePlaybook() {
    if (!triage) return;
    setSavedAs(null);
    try {
      const r = await authFetch("/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: triage.playbook.id,
          name: triage.playbook.name,
          description: triage.playbook.description,
          target_type: triage.playbook.target_type,
          steps: triage.playbook.steps.map((s) => ({
            id: s.id,
            tool: s.tool,
            rationale: s.rationale,
            success: s.success,
            approval: s.approval,
            options: s.options,
          })),
        }),
      });
      if (!r.ok) {
        setTriageError(await parseError(r));
        return;
      }
      const body = await r.json();
      setSavedAs(body.id || triage.playbook.id);
    } catch (e) {
      setTriageError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const canRun = target.trim().length > 0 && authorized && !running;
  const canTriage = target.trim().length > 0 && !triageLoading;

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-4">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">
          SELF-ASSESS
        </h2>
        <p className="text-[11px] text-ink-dim mt-1 max-w-3xl leading-relaxed">
          For apps you own. Paste a target, tell the copilot what it is, and
          get a baseline security check plus an AI-tailored test plan.
          The baseline check is passive-plus-light and safe to run from Lab
          mode; the AI plan never auto-runs anything &mdash; every active step
          waits for your approval.
        </p>
      </header>

      {/* Intake form */}
      <section className="border border-divider rounded p-3 mb-4 bg-bg-card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[10px] uppercase tracking-wider text-ink-dim">
              Target (URL, hostname, or IP)
            </span>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="http://localhost:3000  ·  myapp.example.com  ·  192.168.1.50"
              className="bg-bg-base border border-divider px-2 py-1.5 text-[13px]
                         text-ink-primary font-mono rounded focus:outline-none
                         focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-dim">
              What is it?
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TargetKind)}
              className="bg-bg-base border border-divider px-2 py-1.5 text-[12px]
                         text-ink-primary rounded focus:outline-none focus:border-accent"
            >
              <option value="web_app">Web app</option>
              <option value="api">API / backend service</option>
              <option value="network_host">Network host / server</option>
              <option value="iot">IoT / device</option>
              <option value="unknown">Not sure</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-dim">
              Exposure
            </span>
            <select
              value={exposure}
              onChange={(e) => setExposure(e.target.value as Exposure)}
              className="bg-bg-base border border-divider px-2 py-1.5 text-[12px]
                         text-ink-primary rounded focus:outline-none focus:border-accent"
            >
              <option value="localhost">Localhost only</option>
              <option value="lan">LAN / home network</option>
              <option value="public">Public internet</option>
              <option value="unknown">Not sure</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[10px] uppercase tracking-wider text-ink-dim">
              Stack hints (optional)
            </span>
            <input
              value={stackHints}
              onChange={(e) => setStackHints(e.target.value)}
              placeholder="e.g. Next.js + Postgres + Auth0  ·  Django  ·  Express + Mongo"
              className="bg-bg-base border border-divider px-2 py-1.5 text-[12px]
                         text-ink-primary rounded focus:outline-none focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[10px] uppercase tracking-wider text-ink-dim">
              Notes for the copilot (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="anything special about this app — auth flow, sensitive endpoints, where to start"
              className="bg-bg-base border border-divider px-2 py-1.5 text-[12px]
                         text-ink-primary rounded focus:outline-none focus:border-accent
                         font-mono resize-y"
            />
          </label>

          <label className="flex items-start gap-2 col-span-2 text-[11px] text-ink-muted leading-snug">
            <input
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I&nbsp;own this target or have written authorization to test it.
              Baseline + AI plan will not run until this is checked.
            </span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={startBaseline}
            disabled={!canRun}
            className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Run baseline check
          </button>
          {running && (
            <button
              onClick={stopBaseline}
              className="px-3 py-1.5 rounded border border-danger text-danger text-[12px] font-bold"
            >
              Stop
            </button>
          )}
          <button
            onClick={runTriage}
            disabled={!canTriage}
            className="px-3 py-1.5 rounded border border-accent text-accent text-[12px] font-bold
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {triageLoading ? "Thinking…" : "Get AI plan"}
          </button>
        </div>
        {wsError && (
          <p className="text-[11px] text-danger mt-2">{wsError}</p>
        )}
      </section>

      {/* Baseline run live view */}
      {(steps.length > 0 || findings.length > 0 || doneSummary) && (
        <section className="border border-divider rounded p-3 mb-4 bg-bg-card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[12px] font-bold tracking-wider text-ink-primary">
              BASELINE CHECK
            </h3>
            {doneSummary && (
              <span className="text-[11px] text-ink-muted">{doneSummary}</span>
            )}
          </div>
          <ul className="text-[12px] font-mono text-ink-primary space-y-1">
            {steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="w-3 inline-block text-ink-muted">
                  {STATUS_ICON[s.status]}
                </span>
                <span className="w-32 inline-block">{s.tool}</span>
                <span className="text-ink-dim text-[11px] truncate">
                  {s.progress || s.detail || ""}
                </span>
              </li>
            ))}
          </ul>

          {findings.length > 0 && (
            <div className="mt-3 border-t border-divider pt-2">
              <h4 className="text-[10px] uppercase tracking-wider text-ink-dim mb-1.5">
                Findings ({findings.length})
              </h4>
              <ul className="space-y-1.5">
                {findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px]">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full inline-block shrink-0 ${SEV_DOT[f.severity]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className={`uppercase text-[9px] tracking-wider ${SEV_TEXT[f.severity]}`}>
                          {f.severity}
                        </span>
                        <span className="text-ink-dim text-[10px]">{f.tool}</span>
                      </div>
                      <div className="text-ink-primary">{f.title}</div>
                      {f.detail && (
                        <div className="text-ink-muted text-[11px] mt-0.5 whitespace-pre-wrap break-words">
                          {f.detail}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Triage error */}
      {triageError && (
        <section className="border border-danger/40 bg-red-500/10 rounded p-3 mb-4">
          <p className="text-[12px] text-danger">{triageError}</p>
        </section>
      )}

      {/* AI plan output */}
      {triage && (
        <section className={`border-2 rounded p-3 mb-4 bg-bg-card ${SEV_BORDER[triage.severity_guess]}`}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[12px] font-bold tracking-wider text-ink-primary">
              COPILOT PLAN
            </h3>
            <span className={`uppercase text-[10px] tracking-wider font-bold ${
              triage.severity_guess === "high" ? "text-orange-500"
              : triage.severity_guess === "medium" ? "text-yellow-500"
              : "text-blue-400"
            }`}>
              {triage.severity_guess} risk
            </span>
          </div>
          <p className="text-[12px] text-ink-primary leading-relaxed">
            {triage.narrative}
          </p>
          {triage.severity_reason && (
            <p className="text-[11px] text-ink-muted mt-1.5 italic">
              {triage.severity_reason}
            </p>
          )}

          {/* Probe summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3 text-[11px]">
            <ProbeKV label="Resolved IPs"
                     value={triage.probe.resolved_ips.join(", ") || "—"} />
            <ProbeKV label="HTTP status"
                     value={triage.probe.http_status !== null
                            ? String(triage.probe.http_status) : "—"} />
            <ProbeKV label="Server"
                     value={triage.probe.http_server || "—"} />
            <ProbeKV label="CMS / stack hint"
                     value={triage.probe.cms_hint || triage.probe.http_powered_by || "—"} />
            <ProbeKV label="TLS"
                     value={triage.probe.tls_version || "no TLS"} />
            <ProbeKV label="Missing headers"
                     value={triage.probe.security_headers_missing.length
                            ? `${triage.probe.security_headers_missing.length} of 6`
                            : "0 of 6"} />
          </div>

          {/* Recommended steps as approval cards */}
          <div className="mt-4">
            <h4 className="text-[10px] uppercase tracking-wider text-ink-dim mb-2">
              Recommended next checks ({triage.playbook.steps.length})
            </h4>
            <ul className="space-y-2">
              {triage.playbook.steps.map((s, idx) => (
                <li key={s.id}
                    className="border border-divider rounded p-2.5 bg-bg-base">
                  <div className="flex items-baseline gap-2">
                    <span className="text-ink-dim text-[10px] w-4">
                      {idx + 1}.
                    </span>
                    <span className="text-[12px] font-mono text-accent">
                      {s.tool}
                    </span>
                    <span className={`text-[9px] uppercase tracking-wider ${
                      s.approval ? "text-amber" : "text-ink-muted"
                    }`}>
                      {s.approval ? "ACTIVE · APPROVAL" : "PASSIVE"}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-primary mt-1 ml-6 leading-snug">
                    {s.rationale}
                  </p>
                  {s.success && (
                    <p className="text-[11px] text-ink-muted mt-0.5 ml-6 italic">
                      Pass: {s.success}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={savePlaybook}
              disabled={!!savedAs}
              className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savedAs ? "Saved ✓" : "Save as my playbook"}
            </button>
            {savedAs && (
              <button
                onClick={() => onJumpTo("playbooks")}
                className="px-3 py-1.5 rounded border border-accent text-accent text-[12px] font-bold"
              >
                Open in Playbooks →
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function ProbeKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-divider rounded px-2 py-1.5 bg-bg-base">
      <div className="text-[9px] uppercase tracking-wider text-ink-dim">
        {label}
      </div>
      <div className="text-[12px] text-ink-primary font-mono truncate">
        {value}
      </div>
    </div>
  );
}

