// Top-of-app banner that prompts the user to install or start the colima
// container runtime that Labs depend on. Self-hides:
//
//   * on Windows (colima isn't packaged for it; future Docker Desktop path),
//   * while the backend isn't reachable (no point polling),
//   * when the runtime is healthy,
//   * when the user dismissed it this session (sessionStorage flag).
//
// Polls `/labs/runtime/status` on mount and every 30s. The "Install &
// start colima" button opens a modal with a streaming WS log fed by
// `/ws/labs/runtime/install`. If brew is missing the backend sends a
// BREW_MISSING error frame and the modal swaps to a copy-pastable
// instruction panel pointing at https://brew.sh.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchRuntimeStatus,
  openWs,
  type RuntimeInstallEvent,
  type RuntimeStatus,
} from "../api";

type Props = {
  platform: "darwin" | "linux" | "win32" | null;
};

const DISMISS_KEY = "runtimeBanner:dismissed";
const POLL_MS = 30_000;

function isDismissed(): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === "1"; }
  catch { return false; }
}

function setDismissed(): void {
  try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
}

function clearDismissed(): void {
  try { sessionStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
}

export default function RuntimeBanner({ platform }: Props) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [dismissed, setDismissedState] = useState<boolean>(() => isDismissed());
  const [modalOpen, setModalOpen] = useState(false);

  // Platform gate. We render nothing on Windows for now — colima isn't
  // there yet and we don't want to nag users. Linux uses brew/Linuxbrew or
  // the system package manager — for now we still surface it; the WS
  // installer will fail clearly on systems without brew and the user gets
  // the install-Homebrew swap (which on Linux is also a valid path).
  const supported = platform !== "win32";

  const refresh = useCallback(async () => {
    if (!supported) return;
    try { setStatus(await fetchRuntimeStatus()); }
    catch { /* backend not up yet — leave previous state */ }
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    void refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [supported, refresh]);

  if (!supported || !status) return null;
  if (dismissed) return null;
  if (!status.needs_install && !status.needs_start) return null;

  const headline = status.needs_install
    ? "Labs need a container runtime."
    : "Container runtime is stopped.";
  const button = status.needs_install
    ? "Install & start colima"
    : "Start colima";

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 px-4 py-2 border-b border-amber/40
                   bg-amber/10 text-[12px]"
      >
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5 rounded-full bg-amber animate-pulse shrink-0"
        />
        <span className="text-ink-primary flex-1 truncate">
          {headline}
          <span className="text-ink-muted ml-2 hidden sm:inline">
            Labs (DVWA, Juice Shop, vulhub-net) can't build or start without it.
          </span>
        </span>
        <button
          onClick={() => setModalOpen(true)}
          className="px-3 py-1 rounded border border-amber/60 text-amber
                     hover:bg-amber/10 hover:border-amber transition
                     text-[11px] uppercase tracking-wider shrink-0"
        >
          {button}
        </button>
        <button
          onClick={() => { setDismissed(); setDismissedState(true); }}
          aria-label="Dismiss for this session"
          title="Dismiss until next launch"
          className="text-ink-dim hover:text-ink-primary text-base leading-none shrink-0
                     px-1 transition"
        >
          ✕
        </button>
      </div>
      {modalOpen && (
        <RuntimeInstallModal
          onClose={() => setModalOpen(false)}
          onSucceeded={() => {
            // Re-poll once so the banner self-hides immediately on success
            // rather than waiting for the next 30s tick. Also clear the
            // dismiss flag — a successful install supersedes a prior
            // dismissal in the same session.
            clearDismissed();
            setDismissedState(false);
            void refresh();
          }}
        />
      )}
    </>
  );
}

// ── Install modal — streams the WS install log ─────────────────────────────

type ModalProps = {
  onClose: () => void;
  onSucceeded: () => void;
};

