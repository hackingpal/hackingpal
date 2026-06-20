import { useEffect, useState } from "react";
import { fetchUsersAudit, type UsersAudit } from "../api";
import SeverityBadge, { normalizeSeverity } from "../components/SeverityBadge";
import CopyButton from "../components/CopyButton";
import PromoteToFindingButton from "../components/PromoteToFindingButton";
import EmptyState from "../components/EmptyState";

type Tab = "users" | "groups" | "ssh" | "sudoers" | "findings";

export default function UsersAuditPage() {
  const [report, setReport] = useState<UsersAudit | null>(null);
  const [busy,   setBusy]   = useState(true);
  const [error,  setError]  = useState<string | null>(null);
  const [tab,    setTab]    = useState<Tab>("findings");

  async function run() {
    setBusy(true); setError(null);
    try { setReport(await fetchUsersAudit()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void run(); }, []);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Forensics</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Users Audit
            </h2>
          </div>
          {report && (
            <div className="flex gap-5 items-end">
              <Stat label="Total"      value={String(report.summary.total_users)} />
              <Stat label="Login"      value={String(report.summary.login_users)} />
              <Stat label="System"     value={String(report.summary.system_users)} />
              <Stat label="Priv groups" value={String(report.summary.privileged_groups)} />
              <Stat label="SSH keys"   value={String(report.summary.users_with_ssh_keys)} />
            </div>
          )}
          <div className="flex-1" />
          <div className="flex gap-1">
            {(["findings","users","groups","ssh","sudoers"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                      className={"text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-md border " +
                        (tab === t
                          ? "bg-accent text-white border-accent"
                          : "bg-transparent text-ink-muted border-divider hover:text-ink-primary")}>
                {t}
              </button>
            ))}
          </div>
          <button onClick={run} disabled={busy}
                  className="bg-accent text-white text-xs font-bold px-3 py-1 rounded border border-accent/60 disabled:opacity-50">
            {busy ? "Auditing…" : "↻ Reload"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 space-y-3 font-mono text-[11px]">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2">Error — {error}</div>
        )}

        {report && tab === "findings" && (
          <Card title={`Findings · ${report.findings.length}`}>
            {report.findings.length === 0 ? (
              <EmptyState
                icon="✓"
                title="No findings"
                description="No risky users, weak SSH key perms, or stray sudoers entries."
              />
            ) : (
              <ul className="space-y-1">
                {report.findings.map((f, i) => {
                  const sev = normalizeSeverity(f.severity);
                  return (
                    <li
                      key={i}
                      style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                      className={"mhp-result-in group flex items-center gap-2 px-1 rounded " +
                                 (sev === "critical" ? "mhp-critical-pulse" : "")}
                    >
                      <SeverityBadge severity={sev} />
                      <span className="text-ink-primary flex-1">{f.label}</span>
                      <span className="text-ink-muted">{f.detail || ""}</span>
                      <CopyButton text={`[${sev}] ${f.label}${f.detail ? ` — ${f.detail}` : ""}`} />
                      <PromoteToFindingButton
                        variant="compact"
                        seed={{
                          tool: "users-audit",
                          target: "local-system",
                          title: f.label,
                          severity: sev,
                          description: f.detail || "",
                          evidence: `${f.label}${f.detail ? `\n${f.detail}` : ""}`,
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        {report && tab === "users" && (
          <Card title={`Users · ${report.users.length}`}>
            <div className="grid grid-cols-[1fr_60px_60px_80px_1fr_1fr] gap-2 text-[10px] text-ink-dim
                            uppercase tracking-widest border-b border-divider pb-1">
              <span>Name</span><span>UID</span><span>GID</span><span>Type</span>
              <span>Shell</span><span>Last login</span>
            </div>
            {report.users.map((u) => (
              <div key={u.name} className="grid grid-cols-[1fr_60px_60px_80px_1fr_1fr] gap-2 py-0.5
                                            border-b border-divider/40">
                <span className={u.uid === 0 ? "text-danger" : "text-ink-primary"}>{u.name}</span>
                <span className="text-ink-muted">{u.uid}</span>
                <span className="text-ink-muted">{u.gid}</span>
                <span className={u.is_system ? "text-ink-dim" : u.is_login ? "text-phos" : "text-ink-muted"}>
                  {u.is_login ? (u.is_system ? "sys+login" : "login") : "no-login"}
                </span>
                <span className="text-ink-muted truncate" title={u.shell}>{u.shell}</span>
                <span className="text-ink-muted truncate" title={u.last_login}>{u.last_login || "—"}</span>
              </div>
            ))}
          </Card>
        )}

        {report && tab === "groups" && (
          <Card title="Privileged group membership">
            {Object.entries(report.privileged_groups).map(([grp, members]) => (
              <div key={grp} className="flex items-start gap-3 border-b border-divider/40 py-1">
                <span className="text-ink-primary min-w-[80px]">{grp}</span>
                <span className="text-ink-muted">{members.length ? members.join(", ") : "(no members)"}</span>
              </div>
            ))}
            {Object.keys(report.privileged_groups).length === 0 && (
              <div className="text-ink-dim">No sudo/wheel/admin groups found.</div>
            )}
          </Card>
        )}

        {report && tab === "ssh" && (
          <Card title="SSH authorized_keys">
            {Object.keys(report.ssh_keys).length === 0 && (
              <div className="text-ink-dim">No authorized_keys files found for login users.</div>
            )}
            {Object.entries(report.ssh_keys).map(([user, keys]) => (
              <div key={user} className="border-b border-divider/40 py-1">
                <div className="text-ink-primary">{user}</div>
                {keys.map((k, i) => (
                  <div key={i} className="ml-4 text-ink-muted">
                    <span className="text-phos">{k.type}</span>
                    {" · "}
                    <span className="text-ink-primary">{k.fingerprint}</span>
                    {k.comment && <> · <span className="text-ink-dim">{k.comment}</span></>}
                    {k.perms_ok === "false" && <span className="text-danger ml-2">⚠ bad perms</span>}
                  </div>
                ))}
              </div>
            ))}
          </Card>
        )}

        {report && tab === "sudoers" && (
          <>
            <Card title="/etc/sudoers">
              <Row k="perms" v={report.sudoers.sudoers_perms || "(unreadable)"} />
              <Row k="world-writable"
                   v={report.sudoers.world_writable.length === 0
                        ? "(none)" : report.sudoers.world_writable.join(", ")} />
              <Row k="non-root-owned"
                   v={report.sudoers.non_root_owned.length === 0
                        ? "(none)"
                        : report.sudoers.non_root_owned.map((n) => `${n.path} (uid ${n.uid})`).join(", ")} />
            </Card>
            <Card title={`/etc/sudoers.d · ${report.sudoers.dropin_files.length}`}>
              {report.sudoers.dropin_files.length === 0 && (
                <div className="text-ink-dim">No drop-in files.</div>
              )}
              {report.sudoers.dropin_files.map((f, i) => (
                <Row key={i} k={f.path} v={`perms=${f.perms} uid=${f.uid}`} />
              ))}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</div>
      <div className="text-base font-mono font-bold text-ink-primary">{value}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-divider/40 py-0.5">
      <span className="text-ink-muted truncate" title={k}>{k}</span>
      <span className="text-ink-primary text-right truncate ml-2" title={v}>{v}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-divider overflow-hidden">
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel">{title}</header>
      <div className="bg-bg-card p-3">{children}</div>
    </section>
  );
}
