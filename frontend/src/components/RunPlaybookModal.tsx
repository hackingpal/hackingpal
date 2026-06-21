// RunPlaybookModal — lets a lab fire a playbook against itself.
//
// Mounted from each LabCard's "▶ Run Playbook" button. Lists every preset
// returned by /presets (filtering out target_type === "local" since they
// don't apply to a lab URL), auto-creates an engagement when none is active,
// then opens /ws/preset-run and streams step / finding events into a feed.
//
// The runner is intentionally a terser cousin of pages/Presets.tsx — same
// event handling, looser visual layout. All state lives inside this file.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, authFetch, openWs } from "../api";
import {
  createEngagement,
  setActiveEngagementId,
  useActiveEngagementId,
} from "../lib/engagement";

// ── Types ────────────────────────────────────────────────────────────────────

type PresetSummary = {
  id: string;
  name: string;
  description: string;
  target_type: string;
  // Other fields exist on the wire but we don't render them.
};

type Severity = "critical" | "high" | "medium" | "low" | "info";
const ALL_SEV: Severity[] = ["critical", "high", "medium", "low", "info"];

type FeedItem =
  | { kind: "step_start";  ts: number; step: string; tool: string }
  | { kind: "step_done";   ts: number; step: string; status: string; elapsed?: number }
  | { kind: "finding";     ts: number; severity: Severity; title: string; detail: string; tool: string }
  | { kind: "paused";      ts: number; title: string; detail: string }
  | { kind: "preset_start"; ts: number }
  | { kind: "preset_done"; ts: number; findings: number; stopped: boolean }
  | { kind: "error";       ts: number; detail: string };

type Props = {
  /** Lab id — used to short-circuit duplicate engagement creation by lab. */
  labId: string;
  /** Human-readable lab name; goes into the auto-engagement title. */
  labName: string;
  /** Lab's primary URL (e.g. "http://127.0.0.1:8083"). Used as the target. */
  labUrl: string;
  /** Close handler. */
  onClose: () => void;
  /** Optional nav hook so the "view findings" link can jump. */
  onJumpTo?: (id: string) => void;
};

// ── Severity styling (mirrors Presets.tsx) ───────────────────────────────────