function RuntimeInstallModal({ onClose, onSucceeded }: ModalProps) {
  const [lines, setLines] = useState<{ stream: "stdout" | "stderr"; text: string }[]>([]);
  const [phase, setPhase] = useState<"running" | "done" | "error" | "brew_missing">(
    "running"
  );
  const [result, setResult] = useState<{ ok: boolean; state: string; stopped: boolean } | null>(null);
  const [brewInstallCmd, setBrewInstallCmd] = useState<string>("");
  const [errMsg, setErrMsg] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the log to bottom as new lines arrive.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // Open the WS once on mount. Tear down on unmount so closing the modal
  // mid-install cleanly stops it (the close triggers the backend's
  // WebSocketDisconnect path which terminates any in-flight child).
  useEffect(() => {
    const ws = openWs("/ws/labs/runtime/install");
    wsRef.current = ws;
    ws.onmessage = (e) => {
      let ev: RuntimeInstallEvent;
      try { ev = JSON.parse(e.data); }
      catch { return; }
      if (ev.type === "log") {
        setLines((cur) => [...cur, { stream: ev.stream, text: ev.line }]);
      } else if (ev.type === "started") {
        setLines((cur) => [
          ...cur,
          { stream: "stdout", text: `Plan: ${ev.steps.join(" && ")}` },
        ]);
      } else if (ev.type === "error") {
        if (ev.code === "BREW_MISSING") {
          setPhase("brew_missing");
          setBrewInstallCmd(ev.install_command ?? "");
        } else {
          setPhase("error");
          setErrMsg(ev.message || ev.detail || ev.code || "install failed");
        }
      } else if (ev.type === "done") {
        setPhase(ev.ok ? "done" : "error");
        setResult({ ok: ev.ok, state: ev.state, stopped: ev.stopped });
        if (ev.ok) {
          // Close after a short beat so the user sees the success line.
          setTimeout(() => { onSucceeded(); onClose(); }, 800);
        }
      }
    };
    ws.onerror = () => {
      setPhase("error");
      setErrMsg("WebSocket error — backend may have dropped the connection.");
    };
    return () => {
      try { ws.close(); } catch { /* ignore */ }
      wsRef.current = null;
    };
    // Mount-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sendStop() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ action: "stop" })); } catch { /* ignore */ }
  }

  async function copyBrewCmd() {
    try {
      await navigator.clipboard.writeText(brewInstallCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const title = useMemo(() => {
    if (phase === "brew_missing") return "Install Homebrew first";
    if (phase === "done") return "Runtime ready";
    if (phase === "error") return "Install failed";
    return "Installing container runtime…";
  }, [phase]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative w-[min(720px,92vw)] max-h-[88vh] flex flex-col
                   bg-bg-card border border-divider rounded-lg shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-divider px-5 py-3 flex items-center gap-3">
          <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
            Runtime
          </div>
          <h3 className="text-sm font-bold tracking-wide text-ink-primary flex-1 truncate">
            {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ink-dim hover:text-ink-primary text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
          {phase === "brew_missing" ? (
            <BrewMissingPanel
              installCommand={brewInstallCmd}
              copied={copied}
              onCopy={copyBrewCmd}
            />
          ) : (
            <>
              {phase === "error" && errMsg && (
                <div className="border border-danger/40 bg-danger/10 text-danger
                                rounded px-3 py-2 text-[12px] font-mono">
                  {errMsg}
                </div>
              )}
              {phase === "done" && result?.ok && (
                <div className="border border-phos/40 bg-phos/10 text-phos
                                rounded px-3 py-2 text-[12px] font-mono">
                  Runtime is ready (state: {result.state}).
                </div>
              )}
              <div
                ref={logRef}
                className="bg-bg-base border border-divider rounded p-3 h-72
                           overflow-auto font-mono text-[11px] whitespace-pre-wrap
                           break-all text-ink-primary"
              >
                {lines.length === 0 && (
                  <span className="text-ink-dim italic">Waiting for output…</span>
                )}
                {lines.map((l, i) => (
                  <div
                    key={i}
                    className={l.stream === "stderr" ? "text-danger" : "text-ink-primary"}
                  >
                    {l.text}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-divider px-5 py-3 flex items-center justify-end gap-2">
          {phase === "running" && (
            <button
              onClick={sendStop}
              className="px-3 py-1 rounded border border-divider text-ink-muted
                         hover:border-danger hover:text-danger transition
                         text-[11px] uppercase tracking-wider"
            >
              Stop
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1 rounded border border-divider text-ink-muted
                       hover:border-ink-primary hover:text-ink-primary transition
                       text-[11px] uppercase tracking-wider"
          >
            {phase === "done" || phase === "error" || phase === "brew_missing"
              ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Brew-missing fallback ──────────────────────────────────────────────────

function BrewMissingPanel({
  installCommand, copied, onCopy,
}: {
  installCommand: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-primary leading-relaxed">
        HackingPal can't install colima without Homebrew. Install Homebrew
        first, then re-open this dialog.
      </p>
      <p className="text-[12px] text-ink-muted leading-relaxed">
        We do <strong>not</strong> install Homebrew automatically — its
        installer needs your sudo password and (sometimes) Xcode CLT. Run the
        official command in a Terminal:
      </p>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">
          Paste into Terminal
        </div>
        <div className="flex items-stretch gap-2">
          <pre
            className="bg-bg-base border border-divider rounded px-3 py-2
                       font-mono text-[12px] text-ink-primary flex-1
                       whitespace-pre-wrap break-all select-all overflow-auto max-h-32"
          >
            {installCommand}
          </pre>
          <button
            onClick={onCopy}
            className="px-3 rounded border border-divider text-ink-muted
                       hover:border-ink-primary hover:text-ink-primary transition
                       text-[11px] uppercase tracking-wider"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <a
        href="https://brew.sh"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-[12px] text-accent hover:text-ink-primary underline"
      >
        brew.sh →
      </a>
    </div>
  );
}
