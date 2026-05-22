import { useState } from "react";
import AdAuthForm, { useAdCreds } from "../components/AdAuthForm";
import { useAttackWS } from "../components/webattack/useAttackWS";

type SprayEvent =
  | { type: "started"; total: number; lockout_threshold: number; safe_threshold: number }
  | { type: "attempt"; user: string; password_index: number;
      status: "success" | "fail" | "locked" | "error" | "skipped"; detail: string }
  | { type: "progress"; done: number; total: number; success: number; locked: number }
  | { type: "done"; elapsed: number; successes: { user: string; password: string }[];
      locked_count: number; stopped: boolean }
  | { type: "error"; detail: string };

type Attempt = SprayEvent & { type: "attempt" };

export default function AdSpray() {
  const [creds, setCreds] = useAdCreds();
  const [usersText, setUsersText] = useState("");
  const [passwordsText, setPasswordsText] = useState("Spring2026!\nWinter2026!\nPassword1!");
  const [delay, setDelay] = useState(0.5);
  const [maxLockouts, setMaxLockouts] = useState(0);

  const [meta, setMeta] = useState<{ total: number; threshold: number; safe: number } | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, success: 0, locked: 0 });
  const [successes, setSuccesses] = useState<{ user: string; password: string }[]>([]);
  const [doneText, setDoneText] = useState("");

  const { status, error, start, stop } = useAttackWS<SprayEvent>(
    "/ws/ad-spray",
    (ev) => {
      if (ev.type === "started") {
        setMeta({ total: ev.total, threshold: ev.lockout_threshold, safe: ev.safe_threshold });
        setAttempts([]); setSuccesses([]); setDoneText("");
        setProgress({ done: 0, total: ev.total, success: 0, locked: 0 });
      } else if (ev.type === "attempt") {
        setAttempts((a) => [...a.slice(-500), ev]);  // keep last 500
      } else if (ev.type === "progress") {
        setProgress({ done: ev.done, total: ev.total,
                      success: ev.success, locked: ev.locked });
      } else if (ev.type === "done") {
        setSuccesses(ev.successes);
        setDoneText(`done in ${ev.elapsed}s · ${ev.successes.length} successes · ${ev.locked_count} locked${ev.stopped ? " (stopped)" : ""}`);
      }
    },
    "/ad-spray/run",
  );

  const running = status === "connecting" || status === "running";

  function go() {
    const users = usersText.split("\n").map((s) => s.trim()).filter(Boolean);
    const passwords = passwordsText.split("\n").map((s) => s.trim()).filter(Boolean);
    start({ creds, users, passwords, delay_sec: delay, max_lockouts: maxLockouts });
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">AD PASSWORD SPRAYER</h2>
        <p className="text-[11px] text-ink-dim">
          Tries each password against each user via LDAP NTLM bind. Reads
          <code className="text-amber"> lockoutThreshold</code> from the domain
          policy upfront and stops each user at threshold-1 to avoid locking them.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3 mb-4">
        <AdAuthForm creds={creds} setCreds={setCreds} disabled={running} />
        <div className="border-t border-divider pt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
              USERS (one per line)
            </label>
            <textarea value={usersText} onChange={(e) => setUsersText(e.target.value)}
                      disabled={running} rows={8}
                      placeholder="alice&#10;bob&#10;svc-backup"
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] font-mono focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
              PASSWORDS (one per line)
            </label>
            <textarea value={passwordsText} onChange={(e) => setPasswordsText(e.target.value)}
                      disabled={running} rows={8}
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] font-mono focus:outline-none focus:border-accent" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <label>delay
            <input type="number" min={0.1} max={10} step={0.1} value={delay}
                   onChange={(e) => setDelay(parseFloat(e.target.value) || 0.5)}
                   disabled={running}
                   className="ml-1 w-16 bg-bg-base border border-divider rounded px-1.5 py-0.5
                              text-[12px] font-mono focus:outline-none focus:border-accent" />s
          </label>
          <label>stop after
            <input type="number" min={0} value={maxLockouts}
                   onChange={(e) => setMaxLockouts(parseInt(e.target.value) || 0)}
                   disabled={running}
                   className="ml-1 w-16 bg-bg-base border border-divider rounded px-1.5 py-0.5
                              text-[12px] font-mono focus:outline-none focus:border-accent" />
            lockouts (0 = unlimited)
          </label>
        </div>
        <div className="flex items-center gap-2">
          {!running ? (
            <button onClick={go} disabled={!usersText.trim() || !passwordsText.trim() || !creds.dc_host}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              Start Spray
            </button>
          ) : (
            <button onClick={stop}
                    className="px-3 py-1.5 rounded bg-bg-base border border-danger text-danger text-[12px]">
              Stop
            </button>
          )}
          {meta && (
            <span className="text-[11px] text-ink-dim">
              total: {meta.total} · lockout threshold: {meta.threshold || "none"} · safe: {meta.safe || "∞"}
            </span>
          )}
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      {/* Successes — most important */}
      {successes.length > 0 && (
        <div className="bg-phos/10 border border-phos/40 rounded p-3 mb-3">
          <div className="text-[12px] font-bold text-phos mb-1">
            ✓ {successes.length} SUCCESS{successes.length === 1 ? "" : "ES"}
          </div>
          {successes.map((s, i) => (
            <div key={i} className="text-[12px] font-mono">
              <span className="text-phos">{s.user}</span>
              <span className="text-ink-dim"> : </span>
              <span className="text-amber">{s.password}</span>
            </div>
          ))}
        </div>
      )}

      {/* Progress + attempts log */}
      {(progress.total > 0 || attempts.length > 0) && (
        <div>
          <div className="text-[11px] text-ink-muted tracking-wider mb-1 flex items-center gap-3">
            <span>PROGRESS: {progress.done}/{progress.total}</span>
            <span className="text-phos">{progress.success} success</span>
            <span className="text-danger">{progress.locked} locked</span>
            {doneText && <span className="text-ink-dim ml-auto">{doneText}</span>}
          </div>
          <div className="bg-bg-card border border-divider rounded overflow-hidden max-h-96 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-bg-panel border-b border-divider sticky top-0 text-ink-muted text-[10px]">
                <tr>
                  <th className="text-left px-3 py-1">USER</th>
                  <th className="text-left px-3 py-1 w-20">PWD#</th>
                  <th className="text-left px-3 py-1 w-20">STATUS</th>
                  <th className="text-left px-3 py-1">DETAIL</th>
                </tr>
              </thead>
              <tbody>
                {attempts.slice(-300).map((a, i) => {
                  const cls = a.status === "success" ? "text-phos"
                            : a.status === "locked" ? "text-danger"
                            : a.status === "skipped" ? "text-amber"
                            : "text-ink-dim";
                  return (
                    <tr key={i} className="border-b border-divider">
                      <td className="px-3 py-1 font-mono text-ink-primary">{a.user}</td>
                      <td className="px-3 py-1 font-mono tabular-nums">{a.password_index}</td>
                      <td className={"px-3 py-1 uppercase font-mono " + cls}>{a.status}</td>
                      <td className="px-3 py-1 font-mono text-ink-muted truncate max-w-md">{a.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
