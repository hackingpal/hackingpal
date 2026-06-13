/**
 * Labs — Docker-backed vulnerable apps to practice against.
 *
 * Each lab has a card showing build/run state and three primary actions
 * (Build, Start, Stop). When a lab is running, "Open in browser" launches
 * the lab's web UI in the system browser and a list of suggested next
 * steps lets you jump straight to the matching tool page with the lab
 * target on the clipboard.
 *
 * Build is fired as a background task on the backend; we poll
 * /labs/{id}/status every 2s so the log tail and status pill stay live.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";

type SuggestedStep = {
  label: string;
  route: string;
  query: Record<string, string>;
  description: string;
};

type LabSummary = {
  id: string;
  name: string;
  summary: string;
  kind: "single" | "compose";
  image_tag: string;
  container_name: string;
  port_map: Record<string, number>;
  primary_url: string;
  default_creds: string | null;
  compose_services: string[];
  has_sidecar: boolean;
  sidecar_cmds: string[];
  suggested_steps: SuggestedStep[];
};

type ContainerState = {
  state: "missing" | "created" | "running" | "exited" | "paused" | "dead" | "unknown"
       | "partial" | "starting" | "restarting";
  status: string;
  started_at: string | null;
  exit_code: number | null;
};

type ComposeState = {
  state: "missing" | "running" | "partial";
  services: { name: string; state: string }[];
  running_count: number;
  total: number;
};

type LabStatus = {
  lab: LabSummary;
  docker_running: boolean;
  image_exists: boolean;
  container: ContainerState;
  compose?: ComposeState;
  build_status: "idle" | "building" | "built" | "error";
  build_error: string | null;
  build_started_at: number | null;
  build_finished_at: number | null;
  build_log_tail: string[];
};

type SidecarResult = { rc: number; stdout: string; stderr: string };

type LabsResponse = {
  labs: LabSummary[];
  docker_available: boolean;
  docker_running: boolean;
};

type Props = { onJumpTo: (id: string) => void };

const POLL_MS = 2_000;

export default function Labs({ onJumpTo }: Props) {
  const [labs, setLabs] = useState<LabSummary[]>([]);
  const [dockerAvailable, setDockerAvailable] = useState<boolean>(true);
  const [dockerRunning, setDockerRunning] = useState<boolean>(true);
  const [statuses, setStatuses] = useState<Record<string, LabStatus>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const pollRef = useRef<number | null>(null);

  // ── Initial load ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<LabsResponse>("/labs");
        if (cancelled) return;
        setLabs(r.labs);
        setDockerAvailable(r.docker_available);
        setDockerRunning(r.docker_running);
        // Fan out a status fetch for each lab.
        for (const lab of r.labs) void refreshStatus(lab.id);
      } catch (e) {
        if (!cancelled) setError(humanError(e));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Poll loop ──────────────────────────────────────────────────────────
  // Active whenever ANY lab is building or running — we want the log tail
  // to flow and container state to update without user input.
  useEffect(() => {
    const anyLive = Object.values(statuses).some(
      (s) => s.build_status === "building" || s.container.state === "running",
    );
    if (anyLive && pollRef.current == null) {
      pollRef.current = window.setInterval(() => {
        for (const lab of labs) void refreshStatus(lab.id);
      }, POLL_MS);
    }
    if (!anyLive && pollRef.current != null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current != null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, labs]);

  // ── Status / actions ───────────────────────────────────────────────────
  const refreshStatus = useCallback(async (labId: string) => {
    try {
      const s = await api<LabStatus>(`/labs/${labId}/status`);
      setStatuses((prev) => ({ ...prev, [labId]: s }));
    } catch {
      /* poll errors are noisy — swallow and let the next tick retry */
    }
  }, []);

  async function doAction(labId: string, action: "build" | "start" | "stop") {
    setBusy((b) => ({ ...b, [labId]: true }));
    try {
      await api(`/labs/${labId}/${action}`, { method: "POST" });
      flash(actionToast(action, labId));
      await refreshStatus(labId);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy((b) => ({ ...b, [labId]: false }));
    }
  }

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2_500);
  }

  function openInBrowser(url: string) {
    if (!url) return;
    window.open(url, "_blank", "noopener");
  }

  function jumpToStep(step: SuggestedStep) {
    // Stash the intent — the destination page reads it on mount via
    // useLabIntent() and pre-fills its target/url input. Cleared after one read.
    try {
      sessionStorage.setItem(
        "mhp:labIntent",
        JSON.stringify({ tool: step.route, query: step.query, at: Date.now() }),
      );
    } catch { /* private mode etc. */ }
    if (step.query.target) {
      flash(`Opening ${step.label} with target pre-filled`);
    } else {
      flash(`Opening ${step.label}`);
    }
    onJumpTo(step.route);
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Training</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">Labs</h2>
          </div>
          <p className="flex-1 text-[12px] text-ink-muted leading-snug">
            Docker-backed vulnerable apps you can spin up locally and aim the tools at.
            Loopback-only — never reachable off-host.
          </p>
        </div>
        <DockerBanner available={dockerAvailable} running={dockerRunning} />
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">
            Error — {error}
          </div>
        )}

        {labs.length === 0 && !error && (
          <div className="text-ink-dim text-sm">Loading labs…</div>
        )}

        {labs.map((lab) => (
          <LabCard
            key={lab.id}
            lab={lab}
            status={statuses[lab.id]}
            busy={!!busy[lab.id]}
            dockerRunning={dockerRunning}
            onBuild={() => doAction(lab.id, "build")}
            onStart={() => doAction(lab.id, "start")}
            onStop={() => doAction(lab.id, "stop")}
            onOpen={() => openInBrowser(lab.primary_url)}
            onJumpStep={jumpToStep}
            flash={flash}
          />
        ))}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-bg-card border border-divider
                        rounded px-4 py-2 text-sm text-ink-primary shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Lab card ───────────────────────────────────────────────────────────────
