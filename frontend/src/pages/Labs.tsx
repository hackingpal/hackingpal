/**
 * Labs — Vulnerable apps you can spin up locally to practice against.
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
import {
  listEngagements,
  createEngagement,
  getActiveEngagementId,
  setActiveEngagementId,
  type Engagement,
} from "../lib/engagement";
import RunPlaybookModal from "../components/RunPlaybookModal";

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
  category: string;
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

// The catalog endpoint returns every lab including disabled ones, with
// a couple of extra flags driving the "+ Add Lab" drawer UI.
type LabCatalogEntry = LabSummary & {
  enabled: boolean;
  enabled_by_default: boolean;
};

type LabCatalogResponse = { labs: LabCatalogEntry[] };

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

type RuntimeKind = "colima" | "docker-desktop" | "podman" | "other" | "unknown" | "none";
type RuntimeInfo = {
  kind: RuntimeKind;
  version: string | null;
  context: string | null;
  running: boolean;
};

type LabsResponse = {
  labs: LabSummary[];
  docker_available: boolean;
  docker_running: boolean;
  runtime?: RuntimeInfo;
};

// Four discrete failure / ok states the backend distinguishes. Each maps
// to a different remediation in the Colima popup — see /labs/preflight.
type PreflightState =
  | "ok"
  | "binary_missing"
  | "daemon_stopped"
  | "socket_unreachable";

type PreflightResult = {
  state: PreflightState;
  colima_path: string | null;
  docker_path: string | null;
  hint: string;
  command: string | null;
};

type Props = { onJumpTo: (id: string) => void };

const POLL_MS = 2_000;

// Tools whose CLI takes the target as the FIRST positional arg, not the last.
// nc is `nc HOST PORT` — feeding it as `nc PORT HOST` fails with a lookup error.
// nmap / smbclient / curl all accept the target last so they're not in here.
const TARGET_FIRST_CMDS = new Set(["nc"]);

export default function Labs({ onJumpTo }: Props) {
  const [labs, setLabs] = useState<LabSummary[]>([]);
  const [dockerAvailable, setDockerAvailable] = useState<boolean>(true);
  const [dockerRunning, setDockerRunning] = useState<boolean>(true);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [statuses, setStatuses] = useState<Record<string, LabStatus>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Colima popup state. `pending` carries the action a user tried while the
  // runtime wasn't ready, so when Re-check flips to ok we can fire it from
  // inside the popup instead of making them re-navigate to the lab card.
  const [popupOpen, setPopupOpen] = useState<boolean>(false);
  const [popupPending, setPopupPending] = useState<
    { labId: string; action: "build" | "start" } | null
  >(null);
  // Add-Lab drawer state. The catalog is fetched lazily the first time
  // the user opens the drawer — no point pulling it on every page load.
  const [addOpen, setAddOpen] = useState<boolean>(false);
  // Active engagements for the "Attach to engagement" dropdown. Loaded once
  // on mount; reloaded after every attach so a freshly-created engagement
  // in another window surfaces without a page reload.
  const [engagementsList, setEngagementsList] = useState<Engagement[]>([]);
  // Per-lab attach state. `pending` blocks the dropdown from being doubled
  // up while a request is in flight; `lastAttach` holds the short
  // confirmation banner ("Attached to … — added <URL> to scope") that the
  // LabCard renders for ~4s after a successful attach.
  const [attachPending, setAttachPending] = useState<Record<string, boolean>>({});
  const [lastAttach, setLastAttach] = useState<
    Record<string, {
      engName: string;
      scopeEntry: string;
      addedToScope: boolean;
      created: boolean;
    } | null>
  >({});
  const attachTimersRef = useRef<Record<string, number>>({});
  const pollRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // ── Initial load ───────────────────────────────────────────────────────
  const refreshLabs = useCallback(async () => {
    try {
      const r = await api<LabsResponse>("/labs");
      setLabs(r.labs);
      setDockerAvailable(r.docker_available);
      setDockerRunning(r.docker_running);
      setRuntime(r.runtime ?? null);
      for (const lab of r.labs) void refreshStatus(lab.id);
    } catch (e) {
      setError(humanError(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshEngagements = useCallback(async () => {
    // listEngagements() omits archived by default. The attach dropdown only
    // ever offers the currently-active scopes — completed engagements are
    // still listed by the helper (status != "archived" includes "completed")
    // but rejecting completed scopes is a separate policy call we defer to
    // the operator: the dropdown filters to status === "active" so completed
    // engagements stay out of the attach UI without changing the helper.
    try {
      const list = await listEngagements(false);
      setEngagementsList(list.filter((e) => e.status === "active"));
    } catch {
      /* fire-and-forget — dropdown will show the create-first hint */
    }
  }, []);

  useEffect(() => {
    void refreshLabs();
    void refreshEngagements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clean up attach-confirmation timers on unmount so we don't trip the
  // "memory leak in component" warning if the user navigates away mid-toast.
  useEffect(() => () => {
    for (const t of Object.values(attachTimersRef.current)) {
      window.clearTimeout(t);
    }
    attachTimersRef.current = {};
  }, []);

  // ── Poll loop ──────────────────────────────────────────────────────────
  // Active whenever ANY lab is building or running — we want the log tail
  // to flow and container state to update without user input.
  useEffect(() => {
    const anyLive = Object.values(statuses).some(
      (s) => s.build_status === "building"
          || s.container.state === "running"
          || s.container.state === "partial",
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
      setError(null);  // a successful action supersedes any stale error
      flash(actionToast(action, labId));
      await refreshStatus(labId);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy((b) => ({ ...b, [labId]: false }));
    }
  }

  // Build / Start clicked while the runtime isn't ready — open the popup
  // with the action queued. When the popup confirms ok, it calls back into
  // doAction so the user doesn't have to find the lab card again.
  function requestActionWithRuntime(labId: string, action: "build" | "start") {
    if (dockerRunning) {
      void doAction(labId, action);
      return;
    }
    setPopupPending({ labId, action });
    setPopupOpen(true);
  }

  // Called by the popup when the runtime flips to ok.
  function handleRuntimeReady(fresh: RuntimeInfo | null) {
    setDockerAvailable(true);
    setDockerRunning(true);
    if (fresh) setRuntime(fresh);
  }

  function handlePopupLaunch() {
    if (popupPending) {
      void doAction(popupPending.labId, popupPending.action);
    }
    setPopupOpen(false);
    setPopupPending(null);
  }

  function flash(msg: string) {
    setToast(msg);
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2_500);
  }

  // ── Attach lab → engagement ────────────────────────────────────────────
  // One-click flow: figure out which engagement to use, create one if the
  // user doesn't have any yet, then POST /labs/{id}/attach. The card shows
  // a brief confirmation banner ("Attached to <name>" — or "Created
  // engagement <name>" when we auto-made one) plus a page-level toast.
  // Mirrors the auto-engagement pattern in RunPlaybookModal so users with
  // little knowledge can just click and have the right thing happen.
  async function attachLab(lab: LabSummary) {
    setAttachPending((p) => ({ ...p, [lab.id]: true }));
    try {
      const fallbackUrl = lab.primary_url || (() => {
        const port = Object.values(lab.port_map)[0];
        return port ? `http://127.0.0.1:${port}` : "";
      })();

      // 1. Pick a target engagement, or create one. Preference order:
      //    a) active engagement from the top-bar pill (operator intent)
      //    b) the most recently updated active engagement
      //    c) fresh "Lab: <name>" engagement with the lab URL in scope
      let engagementId = getActiveEngagementId();
      let created = false;
      if (!engagementId && engagementsList.length > 0) {
        engagementId = engagementsList[0].id;
      }
      if (!engagementId) {
        const fresh = await createEngagement({
          name: `Lab: ${lab.name}`,
          scope: fallbackUrl ? [fallbackUrl] : [],
          exclusions: [],
          notes: "Auto-created when attaching a lab.",
        });
        engagementId = fresh.id;
        setActiveEngagementId(fresh.id);
        created = true;
      }

      // 2. Attach (idempotent backend-side — re-attaching is a no-op).
      const r = await api<{
        attached: boolean;
        scope_entries_added: number;
        scope_entry: string;
      }>(`/labs/${lab.id}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagement_id: engagementId }),
      });
      setError(null);

      // 3. Resolve a human name for the confirmation. Re-fetch in case we
      //    just created and the list state hasn't refreshed yet.
      let engName: string;
      if (created) {
        engName = `Lab: ${lab.name}`;
      } else {
        const eng = engagementsList.find((e) => e.id === engagementId);
        engName = eng?.name ?? engagementId;
      }

      const addedToScope = r.scope_entries_added > 0;
      setLastAttach((prev) => ({
        ...prev,
        [lab.id]: {
          engName, scopeEntry: r.scope_entry, addedToScope, created,
        },
      }));
      const existing = attachTimersRef.current[lab.id];
      if (existing) window.clearTimeout(existing);
      attachTimersRef.current[lab.id] = window.setTimeout(() => {
        setLastAttach((prev) => ({ ...prev, [lab.id]: null }));
        delete attachTimersRef.current[lab.id];
      }, 8_000);
      flash(
        created
          ? `Created engagement "${engName}" and attached this lab`
          : addedToScope
            ? `Attached to ${engName} — added ${r.scope_entry} to scope`
            : `Attached to ${engName} — already in scope`,
      );
      void refreshEngagements();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setAttachPending((p) => ({ ...p, [lab.id]: false }));
    }
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
            Vulnerable apps you can spin up locally and aim the tools at.
            Runs in a container under colima (or any docker-compatible runtime).
            Loopback-only — never reachable off-host.
          </p>
          <button
            onClick={() => setAddOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 border border-accent/50
                       bg-accent/10 hover:bg-accent/20 text-accent
                       rounded px-3 py-1.5 text-[12px] font-bold tracking-wide
                       transition"
            aria-label="Add lab from catalog"
          >
            <span className="text-base leading-none">+</span>
            <span>Add Lab</span>
          </button>
        </div>
        <DockerBanner
          available={dockerAvailable}
          running={dockerRunning}
          runtime={runtime}
          onShowDetails={() => { setPopupPending(null); setPopupOpen(true); }}
        />
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Self-assess CTA — labs are practice targets; SelfAssess is for
            the user's own apps. Keeps the "test apps I built at home" idea
            one click away from the practice playground. */}
        <button
          onClick={() => onJumpTo("selfassess")}
          className="w-full text-left border border-accent/40 bg-accent/5 hover:bg-accent/10
                     rounded px-4 py-3 transition flex items-center gap-3"
        >
          <span className="text-accent text-lg leading-none">→</span>
          <div className="flex-1">
            <div className="text-[12px] font-bold text-ink-primary">
              Have an app of your own to assess?
            </div>
            <div className="text-[11px] text-ink-muted mt-0.5">
              Run a baseline security check and get an AI-tailored playbook for it.
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-accent font-bold">
            Self-Assess
          </span>
        </button>

        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono flex items-start gap-3">
            <span className="flex-1">Error — {error}</span>
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="text-danger/80 hover:text-danger text-lg leading-none font-bold"
            >
              ×
            </button>
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
            onBuild={() => requestActionWithRuntime(lab.id, "build")}
            onStart={() => requestActionWithRuntime(lab.id, "start")}
            onStop={() => doAction(lab.id, "stop")}
            onOpen={() => openInBrowser(lab.primary_url)}
            onJumpStep={jumpToStep}
            onJumpTo={onJumpTo}
            flash={flash}
            hasAnyEngagement={engagementsList.length > 0}
            attachPending={!!attachPending[lab.id]}
            lastAttach={lastAttach[lab.id] ?? null}
            onAttach={() => attachLab(lab)}
          />
        ))}

        {/* End-of-grid CTA — gives the + Add Lab button a second home, where the
            user is already looking when they finish scanning the existing cards. */}
        {labs.length > 0 && (
          <button
            onClick={() => setAddOpen(true)}
            className="w-full border-2 border-dashed border-divider hover:border-accent/60
                       hover:bg-accent/5 rounded px-4 py-6 text-center transition group"
          >
            <div className="text-3xl text-ink-dim group-hover:text-accent leading-none">+</div>
            <div className="mt-1.5 text-[12px] font-bold text-ink-primary
                            group-hover:text-accent uppercase tracking-wider">
              Add Lab
            </div>
            <div className="mt-1 text-[11px] text-ink-muted">
              Browse the catalog — WebGoat, crAPI, DVGA, Log4Shell, Spring4Shell, Struts2
            </div>
          </button>
        )}
      </div>

      {popupOpen && (
        <ColimaPopup
          onClose={() => { setPopupOpen(false); setPopupPending(null); }}
          onReady={handleRuntimeReady}
          onLaunch={popupPending ? handlePopupLaunch : null}
          pendingLabel={
            popupPending
              ? `${popupPending.action === "build" ? "Build" : "Launch"} ${popupPending.labId}`
              : null
          }
        />
      )}

      {addOpen && (
        <AddLabDrawer
          onClose={() => setAddOpen(false)}
          onChanged={async () => {
            // Refresh main grid so newly-enabled labs appear (and disabled
            // ones disappear) without a page reload.
            await refreshLabs();
          }}
          flash={flash}
          setError={setError}
        />
      )}

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
  onJumpTo, flash,
  hasAnyEngagement, attachPending, lastAttach, onAttach,
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
  onJumpTo: (id: string) => void;
  flash: (msg: string) => void;
  hasAnyEngagement: boolean;
  attachPending: boolean;
  lastAttach: {
    engName: string;
    scopeEntry: string;
    addedToScope: boolean;
    created: boolean;
  } | null;
  onAttach: () => void;
}) {
  const built     = status?.image_exists ?? false;
  const building  = status?.build_status === "building";
  const running   = status?.container.state === "running";
  // A compose stack with some-but-not-all services up. Treat as "live enough"
  // for Stop / suggested-steps / sidecar — the user still needs a way to wind
  // it down, and the sidecar might be the service that IS up.
  const partial   = status?.container.state === "partial";
  const live      = running || partial;
  const buildErr  = status?.build_status === "error" ? status?.build_error : null;
  const hasWebPort = !!lab.primary_url;

  // Sidecar form state — only used when lab.has_sidecar.
  const [sidecarCmd, setSidecarCmd]       = useState<string>(lab.sidecar_cmds[0] ?? "");
  const [sidecarTarget, setSidecarTarget] = useState<string>("10.20.0.0/24");
  const [sidecarArgs, setSidecarArgs]     = useState<string>("-sn");
  const [sidecarOut, setSidecarOut]       = useState<SidecarResult | null>(null);
  const [sidecarBusy, setSidecarBusy]     = useState<boolean>(false);
  const sidecarRef = useRef<HTMLDivElement | null>(null);

  // Run-Playbook modal — only meaningful while the lab is live and has a URL.
  const [playbookOpen, setPlaybookOpen] = useState<boolean>(false);

  // Build-log <details> open/close. Auto-opens whenever a new build starts or
  // errors, but a user-triggered toggle wins until the next state transition —
  // otherwise every 2s poll resets the user's collapse.
  const [logOpen, setLogOpen] = useState<boolean>(false);
  const lastAutoKeyRef = useRef<string>("");
  useEffect(() => {
    const key = `${building ? "b" : "i"}:${buildErr ? "e" : "ok"}`;
    if (key !== lastAutoKeyRef.current) {
      lastAutoKeyRef.current = key;
      if (building || buildErr) setLogOpen(true);
    }
  }, [building, buildErr]);

  // Auto-scroll the build log to the latest line while a build is streaming.
  const logRef = useRef<HTMLPreElement | null>(null);
  const tailLen = status?.build_log_tail?.length ?? 0;
  useEffect(() => {
    if (building && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [tailLen, building]);

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
      const extraArgs = sidecarArgs.trim() === "" ? [] : sidecarArgs.trim().split(/\s+/);
      const targetTok = sidecarTarget ? [sidecarTarget] : [];
      const argsList = TARGET_FIRST_CMDS.has(sidecarCmd)
        ? [...targetTok, ...extraArgs]
        : [...extraArgs, ...targetTok];
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
            <StatusPill running={running} partial={partial} building={building}
                        built={built} error={!!buildErr} />
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
          {built && !live && (
            <button onClick={onStart}
                    disabled={busy || building || !dockerRunning}
                    className={btnPrimary()}
                    title={building ? "Wait for the rebuild to finish" : ""}>
              ▶ Start
            </button>
          )}
          {live && (
            <>
              {hasWebPort && (
                <button onClick={() => setPlaybookOpen(true)}
                        className={btnSecondary()}
                        title="Run a multi-step playbook against this lab">
                  ▶ Run Playbook
                </button>
              )}
              {hasWebPort && (
                <button onClick={onOpen} className={btnSecondary()}>Open ↗</button>
              )}
              <button
                onClick={onAttach}
                disabled={attachPending}
                className={btnSecondary() + " whitespace-nowrap"}
                title={
                  hasAnyEngagement
                    ? "Attach this lab to your active engagement (adds URL to scope, results auto-record)"
                    : "No engagement yet — clicking creates one named “Lab: …” with this lab in scope"
                }
              >
                {attachPending
                  ? "Attaching…"
                  : hasAnyEngagement
                    ? "↳ Attach to engagement"
                    : "↳ Start engagement with this lab"}
              </button>
              <button onClick={onStop} disabled={busy} className={btnStop()}>■ Stop</button>
            </>
          )}
          {built && !running && (
            <button onClick={onBuild} disabled={busy || building || !dockerRunning}
                    className={btnSecondary()}
                    title="Rebuild the image">
              {building ? "Rebuilding…" : "Rebuild"}
            </button>
          )}
        </div>
      </div>

      {/* Inline confirmation banner — auto-dismisses after ~6s.
          Mirrors the page-level toast but stays anchored to the card so the
          user can see what scope entry was added even if they scrolled past
          the toast region. */}
      {lastAttach && (
        <div className="mt-2 text-[11px] text-phos font-mono border border-phos/40
                        bg-phos/10 rounded px-3 py-1.5 leading-relaxed">
          {lastAttach.created ? (
            <>
              Created engagement <b>{lastAttach.engName}</b> with{" "}
              <code>{lastAttach.scopeEntry}</code> in scope.{" "}
              <button
                type="button"
                onClick={() => onJumpTo("dashboard")}
                className="underline hover:text-ink-primary"
              >
                Open dashboard →
              </button>
            </>
          ) : (
            <>
              Attached to <b>{lastAttach.engName}</b>
              {lastAttach.addedToScope
                ? <> — added <code>{lastAttach.scopeEntry}</code> to scope.</>
                : <> — <code>{lastAttach.scopeEntry}</code> was already in scope.</>}{" "}
              <button
                type="button"
                onClick={() => onJumpTo("dashboard")}
                className="underline hover:text-ink-primary"
              >
                Open dashboard →
              </button>
            </>
          )}
        </div>
      )}

      {(building || buildErr || tailLen > 0) && (
        <details
          open={logOpen}
          onToggle={(e) => setLogOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="mt-3"
        >
          <summary className="text-[11px] uppercase tracking-widest text-ink-dim cursor-pointer
                              hover:text-ink-muted">
            Build log
            {buildErr && (
              <span className="ml-2 text-danger normal-case tracking-normal">
                — {buildErr}
              </span>
            )}
          </summary>
          <pre ref={logRef}
               className="mt-2 max-h-64 overflow-auto font-mono text-[11px] leading-snug
                          bg-bg-base border border-divider rounded p-3 text-ink-primary
                          whitespace-pre-wrap">
            {(status?.build_log_tail ?? []).join("\n") || "(empty)"}
          </pre>
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

      {live && lab.suggested_steps.length > 0 && (
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
      {lab.has_sidecar && live && (
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

      {playbookOpen && (
        <RunPlaybookModal
          labId={lab.id}
          labName={lab.name}
          labUrl={lab.primary_url}
          onClose={() => setPlaybookOpen(false)}
          onJumpTo={onJumpTo}
        />
      )}
    </section>
  );
}

// ── Docker / runtime banner ─────────────────────────────────────────────────
function DockerBanner({
  available, running, runtime, onShowDetails,
}: {
  available: boolean;
  running: boolean;
  runtime: RuntimeInfo | null;
  onShowDetails: () => void;
}) {
  if (available && running) {
    return <RuntimePill runtime={runtime} />;
  }
  // We intentionally keep this banner short — the full state-specific
  // remediation (and the Re-check button) lives in the ColimaPopup so the
  // header doesn't become a tutorial.
  const headline = !available
    ? "No container runtime installed."
    : "Container runtime installed but daemon isn't responding.";
  return (
    <button
      onClick={onShowDetails}
      className="mt-3 w-full text-left border border-amber/40 bg-amber/10 hover:bg-amber/20
                 text-amber rounded px-3 py-2 text-[12px] font-mono flex items-center
                 gap-3 transition"
    >
      <span className="flex-1">{headline}</span>
      <span className="text-[10px] uppercase tracking-widest font-bold">
        Show fix →
      </span>
    </button>
  );
}

// ── Colima popup ───────────────────────────────────────────────────────────
function ColimaPopup({
  onClose, onReady, onLaunch, pendingLabel,
}: {
  onClose: () => void;
  onReady: (runtime: RuntimeInfo | null) => void;
  // null when the user opened the popup themselves; set when they tried to
  // build/start a specific lab and we queued it.
  onLaunch: (() => void) | null;
  pendingLabel: string | null;
}) {
  const [pre, setPre]         = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchPreflight = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<PreflightResult>("/labs/preflight");
      setPre(r);
      if (r.state === "ok") {
        // Refresh the parent's docker_running flag so the header pill
        // updates the moment the runtime comes alive.
        try {
          const labs = await api<LabsResponse>("/labs");
          onReady(labs.runtime ?? null);
        } catch { onReady(null); }
      }
    } catch (e) {
      setError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, [onReady]);

  useEffect(() => { void fetchPreflight(); }, [fetchPreflight]);

  const remediation = pre ? remediationFor(pre) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
         onClick={onClose}>
      <div
        className="relative w-[min(560px,92vw)] max-h-[88vh] overflow-auto bg-bg-card
                   border border-divider rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-divider px-5 py-3 flex items-center gap-3">
          <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Runtime</div>
          <h3 className="text-sm font-bold tracking-wide text-ink-primary flex-1">
            Container runtime check
          </h3>
          <button onClick={onClose} aria-label="Close"
                  className="text-ink-dim hover:text-ink-primary text-lg leading-none">
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {loading && !pre && (
            <div className="text-ink-dim text-sm">Checking runtime…</div>
          )}

          {error && (
            <div className="border border-danger/40 bg-danger/10 text-danger
                            rounded px-3 py-2 text-sm font-mono">
              {error}
            </div>
          )}

          {pre && remediation && (
            <>
              <StateBadge state={pre.state} />

              <p className="text-[13px] text-ink-primary leading-relaxed">
                {remediation.title}
              </p>
              <p className="text-[12px] text-ink-muted leading-relaxed">
                {remediation.detail}
              </p>

              {remediation.command && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">
                    Run this in a terminal
                  </div>
                  <pre className="bg-bg-base border border-divider rounded px-3 py-2
                                  font-mono text-[12px] text-ink-primary
                                  whitespace-pre-wrap break-all select-all">
                    {remediation.command}
                  </pre>
                </div>
              )}

              {(pre.colima_path || pre.docker_path) && (
                <div className="text-[11px] font-mono text-ink-dim leading-relaxed">
                  {pre.colima_path && <div>colima · {pre.colima_path}</div>}
                  {pre.docker_path && <div>docker · {pre.docker_path}</div>}
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-divider px-5 py-3 flex items-center gap-2">
          <button onClick={fetchPreflight} disabled={loading}
                  className={btnSecondary()}>
            {loading ? "Re-checking…" : "↻ Re-check"}
          </button>
          <div className="flex-1" />
          {pre?.state === "ok" && onLaunch && pendingLabel && (
            <button onClick={onLaunch} className={btnPrimary()}>
              ▶ {pendingLabel}
            </button>
          )}
          {pre?.state === "ok" && !onLaunch && (
            <button onClick={onClose} className={btnPrimary()}>
              Done
            </button>
          )}
          {pre && pre.state !== "ok" && (
            <button onClick={onClose} className={btnSecondary()}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add Lab drawer ─────────────────────────────────────────────────────────
// Browses the full catalog so the user can opt in to labs that aren't
// shown by default. Disabled labs get an "Add" button; non-default
// enabled labs get a "Hide" button so they can be reverted out of the
// main grid without uninstalling the image.
function AddLabDrawer({
  onClose, onChanged, flash, setError,
}: {
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  flash: (msg: string) => void;
  setError: (msg: string | null) => void;
}) {
  const [catalog, setCatalog] = useState<LabCatalogEntry[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const r = await api<LabCatalogResponse>("/labs/catalog");
      setCatalog(r.labs);
    } catch (e) {
      setLoadErr(humanError(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(lab: LabCatalogEntry) {
    const action = lab.enabled ? "disable" : "enable";
    setBusy((b) => ({ ...b, [lab.id]: true }));
    try {
      await api(`/labs/${lab.id}/${action}`, { method: "POST" });
      flash(lab.enabled ? `Hid ${lab.name}` : `Added ${lab.name}`);
      // Re-fetch the catalog so the just-toggled row updates in place,
      // and let the parent refresh the main grid.
      await load();
      await onChanged();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy((b) => ({ ...b, [lab.id]: false }));
    }
  }

  // Group entries: "Available to add" first (the catalog drawer's job),
  // then "Already added" so users can hide non-default labs.
  const available = (catalog ?? []).filter((l) => !l.enabled);
  const added     = (catalog ?? []).filter((l) =>  l.enabled);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
         onClick={onClose}>
      <div
        className="relative w-[min(720px,94vw)] max-h-[88vh] overflow-auto bg-bg-card
                   border border-divider rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-divider px-5 py-3 flex items-center gap-3 sticky top-0 bg-bg-card">
          <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Catalog</div>
          <h3 className="text-sm font-bold tracking-wide text-ink-primary flex-1">
            Add a lab
          </h3>
          <button onClick={onClose} aria-label="Close"
                  className="text-ink-dim hover:text-ink-primary text-lg leading-none">
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {loadErr && (
            <div className="border border-danger/40 bg-danger/10 text-danger
                            rounded px-3 py-2 text-sm font-mono">
              {loadErr}
            </div>
          )}

          {!catalog && !loadErr && (
            <div className="text-ink-dim text-sm">Loading catalog…</div>
          )}

          {catalog && available.length === 0 && added.length > 0 && (
            <div className="text-ink-muted text-[12px] italic">
              Every lab in the catalog is already added — nothing else to install.
            </div>
          )}

          {available.length > 0 && (
            <section>
              <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">
                Available to add
              </div>
              <div className="space-y-2">
                {available.map((lab) => (
                  <CatalogRow
                    key={lab.id}
                    lab={lab}
                    busy={!!busy[lab.id]}
                    onToggle={() => toggle(lab)}
                  />
                ))}
              </div>
            </section>
          )}

          {added.length > 0 && (
            <section>
              <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">
                Already added
              </div>
              <div className="space-y-2">
                {added.map((lab) => (
                  <CatalogRow
                    key={lab.id}
                    lab={lab}
                    busy={!!busy[lab.id]}
                    onToggle={() => toggle(lab)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="border-t border-divider px-5 py-3 flex items-center gap-2">
          <div className="text-[11px] text-ink-muted">
            Adding a lab just makes its card appear — it doesn't download
            anything until you click <span className="text-ink-primary font-bold">Build</span>.
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className={btnPrimary()}>Done</button>
        </div>
      </div>
    </div>
  );
}

function CatalogRow({
  lab, busy, onToggle,
}: {
  lab: LabCatalogEntry;
  busy: boolean;
  onToggle: () => void;
}) {
  const enabled = lab.enabled;
  const portList = Object.values(lab.port_map || {}).slice(0, 3).join(", ");
  return (
    <div className="flex items-start gap-3 border border-divider bg-bg-base/40
                    hover:bg-bg-base/60 rounded px-3 py-2.5 transition">
      <CategoryChip cat={lab.category} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-[13px] font-bold text-ink-primary truncate">
            {lab.name}
          </div>
          {lab.enabled_by_default && (
            <span className="text-[9px] uppercase tracking-widest text-ink-dim
                             border border-divider rounded px-1 py-px">
              default
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-ink-muted leading-snug line-clamp-2">
          {lab.summary}
        </div>
        {portList && (
          <div className="mt-1 text-[10px] font-mono text-ink-dim">
            127.0.0.1:{portList}
          </div>
        )}
      </div>
      <button
        onClick={onToggle}
        disabled={busy}
        className={enabled ? btnSecondary() : btnPrimary()}
      >
        {busy ? "…" : enabled ? "Hide" : "+ Add"}
      </button>
    </div>
  );
}

function CategoryChip({ cat }: { cat: string }) {
  const cls = (() => {
    switch (cat) {
      case "Web":     return "bg-accent/15 text-accent border-accent/40";
      case "API":     return "bg-phos/15 text-phos border-phos/40";
      case "CVE":     return "bg-danger/15 text-danger border-danger/40";
      case "Network": return "bg-amber/15 text-amber border-amber/40";
      default:        return "bg-bg-card text-ink-muted border-divider";
    }
  })();
  return (
    <span className={`shrink-0 inline-block border rounded px-1.5 py-0.5
                      text-[9px] uppercase tracking-widest font-bold ${cls}`}>
      {cat || "Lab"}
    </span>
  );
}

function StateBadge({ state }: { state: PreflightState }) {
  const { label, cls } = (() => {
    switch (state) {
      case "ok":
        return { label: "READY", cls: "border-phos/60 text-phos" };
      case "binary_missing":
        return { label: "NOT INSTALLED", cls: "border-danger/60 text-danger" };
      case "daemon_stopped":
        return { label: "DAEMON STOPPED", cls: "border-amber/60 text-amber" };
      case "socket_unreachable":
        return { label: "SOCKET UNREACHABLE", cls: "border-amber/60 text-amber" };
    }
  })();
  return (
    <span className={
      "inline-block text-[10px] uppercase tracking-widest font-bold " +
      "px-1.5 py-0.5 rounded border " + cls
    }>
      {label}
    </span>
  );
}

function remediationFor(pre: PreflightResult): {
  title: string; detail: string; command: string | null;
} {
  switch (pre.state) {
    case "ok":
      return {
        title:   "Container runtime is ready.",
        detail:  "Labs are good to launch. You can close this dialog.",
        command: null,
      };
    case "binary_missing":
      return {
        title:   pre.hint,
        detail:  "Colima is the recommended Mac runtime — lightweight, no licence, " +
                 "drop-in replacement for the Docker socket. After install, " +
                 "click Re-check.",
        command: pre.command,
      };
    case "daemon_stopped":
      return {
        title:   pre.hint,
        detail:  pre.command
          ? "Run the command below to bring the VM up, then click Re-check."
          : "Start the runtime, then click Re-check.",
        command: pre.command,
      };
    case "socket_unreachable":
      return {
        title:   pre.hint,
        detail:  "The Docker socket isn't responding even though the VM reports " +
                 "as running. Restart the VM and re-check.",
        command: pre.command,
      };
  }
}

function RuntimePill({ runtime }: { runtime: RuntimeInfo | null }) {
  if (!runtime || runtime.kind === "none") return null;
  const label =
    runtime.kind === "colima"         ? "colima" :
    runtime.kind === "docker-desktop" ? "Docker Desktop" :
    runtime.kind === "podman"         ? "podman" :
    runtime.context || "docker";
  return (
    <div className="mt-2 inline-flex items-center gap-2 text-[10px] font-mono uppercase
                    tracking-widest text-ink-dim">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-phos" aria-hidden />
      <span>Runtime · {label}{runtime.version ? ` · ${runtime.version}` : ""}</span>
    </div>
  );
}

function StatusPill({ running, partial, building, built, error }: {
  running: boolean; partial: boolean; building: boolean; built: boolean; error: boolean;
}) {
  const label =
    error    ? "ERROR"    :
    running  ? "RUNNING"  :
    partial  ? "PARTIAL"  :
    building ? "BUILDING" :
    built    ? "READY"    : "NOT BUILT";
  const cls =
    error    ? "border-danger/60 text-danger" :
    running  ? "border-phos/60 text-phos"     :
    partial  ? "border-amber/60 text-amber"   :
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
