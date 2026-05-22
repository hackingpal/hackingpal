import { useEffect, useMemo, useState } from "react";
import {
  fetchProcesses, killProcess, killBulk,
  type ForensicSeverity, type ProcessEntry, type SignStatus,
  type KillResult, type KillSignal,
} from "../api";

const SEV: Record<ForensicSeverity, { dot: string; bg: string }> = {
  info: { dot: "bg-ink-dim", bg: "bg-bg-card" },
  warn: { dot: "bg-amber",   bg: "bg-amber/5" },
  high: { dot: "bg-danger",  bg: "bg-danger/5" },
};

const SIGN_TINT: Record<SignStatus, string> = {
  "apple":         "text-phos",
  "developer-id":  "text-ink-muted",
  "ad-hoc":        "text-amber",
  "unsigned":      "text-amber",
  "invalid":       "text-danger",
  "missing":       "text-danger",
  "":              "text-ink-dim",
};

const ALL_SIGNALS: KillSignal[] = ["TERM", "KILL", "STOP", "CONT", "HUP"];

type Toast = { id: number; text: string; tone: "ok" | "warn" | "err" };
type KillTarget =
  | { mode: "single"; entry: ProcessEntry }
  | { mode: "bulk";   entries: ProcessEntry[] };

export default function Processes() {
  const [entries,       setEntries]       = useState<ProcessEntry[]>([]);
  const [busy,          setBusy]          = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [unsignedOnly,  setUnsignedOnly]  = useState(true);
  const [query,         setQuery]         = useState("");
  const [selected,      setSelected]      = useState<Set<number>>(new Set());
  const [killTarget,    setKillTarget]    = useState<KillTarget | null>(null);
  const [toasts,        setToasts]        = useState<Toast[]>([]);

  async function run(uo: boolean) {
    setBusy(true); setError(null);
    try {
      const r = await fetchProcesses(uo);
      setEntries(r.entries);
      // Drop selections for PIDs that no longer exist
      const live = new Set(r.entries.map((e) => e.pid));
      setSelected((sel) => new Set([...sel].filter((p) => live.has(p))));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void run(unsignedOnly); }, [unsignedOnly]);

  function toast(text: string, tone: Toast["tone"] = "ok") {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }

  function toggleSelected(pid: number) {
    setSelected((sel) => {
      const next = new Set(sel);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      e.name.toLowerCase().includes(q)   ||
      e.exe.toLowerCase().includes(q)    ||
      e.cmdline.toLowerCase().includes(q)||
      String(e.pid) === q
    );
  }, [entries, query]);

  const counts = useMemo(() => {
    const c = { high: 0, warn: 0, info: 0 };
    for (const e of entries) c[e.severity]++;
    return c;
  }, [entries]);

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.has(e.pid)),
    [entries, selected],
  );
  const allVisibleSelected =
    visible.length > 0 && visible.every((e) => selected.has(e.pid));

  function selectAllVisible() {
    setSelected((sel) => {
      const next = new Set(sel);
      if (allVisibleSelected) {
        for (const e of visible) next.delete(e.pid);
      } else {
        for (const e of visible) next.add(e.pid);
      }
      return next;
    });
  }

  async function performKill(
    target: KillTarget, signal: KillSignal,
    opts: { admin: boolean; confirm: boolean },
  ) {
    try {
      if (target.mode === "single") {
        const r = await killProcess(target.entry.pid, signal, opts);
        handleSingleResult(r);
      } else {
        const r = await killBulk(target.entries.map((e) => e.pid), signal, opts);
        const failures = r.results.filter((x) => !x.ok);
        toast(
          `Bulk SIG${signal}: ${r.successful}/${r.total} killed` +
            (failures.length ? ` · ${failures.length} failed` : ""),
          failures.length === 0 ? "ok" : r.successful > 0 ? "warn" : "err",
        );
        // Show failures inline
        for (const f of failures.slice(0, 3)) {
          toast(`PID ${f.pid}: ${f.error}`, "err");
        }
      }
      setKillTarget(null);
      setSelected(new Set());
      // Rescan after a beat so the table reflects reality
      setTimeout(() => run(unsignedOnly), 350);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    }
  }

  function handleSingleResult(r: KillResult) {
    if (r.ok) {
      toast(`PID ${r.pid} (${r.name ?? ""}): SIG${r.signal} sent ✓`, "ok");
    } else if (r.need_confirm) {
      toast(`PID ${r.pid}: needs confirmation — ${r.reason}`, "warn");
    } else {
      toast(`PID ${r.pid}: ${r.error}`, "err");
    }
  }

  return (
    <div className="h-full flex flex-col relative">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Forensics</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Process Inspector
            </h2>
          </div>

          <div className="flex items-end gap-5">
            <Counter label="HIGH" count={counts.high} tone="text-danger" />
            <Counter label="WARN" count={counts.warn} tone="text-amber" />
            <Counter label="INFO" count={counts.info} tone="text-ink-muted" />
          </div>

          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="filter by name / pid / path"
                 className="flex-1 max-w-xs bg-bg-card border border-divider rounded
                            px-3 py-1.5 text-sm font-mono text-ink-primary
                            placeholder:text-ink-dim focus:outline-none focus:border-accent
                            focus:ring-1 focus:ring-accent/30" />

          <label className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-ink-muted">
            <input type="checkbox" checked={unsignedOnly}
                   onChange={(e) => setUnsignedOnly(e.target.checked)} />
            Unsigned only
          </label>

          <button onClick={() => run(unsignedOnly)} disabled={busy}
                  className="bg-accent hover:bg-accentDim active:translate-y-px
                             text-white text-xs font-bold tracking-wide
                             px-3.5 py-1.5 rounded transition border border-accent/60
                             disabled:opacity-50">
            {busy ? "Scanning…" : "↻ Rescan"}
          </button>
        </div>
      </header>

      {selected.size > 0 && (
        <div className="border-b border-divider bg-amber/5 px-6 py-2 flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-[0.2em] text-amber">
            {selected.size} selected
          </span>
          <button onClick={() => setSelected(new Set())}
            className="text-[11px] text-ink-dim hover:text-ink-primary transition">
            clear
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setKillTarget({ mode: "bulk", entries: selectedEntries })}
            className="bg-danger/80 hover:bg-danger text-white text-xs font-bold
                       tracking-wide px-3 py-1.5 rounded border border-danger/60"
          >
            ✖ Kill selected…
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono mb-4">Error — {error}</div>
        )}
        {busy && entries.length === 0 && (
          <div className="text-ink-dim text-xs">Enumerating processes…</div>
        )}
        {visible.length > 0 && (
          <section className="border border-divider rounded-md overflow-hidden">
            <div className="grid grid-cols-[24px_60px_1fr_120px_160px_70px_60px] gap-3 px-3 py-1.5
                            bg-bg-panel border-b border-divider text-[10px]
                            uppercase tracking-[0.2em] text-ink-dim items-center">
              <input type="checkbox" checked={allVisibleSelected}
                     onChange={selectAllVisible}
                     className="cursor-pointer" />
              <span>PID</span>
              <span>Name · Cmdline</span>
              <span>Signature</span>
              <span>Listening</span>
              <span>User</span>
              <span></span>
            </div>
            <div className="font-mono text-[11px]">
              {visible.map((e, i) => (
                <div key={e.pid}
                     className={"grid grid-cols-[24px_60px_1fr_120px_160px_70px_60px] gap-3 px-3 py-2 " +
                                "border-l-2 items-center " + SEV[e.severity].bg + " " +
                                (e.severity === "high" ? "border-l-danger" :
                                 e.severity === "warn" ? "border-l-amber" :
                                                          "border-l-transparent ") +
                                (i % 2 === 0 ? "" : " bg-opacity-50")}>
                  <input type="checkbox" checked={selected.has(e.pid)}
                         onChange={() => toggleSelected(e.pid)}
                         className="cursor-pointer" />
                  <span className="text-ink-primary tabular-nums">{e.pid}</span>
                  <div>
                    <div className="text-ink-primary truncate">{e.name}</div>
                    <div className={"text-[10px] mt-0.5 truncate " +
                                    (e.suspicious_path ? "text-danger" : "text-ink-dim")}>
                      {e.exe || "(no exe)"}
                      {e.suspicious_path && " · ⚠ temp dir"}
                    </div>
                    {e.cmdline && e.cmdline !== e.exe && (
                      <div className="text-[10px] mt-0.5 text-ink-muted truncate">
                        {e.cmdline}
                      </div>
                    )}
                  </div>
                  <span className={"flex items-center gap-1.5 " + SIGN_TINT[e.sign_status]}>
                    <span className={"inline-block w-1.5 h-1.5 rounded-full " + SEV[e.severity].dot} />
                    {e.sign_status || "—"}
                  </span>
                  <span className="text-ink-muted text-[10px]">
                    {e.listeners.length === 0
                      ? <span className="text-ink-dim">—</span>
                      : e.listeners.slice(0, 3).map((l) =>
                          `${l.proto} ${l.port}`).join(", ") +
                        (e.listeners.length > 3 ? ` +${e.listeners.length - 3}` : "")}
                  </span>
                  <span className="text-ink-muted truncate">{e.username}</span>
                  <button
                    onClick={() => setKillTarget({ mode: "single", entry: e })}
                    title={`Kill PID ${e.pid}`}
                    className="text-[11px] font-bold text-ink-dim hover:text-danger transition
                               border border-divider hover:border-danger/60 rounded
                               px-2 py-0.5"
                  >
                    ✖
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
        {!busy && visible.length === 0 && !error && (
          <div className="text-ink-dim text-xs">No processes match.</div>
        )}
      </div>

      {killTarget && (
        <KillModal
          target={killTarget}
          onCancel={() => setKillTarget(null)}
          onKill={(signal, opts) => performKill(killTarget, signal, opts)}
        />
      )}

      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((t) => (
          <div key={t.id}
            className={"px-3 py-2 rounded border font-mono text-[11px] shadow-lg " +
              (t.tone === "ok"   ? "bg-phos/10 border-phos/40 text-phos" :
               t.tone === "warn" ? "bg-amber/10 border-amber/40 text-amber" :
                                   "bg-danger/10 border-danger/40 text-danger")}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function KillModal({
  target, onCancel, onKill,
}: {
  target: KillTarget;
  onCancel: () => void;
  onKill: (signal: KillSignal, opts: { admin: boolean; confirm: boolean }) => void;
}) {
  const [signal, setSignal] = useState<KillSignal>("TERM");
  const [admin,  setAdmin]  = useState(false);

  const procs = target.mode === "single" ? [target.entry] : target.entries;
  const apple = procs.some((p) => p.sign_status === "apple");
  const lowPid = procs.some((p) => p.pid <= 100);
  const otherUser = procs.some((p) => p.username && p.username !== procs[0].username);
  const risky = apple || lowPid || otherUser;

  const headerLabel =
    target.mode === "single"
      ? `Kill PID ${target.entry.pid} · ${target.entry.name}`
      : `Bulk kill · ${procs.length} processes`;

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center px-6"
         onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-bg-card border border-divider rounded-md shadow-2xl
                   w-full max-w-md p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-danger mb-1">
          Confirm kill
        </div>
        <div className="text-sm font-mono text-ink-primary mb-3 break-all">
          {headerLabel}
        </div>

        {target.mode === "single" && (
          <div className="mb-4 rounded border border-divider bg-bg-base px-3 py-2 text-[11px] font-mono">
            <div className="text-ink-muted">{target.entry.exe}</div>
            {target.entry.cmdline && (
              <div className="text-ink-dim mt-1 truncate">{target.entry.cmdline}</div>
            )}
            <div className="mt-1 text-ink-dim">
              user: {target.entry.username} · signature: {target.entry.sign_status || "—"}
            </div>
          </div>
        )}

        {target.mode === "bulk" && (
          <div className="mb-4 max-h-40 overflow-auto rounded border border-divider
                          bg-bg-base px-3 py-2 text-[11px] font-mono">
            {procs.map((p) => (
              <div key={p.pid} className="text-ink-muted">
                {p.pid} · {p.name}{p.sign_status === "apple" ? " · apple" : ""}
              </div>
            ))}
          </div>
        )}

        <div className="mb-3">
          <label className="text-[10px] uppercase tracking-widest text-ink-dim">
            Signal
          </label>
          <div className="flex mt-1 rounded overflow-hidden border border-divider">
            {ALL_SIGNALS.map((s) => (
              <button key={s}
                onClick={() => setSignal(s)}
                className={"flex-1 px-2 py-1.5 text-[11px] font-bold tracking-wide transition " +
                  (signal === s
                    ? "bg-danger/20 text-danger border-r border-danger/40"
                    : "bg-bg-card text-ink-dim hover:text-ink-primary border-r border-divider")
                }>
                {s}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-ink-dim mt-1">
            {signal === "TERM" && "Polite (sig 15) — process gets to clean up"}
            {signal === "KILL" && "Hard (sig 9) — uncatchable, no cleanup"}
            {signal === "STOP" && "Pause (sig 17) — process freezes"}
            {signal === "CONT" && "Resume (sig 19) — unfreezes a STOPped process"}
            {signal === "HUP"  && "Hangup (sig 1) — daemons often reload config on this"}
          </div>
        </div>

        <label className="flex items-center gap-2 text-[11px] mb-4">
          <input type="checkbox" checked={admin}
                 onChange={(e) => setAdmin(e.target.checked)} />
          <span className={admin ? "text-danger" : "text-ink-muted"}>
            Admin escalation (osascript prompt for sudo)
          </span>
        </label>

        {risky && !admin && (
          <div className="mb-4 rounded border-l-4 border-amber/40 border-y border-r border-divider
                          bg-amber/5 px-3 py-2 text-[11px] font-mono text-amber">
            ⚠ {apple   && "Apple-signed process — killing system services may destabilise macOS. "}
              {lowPid  && "Low PID — likely a system bootstrap process. "}
              {otherUser && "Some processes not owned by you — they'll fail without admin. "}
            Proceeding will confirm anyway.
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="text-[12px] font-bold tracking-wide px-4 py-1.5 rounded
                       bg-bg-card border border-divider text-ink-muted
                       hover:text-ink-primary transition">
            Cancel
          </button>
          <button
            onClick={() => onKill(signal, { admin, confirm: true })}
            className="text-[12px] font-bold tracking-wide px-4 py-1.5 rounded
                       bg-danger/80 hover:bg-danger text-white border border-danger/60">
            ✖ Send SIG{signal}
          </button>
        </div>
      </div>
    </div>
  );
}

function Counter({ label, count, tone }:
  { label: string; count: number; tone: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-widest text-ink-dim">{label}</div>
      <div className={"text-base font-bold tabular-nums " + tone}>{count}</div>
    </div>
  );
}