function LabCard({
  lab, status, busy, dockerRunning, onBuild, onStart, onStop, onOpen, onJumpStep,
  flash,
}: {
  lab: LabSummary;
  status: LabStatus | undefined;
  busy: boolean;
  dockerRunning: boolean;
  onBuild: () => void;
  onStart: () => void;
  onStop: () => void;
  onOpen: () => void;
  onJumpStep: (step: SuggestedStep) => void;
  flash: (msg: string) => void;
}) {
  const built     = status?.image_exists ?? false;
  const building  = status?.build_status === "building";
  const running   = status?.container.state === "running";
  const buildErr  = status?.build_status === "error" ? status?.build_error : null;
  const hasWebPort = !!lab.primary_url;

  // Sidecar form state — only used when lab.has_sidecar.
  const [sidecarCmd, setSidecarCmd]       = useState<string>(lab.sidecar_cmds[0] ?? "nmap");
  const [sidecarTarget, setSidecarTarget] = useState<string>("10.20.0.0/24");
  const [sidecarArgs, setSidecarArgs]     = useState<string>("-sn");
  const [sidecarOut, setSidecarOut]       = useState<SidecarResult | null>(null);
  const [sidecarBusy, setSidecarBusy]     = useState<boolean>(false);
  const sidecarRef = useRef<HTMLDivElement | null>(null);

  // Pre-fill the sidecar form when a suggested step has `route: "labs"` and
  // includes a `sidecar` field. Otherwise delegate to the page-level handler.
  async function handleStep(s: SuggestedStep) {
    if (s.route === "labs" && s.query.sidecar) {
      setSidecarCmd(s.query.sidecar);
      setSidecarTarget(s.query.target ?? "");
      setSidecarArgs(s.query.args ?? "");
      setSidecarOut(null);
      // Scroll the sidecar panel into view so the user sees the prefill land.
      window.setTimeout(() => sidecarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      flash(`Sidecar form pre-filled — click Run to execute`);
      return;
    }
    onJumpStep(s);
  }

  async function runSidecar() {
    setSidecarBusy(true);
    setSidecarOut(null);
    try {
      // Split args on whitespace; backend re-validates each token.
      const argsList = sidecarArgs.trim() === ""
        ? (sidecarTarget ? [sidecarTarget] : [])
        : [...sidecarArgs.trim().split(/\s+/), ...(sidecarTarget ? [sidecarTarget] : [])];
      const r = await api<SidecarResult>(`/labs/${lab.id}/sidecar/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: sidecarCmd, args: argsList, timeout: 180 }),
        timeoutMs: 200_000,
      });
      setSidecarOut(r);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : String(e));
      setSidecarOut({ rc: -1, stdout: "", stderr: msg });
    } finally {
      setSidecarBusy(false);
    }
  }

  return (
    <section className="bg-bg-card border border-divider rounded p-5">
      <div className="flex items-start gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-ink-primary">{lab.name}</h3>
            <StatusPill running={running} building={building} built={built} error={!!buildErr} />
          </div>
          <p className="mt-1 text-[12px] text-ink-muted leading-snug">{lab.summary}</p>
          <div className="mt-2 flex gap-4 text-[11px] text-ink-dim font-mono">
            <span>{lab.image_tag}</span>
            <span>→ {lab.primary_url || "(no web port)"}</span>
            {lab.default_creds && <span>creds: {lab.default_creds}</span>}
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          {!built && (
            <button onClick={onBuild}
                    disabled={busy || building || !dockerRunning}
                    className={btnPrimary()}>
              {building ? "Building…" : "Build"}
            </button>
          )}
          {built && !running && (
            <button onClick={onStart} disabled={busy || !dockerRunning}
                    className={btnPrimary()}>
              ▶ Start
            </button>
          )}
          {running && (
            <>
              {hasWebPort && (
                <button onClick={onOpen} className={btnSecondary()}>Open ↗</button>
              )}
              <button onClick={onStop} disabled={busy} className={btnStop()}>■ Stop</button>
            </>
          )}
          {built && !running && (
            <button onClick={onBuild} disabled={busy || building || !dockerRunning}
                    className={btnSecondary()}
                    title="Rebuild the image">
              Rebuild
            </button>
          )}
        </div>
      </div>

      {(building || buildErr || (status?.build_log_tail?.length ?? 0) > 0) && (
        <details open={building || !!buildErr} className="mt-3">
          <summary className="text-[11px] uppercase tracking-widest text-ink-dim cursor-pointer
                              hover:text-ink-muted">
            Build log
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto font-mono text-[11px] leading-snug
                          bg-bg-base border border-divider rounded p-3 text-ink-primary
                          whitespace-pre-wrap">
            {(status?.build_log_tail ?? []).join("\n") || "(empty)"}
          </pre>
          {buildErr && (
            <div className="mt-2 text-[12px] text-danger font-mono">{buildErr}</div>
          )}
        </details>
      )}

      {/* Compose service list — shown while running so the user knows what's up. */}
      {lab.kind === "compose" && status?.compose && (
        <div className="mt-3 flex flex-wrap gap-2">
          {status.compose.services.length === 0 && (
            <span className="text-[11px] text-ink-dim">No containers yet.</span>
          )}
          {status.compose.services.map((s) => (
            <span
              key={s.name}
              className={
                "text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border " +
                (s.state === "running" ? "border-phos/60 text-phos"
                                       : "border-amber/60 text-amber")
              }
              title={s.state}
            >
              {s.name} · {s.state}
            </span>
          ))}
        </div>
      )}

      {running && lab.suggested_steps.length > 0 && (
        <div className="mt-4 border-t border-divider pt-3">
          <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">
            Suggested next steps
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {lab.suggested_steps.map((s) => (
              <button
                key={`${s.route}:${s.label}`}
                onClick={() => handleStep(s)}
                className="text-left bg-bg-base hover:bg-bg-nav-hover border border-divider
                           hover:border-accent/60 rounded px-3 py-2 transition group"
              >
                <div className="text-[12px] font-semibold text-ink-primary
                                group-hover:text-accent flex items-center gap-2">
                  <span>{s.label}</span>
                  <span className="text-[10px] text-ink-dim font-mono">
                    → {s.route === "labs" && s.query.sidecar ? `sidecar ${s.query.sidecar}` : s.route}
                  </span>
                </div>
                {s.description && (
                  <div className="text-[11px] text-ink-muted mt-0.5">{s.description}</div>
                )}
                {s.query.target && (
                  <div className="text-[10px] text-ink-dim font-mono mt-1 truncate">
                    target: {s.query.target}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sidecar exec panel — only for labs with has_sidecar (vulhub-net). */}
      {lab.has_sidecar && running && (
        <div ref={sidecarRef} className="mt-4 border-t border-divider pt-3">
          <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">
            Scan from inside the network (via sidecar)
          </div>
          <div className="grid grid-cols-[140px_1fr_1fr_auto] gap-2 items-end">
            <Field label="Tool">
              <select value={sidecarCmd} onChange={(e) => setSidecarCmd(e.target.value)}
                      className={selectCls()} disabled={sidecarBusy}>
                {lab.sidecar_cmds.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Target">
              <input value={sidecarTarget} onChange={(e) => setSidecarTarget(e.target.value)}
                     placeholder="10.20.0.0/24 or 10.20.0.10"
                     className={inputCls()} disabled={sidecarBusy} />
            </Field>
            <Field label="Extra args">
              <input value={sidecarArgs} onChange={(e) => setSidecarArgs(e.target.value)}
                     placeholder="-sV -F"
                     className={inputCls()} disabled={sidecarBusy} />
            </Field>
            <button onClick={runSidecar} disabled={sidecarBusy}
                    className={btnPrimary()}>
              {sidecarBusy ? "Running…" : "▶ Run"}
            </button>
          </div>
          {sidecarOut && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-widest text-ink-dim">
                  Output (rc {sidecarOut.rc})
                </span>
              </div>
              <pre className="max-h-80 overflow-auto font-mono text-[11px] leading-snug
                              bg-bg-base border border-divider rounded p-3 text-ink-primary
                              whitespace-pre-wrap">
                {sidecarOut.stdout || sidecarOut.stderr || "(no output)"}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Bits ───────────────────────────────────────────────────────────────────
function DockerBanner({ available, running }: { available: boolean; running: boolean }) {
  if (available && running) return null;
  const msg = !available
    ? "Docker isn't installed. Install Docker Desktop to use Labs."
    : "Docker is installed but the daemon isn't running. Start Docker Desktop and refresh.";
  return (
    <div className="mt-3 border border-amber/40 bg-amber/10 text-amber
                    rounded px-3 py-2 text-[12px]">
      {msg}
    </div>
  );
}

function StatusPill({ running, building, built, error }: {
  running: boolean; building: boolean; built: boolean; error: boolean;
}) {
  const label =
    error    ? "ERROR"    :
    running  ? "RUNNING"  :
    building ? "BUILDING" :
    built    ? "READY"    : "NOT BUILT";
  const cls =
    error    ? "border-danger/60 text-danger" :
    running  ? "border-phos/60 text-phos"     :
    building ? "border-amber/60 text-amber"   :
    built    ? "border-accent/60 text-accent" :
               "border-divider text-ink-dim";
  return (
    <span className={
      "inline-block text-[10px] uppercase tracking-widest font-bold " +
      "px-1.5 py-0.5 rounded border " + cls
    }>
      {label}
    </span>
  );
}

function actionToast(action: "build" | "start" | "stop", labId: string): string {
  if (action === "build") return `Build started for ${labId}`;
  if (action === "start") return `${labId} starting…`;
  return `${labId} stopped`;
}

function humanError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

const btnPrimary = () =>
  "bg-accent hover:bg-accentDim active:translate-y-px text-white text-xs font-bold " +
  "tracking-wide px-3 py-1.5 rounded transition border border-accent/60 disabled:opacity-50 " +
  "disabled:cursor-not-allowed";
const btnSecondary = () =>
  "bg-bg-base hover:bg-bg-nav-hover text-ink-primary text-xs font-semibold " +
  "tracking-wide px-3 py-1.5 rounded transition border border-divider disabled:opacity-50";
const btnStop = () =>
  "bg-danger/10 hover:bg-danger/20 active:translate-y-px text-danger text-xs font-bold " +
  "tracking-wide px-3 py-1.5 rounded transition border border-danger/60 disabled:opacity-50";
const inputCls = () =>
  "w-full bg-bg-card border border-divider rounded px-3 py-1.5 text-sm font-mono " +
  "text-ink-primary placeholder:text-ink-dim focus:outline-none focus:border-accent " +
  "focus:ring-1 focus:ring-accent/30 disabled:opacity-60";
const selectCls = () =>
  "w-full bg-bg-card border border-divider rounded px-2 py-1.5 text-sm font-mono " +
  "text-ink-primary focus:outline-none focus:border-accent disabled:opacity-60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-ink-dim block mb-1">{label}</span>
      {children}
    </label>
  );
}