const SEV_STYLES: Record<Severity, { text: string; bg: string; border: string }> = {
  critical: { text: "text-danger",   bg: "bg-danger/15",   border: "border-danger/40"   },
  high:     { text: "text-danger",   bg: "bg-danger/10",   border: "border-danger/30"   },
  medium:   { text: "text-amber",    bg: "bg-amber/15",    border: "border-amber/40"    },
  low:      { text: "text-accent",   bg: "bg-accent/10",   border: "border-accent/30"   },
  info:     { text: "text-ink-muted", bg: "bg-bg-base",    border: "border-divider"     },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function RunPlaybookModal({
  labId, labName, labUrl, onClose, onJumpTo,
}: Props) {
  const activeId = useActiveEngagementId();
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [running, setRunning] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [doneMessage, setDoneMessage] = useState("");
  const [paused, setPaused] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ presets: PresetSummary[]; tools: string[] }>("/presets");
        if (cancelled) return;
        // Drop "local" target presets — they don't aim at a remote URL.
        setPresets(r.presets.filter((p) => p.target_type !== "local"));
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Esc to close (when not running — closing mid-flight would orphan the WS).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !running) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  // Close any in-flight run on unmount.
  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  // ── Engagement gate ───────────────────────────────────────────────────────

  const ensureEngagement = useCallback(async (): Promise<string | null> => {
    if (activeId) return activeId;
    try {
      const e = await createEngagement({
        name: `Lab: ${labName}`,
        scope: [labUrl],
        exclusions: [],
        notes: "Auto-created for lab playbook run.",
      });
      setActiveEngagementId(e.id);
      return e.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [activeId, labName, labUrl]);

  // ── Run ───────────────────────────────────────────────────────────────────

  async function start() {
    const preset = presets.find((p) => p.id === selectedId);
    if (!preset || !authorized || running) return;
    setError("");
    setFeed([]);
    setDoneMessage("");
    setPaused(false);

    const eid = await ensureEngagement();
    if (!eid) return;

    setRunning(true);
    const ws = openWs("/ws/preset-run");
    wsRef.current = ws;
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({
          preset: preset.id,
          target: labUrl,
          authorized: true,
          mode: "engagement",
          engagement_id: eid,
          confirm: true,
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    ws.onmessage = (msgEv) => {
      let ev: { type?: string; [k: string]: unknown };
      try { ev = JSON.parse(msgEv.data); } catch { return; }
      handleEvent(ev);
    };
    ws.onerror = () => setError("WebSocket error");
    ws.onclose = () => {
      setRunning(false);
      wsRef.current = null;
    };
  }

  function sendAction(action: "stop" | "continue") {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ action })); } catch { /* ignore */ }
    if (action === "continue") setPaused(false);
  }

  // ── Event handler — mirrors pages/Presets.tsx handleEvent ─────────────────

  function handleEvent(ev: { type?: string; [k: string]: unknown }) {
    const t = ev.type;
    const now = Date.now();
    if (t === "preset_start") {
      setFeed((cur) => [...cur, { kind: "preset_start", ts: now }]);
    } else if (t === "step_start") {
      setFeed((cur) => [...cur, {
        kind: "step_start", ts: now,
        step: String(ev.step ?? ""),
        tool: String(ev.tool ?? ""),
      }]);
    } else if (t === "step_progress") {
      // Surface as a feed entry only if there's a message — otherwise too noisy.
      const msg = typeof ev.msg === "string" ? ev.msg : "";
      if (msg) {
        setFeed((cur) => [...cur, {
          kind: "step_start", ts: now,
          step: String(ev.step ?? ""),
          tool: msg,
        }]);
      }
    } else if (t === "step_done") {
      setFeed((cur) => [...cur, {
        kind: "step_done", ts: now,
        step: String(ev.step ?? ""),
        status: String(ev.status ?? "ok"),
        elapsed: typeof ev.elapsed === "number" ? ev.elapsed : undefined,
      }]);
    } else if (t === "finding") {
      const rawSev = String(ev.severity ?? "info");
      const sev: Severity = (ALL_SEV as string[]).includes(rawSev)
        ? (rawSev as Severity)
        : "info";
      setFeed((cur) => [...cur, {
        kind: "finding", ts: now,
        severity: sev,
        title: String(ev.title ?? "(finding)"),
        detail: String(ev.detail ?? ""),
        tool: String(ev.tool ?? ""),
      }]);
    } else if (t === "critical_finding") {
      const inner = (ev.finding && typeof ev.finding === "object")
        ? (ev.finding as Record<string, unknown>)
        : {};
      setPaused(true);
      setFeed((cur) => [...cur, {
        kind: "paused", ts: now,
        title: String(inner.title ?? "Critical finding"),
        detail: String(inner.detail ?? ""),
      }]);
    } else if (t === "paused") {
      setPaused(true);
      setFeed((cur) => [...cur, {
        kind: "paused", ts: now,
        title: String(ev.title ?? "Paused"),
        detail: String(ev.detail ?? ""),
      }]);
    } else if (t === "preset_done" || t === "done") {
      const findings = typeof ev.findings_total === "number"
        ? ev.findings_total
        : (typeof ev.findings === "number" ? ev.findings : 0);
      const stopped = !!ev.stopped;
      setFeed((cur) => [...cur, {
        kind: "preset_done", ts: now, findings, stopped,
      }]);
      setDoneMessage(
        stopped
          ? `■ Stopped — ${findings} findings captured`
          : `✓ Playbook complete — ${findings} findings captured`,
      );
    } else if (t === "error") {
      const detail = typeof ev.detail === "string" ? ev.detail : "engine error";
      setFeed((cur) => [...cur, { kind: "error", ts: now, detail }]);
      setError(detail);
    }
  }

  // ── View-findings jump ────────────────────────────────────────────────────

  function viewFindings() {
    onClose();
    onJumpTo?.("findings");
  }

  // Track lab id silently — we don't dedup engagements but keeping it scoped
  // makes future "reuse last engagement for this lab" cheap to add.
  void labId;

  // Best-effort no-op consumers so backend-only calls don't get flagged.
  void authFetch;

  // ── Render ────────────────────────────────────────────────────────────────

  const selected = presets.find((p) => p.id === selectedId) || null;
  const canRun = !!selected && authorized && !running;
  const showSelector = !running && !doneMessage;

  return (
    <div className="fixed inset-0 z-50 bg-bg-base/70 backdrop-blur-sm flex items-start
                    justify-center pt-[6vh] px-4"
         onClick={(e) => {
           if (e.target === e.currentTarget && !running) onClose();
         }}>
      <div className="w-full max-w-2xl bg-bg-card border border-divider rounded-lg
                      shadow-2xl flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center px-4 py-3 border-b border-divider">
          <span className="text-accent text-[11px] font-bold tracking-widest">
            RUN PLAYBOOK
          </span>
          <span className="text-[10px] text-ink-dim ml-3 truncate">
            against <code className="text-ink-muted">{labName}</code>
            <span className="ml-1.5">→ <code>{labUrl}</code></span>
          </span>
          <span className="flex-1" />
          <button onClick={onClose} disabled={running}
                  title={running ? "Stop the run before closing" : "Close"}
                  className="text-ink-muted hover:text-ink-primary px-1 disabled:opacity-40">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="text-[12px] text-ink-dim italic">Loading playbooks…</div>
          )}

          {!loading && error && !running && (
            <div className="text-[12px] text-danger font-mono">⚠ {error}</div>
          )}

          {/* Preset selector */}
          {showSelector && !loading && (
            <>
              <div className="text-[11px] text-ink-muted tracking-wider">PLAYBOOK</div>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {presets.length === 0 && (
                  <div className="text-[12px] text-ink-dim italic">
                    No playbooks available for remote targets.
                  </div>
                )}
                {presets.map((p) => {
                  const isSel = selectedId === p.id;
                  return (
                    <div key={p.id}
                         onClick={() => setSelectedId(p.id)}
                         className={
                           "border rounded p-2 cursor-pointer transition-colors " +
                           "bg-bg-base " +
                           (isSel
                             ? "border-l-2 border-l-accent border-accent"
                             : "border-divider hover:border-ink-muted")
                         }>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-ink-primary truncate">
                          {p.name}
                        </span>
                        <span className="ml-auto text-[9px] uppercase tracking-wider
                                         px-1.5 py-0.5 rounded border border-divider text-ink-muted">
                          {p.target_type}
                        </span>
                      </div>
                      {p.description && (
                        <div className="text-[11px] text-ink-muted mt-1 line-clamp-2">
                          {p.description}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Authorization gate */}
              <label className="flex items-start gap-2 text-[12px] text-ink-primary
                                bg-amber/5 border border-amber/30 rounded p-2 cursor-pointer">
                <input type="checkbox" checked={authorized}
                       onChange={(e) => setAuthorized(e.target.checked)}
                       className="mt-0.5" />
                <span>
                  I am authorized to test this lab.
                  <span className="block text-[10px] text-ink-muted mt-0.5">
                    Required before any playbook fires.
                  </span>
                </span>
              </label>

              {!activeId && (
                <div className="text-[11px] text-ink-muted italic">
                  No active engagement — one will be auto-created as
                  <code className="text-ink-primary ml-1">Lab: {labName}</code>.
                </div>
              )}
            </>
          )}

          {/* Live feed */}
          {(running || doneMessage) && (
            <>
              <div className="text-[11px] text-ink-muted tracking-wider">
                LIVE FEED
              </div>
              <div className="border border-divider bg-bg-base rounded p-2 max-h-[50vh]
                              overflow-y-auto space-y-1">
                {feed.length === 0 && (
                  <div className="text-[11px] text-ink-dim italic">Waiting for events…</div>
                )}
                {feed.map((it, i) => (
                  <FeedRow key={i} item={it} />
                ))}
              </div>

              {paused && (
                <div className={"border rounded p-2 " + SEV_STYLES.critical.bg + " " + SEV_STYLES.critical.border}>
                  <div className={"text-[11px] font-bold uppercase tracking-wider " + SEV_STYLES.critical.text}>
                    Paused on critical finding
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => sendAction("continue")}
                            className="px-2 py-1 rounded border border-phos text-[11px]
                                       text-phos hover:bg-phos hover:text-bg-base">
                      Continue
                    </button>
                    <button onClick={() => sendAction("stop")}
                            className="px-2 py-1 rounded border border-danger text-[11px]
                                       text-danger hover:bg-danger hover:text-bg-base">
                      Stop
                    </button>
                  </div>
                </div>
              )}

              {doneMessage && (
                <div className="border border-divider bg-bg-base rounded p-3
                                text-[12px] text-ink-primary flex items-center gap-3">
                  <span className="font-bold">{doneMessage}</span>
                  <span className="flex-1" />
                  <button onClick={viewFindings}
                          className="text-[11px] text-accent hover:underline">
                    → View findings
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-divider px-4 py-3 flex gap-2 justify-end items-center">
          <span className="flex-1 text-[10px] text-ink-dim">
            {running
              ? "Streaming events from /ws/preset-run."
              : "Posts to the active engagement (auto-created if needed)."}
          </span>
          {!running && !doneMessage && (
            <>
              <button onClick={onClose}
                      className="px-3 py-1.5 rounded border border-divider text-ink-muted text-[12px]">
                Cancel
              </button>
              <button onClick={() => void start()} disabled={!canRun}
                      className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                                 disabled:opacity-40 disabled:cursor-not-allowed">
                ▶ Run
              </button>
            </>
          )}
          {running && (
            <button onClick={() => sendAction("stop")}
                    className="px-3 py-1.5 rounded border border-danger text-[12px]
                               text-danger hover:bg-danger hover:text-bg-base">
              ■ Stop
            </button>
          )}
          {!running && doneMessage && (
            <button onClick={onClose}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Feed row ────────────────────────────────────────────────────────────────

function FeedRow({ item }: { item: FeedItem }) {
  const ts = new Date(item.ts).toLocaleTimeString();
  const baseCls = "flex items-start gap-2 text-[11px] leading-snug";

  if (item.kind === "preset_start") {
    return (
      <div className={baseCls + " text-ink-muted"}>
        <span className="font-mono text-ink-dim tabular-nums">{ts}</span>
        <span>▶ Playbook started</span>
      </div>
    );
  }
  if (item.kind === "preset_done") {
    return (
      <div className={baseCls + " text-phos"}>
        <span className="font-mono text-ink-dim tabular-nums">{ts}</span>
        <span>
          {item.stopped ? "■ Stopped" : "✓ Complete"} — {item.findings} finding
          {item.findings === 1 ? "" : "s"}
        </span>
      </div>
    );
  }
  if (item.kind === "step_start") {
    return (
      <div className={baseCls + " text-ink-primary"}>
        <span className="font-mono text-ink-dim tabular-nums">{ts}</span>
        <span className="text-amber">◐</span>
        <span className="font-mono text-ink-muted">{item.step}</span>
        {item.tool && <span className="text-ink-dim">· {item.tool}</span>}
      </div>
    );
  }
  if (item.kind === "step_done") {
    const ok = item.status === "ok";
    return (
      <div className={baseCls + (ok ? " text-ink-muted" : " text-danger")}>
        <span className="font-mono text-ink-dim tabular-nums">{ts}</span>
        <span>{ok ? "●" : "✕"}</span>
        <span className="font-mono">{item.step}</span>
        <span className="text-ink-dim">{item.status}</span>
        {item.elapsed != null && (
          <span className="text-ink-dim font-mono">{item.elapsed}s</span>
        )}
      </div>
    );
  }
  if (item.kind === "finding") {
    const ss = SEV_STYLES[item.severity];
    return (
      <div className={"border rounded p-1.5 " + ss.bg + " " + ss.border}>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="font-mono text-ink-dim tabular-nums">{ts}</span>
          <span className={"uppercase tracking-wider font-bold " + ss.text}>
            {item.severity}
          </span>
          {item.tool && (
            <span className="font-mono text-ink-dim">{item.tool}</span>
          )}
        </div>
        <div className="text-[12px] text-ink-primary mt-0.5">{item.title}</div>
        {item.detail && (
          <div className="text-[10px] text-ink-muted mt-0.5 font-mono
                          break-all line-clamp-2">
            {item.detail}
          </div>
        )}
      </div>
    );
  }
  if (item.kind === "paused") {
    const ss = SEV_STYLES.critical;
    return (
      <div className={"border rounded p-1.5 " + ss.bg + " " + ss.border}>
        <div className={"text-[10px] uppercase tracking-wider font-bold " + ss.text}>
          ⏸ {item.title}
        </div>
        {item.detail && (
          <div className="text-[10px] text-ink-muted mt-0.5 font-mono break-all">
            {item.detail}
          </div>
        )}
      </div>
    );
  }
  // error
  return (
    <div className={baseCls + " text-danger"}>
      <span className="font-mono text-ink-dim tabular-nums">{ts}</span>
      <span>✕ {item.detail}</span>
    </div>
  );
}
