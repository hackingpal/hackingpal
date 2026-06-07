import { useEffect, useState } from "react";
import AdAuthForm, { useAdCreds } from "../components/AdAuthForm";
import AuthorizationGate from "../components/AuthorizationGate";
import { api, authFetch, BACKEND_URL, parseError } from "../api";
import EmptyState from "../components/EmptyState";
import CopyButton from "../components/CopyButton";

type Job = {
  id: string; state: "queued" | "running" | "done" | "error";
  started_at: string; finished_at: string;
  error: string; log_tail: string[]; file_count: number; has_zip: boolean;
};

type JobDetail = Job & { log: string[] };

const DEFAULT_METHODS = ["Default"];
const ALL_METHODS = [
  "Default", "Group", "LocalAdmin", "Session", "ACL",
  "Trusts", "Container", "ObjectProps", "RDP", "DCOM", "PSRemote", "All",
];

export default function BloodHound() {
  const [creds, setCreds] = useAdCreds();
  const [methods, setMethods] = useState<Set<string>>(new Set(DEFAULT_METHODS));
  const [nameserver, setNameserver] = useState("");
  const [workers, setWorkers] = useState(10);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJob, setActiveJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [authorized, setAuthorized] = useState(false);

  async function refresh() {
    try {
      const r = await api<{ jobs: Job[] }>("/bloodhound/jobs");
      setJobs(r.jobs);
      // If our currently-watched job is still in the list, refresh its detail
      if (activeJob) {
        try {
          const d = await api<JobDetail>(`/bloodhound/jobs/${activeJob.id}`);
          setActiveJob(d);
        } catch {
          setActiveJob(null);
        }
      }
    } catch { /* backend may be booting */ }
  }

  // Poll while there's an active or in-flight job; idle otherwise to avoid
  // hammering the backend (and racking up logs) when nothing is happening.
  const shouldPoll =
    activeJob?.state === "queued" || activeJob?.state === "running" ||
    jobs.some((j) => j.state === "queued" || j.state === "running");

  useEffect(() => {
    void refresh();
    if (!shouldPoll) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [activeJob?.id, shouldPoll]);

  async function deleteJob(id: string) {
    try {
      await authFetch(`/bloodhound/jobs/${id}`, { method: "DELETE" });
      if (activeJob?.id === id) setActiveJob(null);
      await refresh();
    } catch { /* ignore */ }
  }

  function toggle(m: string) {
    setMethods((s) => {
      const next = new Set(s);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  }

  async function go() {
    setError("");
    try {
      const r = await authFetch(`/bloodhound/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creds, methods: [...methods],
          nameserver: nameserver.trim(),
          num_workers: workers,
          confirm_auth: true,
        }),
      });
      if (!r.ok) throw new Error(await parseError(r));
      const data = await r.json();
      setActiveJob({ ...data.job, log: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">BLOODHOUND INGESTOR</h2>
        <p className="text-[11px] text-ink-dim">
          Run a SharpHound-equivalent collection against AD via Impacket / ldap3.
          Downloads as a ZIP of JSON files — import into your own BloodHound /
          BloodHound CE instance (Neo4j not bundled here).
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3 mb-4">
        <AdAuthForm creds={creds} setCreds={setCreds} disabled={!!activeJob && activeJob.state === "running"} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
              NAMESERVER (optional)
            </label>
            <input value={nameserver} onChange={(e) => setNameserver(e.target.value)}
                   placeholder="(defaults to DC host)"
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                              text-[12px] font-mono focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
              WORKERS (1–50)
            </label>
            <input type="number" min={1} max={50} value={workers}
                   onChange={(e) => setWorkers(parseInt(e.target.value) || 10)}
                   className="w-20 bg-bg-base border border-divider rounded px-2 py-1.5
                              text-[12px] font-mono focus:outline-none focus:border-accent" />
          </div>
        </div>

        <div>
          <div className="text-[11px] text-ink-muted tracking-wider mb-1">COLLECTION METHODS</div>
          <div className="grid grid-cols-4 gap-1 text-[12px]">
            {ALL_METHODS.map((m) => (
              <label key={m} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={methods.has(m)}
                       onChange={() => toggle(m)} />
                <span className="text-ink-primary">{m}</span>
              </label>
            ))}
          </div>
        </div>

        <AuthorizationGate authorized={authorized} setAuthorized={setAuthorized}
                           toolName="BloodHound AD collection"
                           disabled={activeJob?.state === "running"} />
        <div className="flex items-center gap-2">
          <button onClick={go}
                  disabled={!creds.dc_host || !creds.username || methods.size === 0
                            || (activeJob?.state === "running") || !authorized}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            Start Collection
          </button>
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      {/* Job list */}
      {jobs.length === 0 && !activeJob && !error && (
        <EmptyState
          icon="🐶"
          title="BloodHound ingestor"
          description="SharpHound-equivalent AD collection. Downloads as a ZIP of JSON files for import into BloodHound / BloodHound CE."
          hint="Pick collection methods, then Start Collection."
        />
      )}

      {jobs.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] text-ink-muted tracking-wider mb-1">JOBS</div>
          <div className="space-y-2">
            {jobs.map((j, i) => (
              <div
                key={j.id}
                style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                className="mhp-result-in group border border-divider rounded p-2 flex items-center gap-3"
              >
                <span className={"inline-block w-1.5 h-1.5 rounded-full " + (
                  j.state === "running" ? "bg-amber animate-pulse"
                  : j.state === "done" ? "bg-phos"
                  : j.state === "error" ? "bg-danger"
                  : "bg-ink-dim"
                )} />
                <span className="font-mono text-[11px] text-accent">{j.id}</span>
                <span className="text-[11px] text-ink-primary uppercase">{j.state}</span>
                {j.file_count > 0 && <span className="text-[10px] text-ink-dim">{j.file_count} JSON files</span>}
                <span className="text-[10px] text-ink-dim ml-auto">started {j.started_at}</span>
                {j.has_zip && (
                  <a href={`${BACKEND_URL}/bloodhound/jobs/${j.id}/download`}
                     className="px-2 py-0.5 rounded bg-accent text-white text-[10px] font-bold">
                    Download ZIP
                  </a>
                )}
                <button onClick={() => api(`/bloodhound/jobs/${j.id}`).then((d) => setActiveJob(d as any)).catch(() => {})}
                        className="text-[10px] text-accent hover:underline">view log</button>
                <CopyButton text={j.id} />
                {(j.state === "done" || j.state === "error") && (
                  <button onClick={() => deleteJob(j.id)}
                          title="Remove job + clear its workdir"
                          className="text-[10px] text-ink-dim hover:text-danger">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active job detail */}
      {activeJob && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] text-ink-muted tracking-wider">
              JOB {activeJob.id} · {activeJob.state.toUpperCase()}
            </span>
            <CopyButton
              text={(activeJob.log || activeJob.log_tail || []).join("\n")}
              label="Copy log"
              alwaysVisible
              className="ml-auto"
            />
          </div>
          {activeJob.error && <div className="text-[12px] text-danger mb-2">⚠ {activeJob.error}</div>}
          <pre className="bg-bg-panel border border-divider rounded p-2 text-[11px]
                          font-mono text-phos whitespace-pre-wrap max-h-96 overflow-y-auto">
            {(activeJob.log || activeJob.log_tail || []).join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}
