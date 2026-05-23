import { useEffect, useState } from "react";
import { fetchLinuxPosture, type LinuxPosture } from "../api";

const STATUS_TINT = (good: boolean | null): string =>
  good === null ? "text-ink-dim" : good ? "text-phos" : "text-danger";

export default function LinuxPosturePage() {
  const [report, setReport] = useState<LinuxPosture | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try { setReport(await fetchLinuxPosture()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void run(); }, []);

  const mac = report?.mac;
  const fw = report?.firewall;
  const sshd = report?.sshd;
  const upd = report?.updates;
  const disk = report?.disk;

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Forensics</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Linux Posture
            </h2>
          </div>
          <div className="flex-1 text-xs text-ink-muted">
            SELinux / AppArmor · firewall · sshd · sysctl hardening · pending
            updates · sudoers perms · disk encryption.
          </div>
          <button onClick={run} disabled={busy}
            className="bg-accent hover:bg-accentDim active:translate-y-px
                       text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                       disabled:opacity-50 border border-accent/60">
            {busy ? "Checking…" : "↻ Rescan"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
        )}

        {report && mac && fw && sshd && upd && disk && (
          <>
            <div className="grid grid-cols-4 gap-3">
              <Stat label="SELinux" value={mac.selinux}
                    good={mac.selinux === "enforcing"} />
              <Stat label="AppArmor" value={
                      mac.apparmor === "enforcing"
                        ? `enforcing (${mac.enforcing_profiles})`
                        : mac.apparmor
                    }
                    good={mac.apparmor === "enforcing"} />
              <Stat label={`Firewall (${fw.backend})`}
                    value={fw.active ? `active · ${fw.rules} rules` : "inactive"}
                    good={fw.active} />
              <Stat label="LUKS"
                    value={disk.any_encrypted ? `${disk.luks_devices.length} vol(s)` : "none"}
                    good={disk.any_encrypted} />
              <Stat label="sshd present" value={sshd.present ? "yes" : "no"}
                    good={sshd.present ? null : null} />
              <Stat label="Root SSH"
                    value={sshd.permit_root_login || "unset"}
                    good={!["yes", "without-password"].includes(
                      (sshd.permit_root_login || "").toLowerCase())} />
              <Stat label="Password SSH"
                    value={sshd.password_authentication || "unset"}
                    good={sshd.password_authentication.toLowerCase() !== "yes"} />
              <Stat label={`Updates (${upd.manager})`}
                    value={`${upd.pending} pending`}
                    good={upd.pending === 0 ? true : upd.pending < 10 ? null : false} />
            </div>

            {report.findings.length > 0 && (
              <Card title={`Findings · ${report.findings.length}`}>
                <ul className="space-y-1">
                  {report.findings.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={"text-[10px] uppercase tracking-widest min-w-[40px] " +
                        (f.severity === "high" ? "text-danger" :
                         f.severity === "warn" ? "text-amber" : "text-ink-muted")}>
                        {f.severity}
                      </span>
                      <span className="text-ink-primary flex-1">{f.label}</span>
                      <span className="text-ink-muted">{f.detail || ""}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card title="sysctl values">
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                {Object.entries(report.sysctl.values).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-divider/40 py-0.5">
                    <span className="text-ink-muted">{k}</span>
                    <span className="text-ink-primary">{v}</span>
                  </div>
                ))}
                {Object.keys(report.sysctl.values).length === 0 && (
                  <div className="text-ink-dim">No sysctl values readable.</div>
                )}
              </div>
            </Card>

            <Card title="sudoers">
              <div className="space-y-0.5">
                <Row k="/etc/sudoers perms" v={report.sudoers.sudoers_perms || "(unreadable)"} />
                <Row k="world-writable"
                     v={report.sudoers.world_writable.length === 0
                          ? "(none)" : report.sudoers.world_writable.join(", ")} />
                <Row k="non-root-owned"
                     v={report.sudoers.non_root_owned.length === 0
                          ? "(none)"
                          : report.sudoers.non_root_owned
                              .map((n) => `${n.path} (uid ${n.uid})`).join(", ")} />
              </div>
            </Card>

            <Card title="Raw output (collapsed)">
              <details><summary className="cursor-pointer text-ink-dim">MAC framework</summary>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{mac.raw}</pre>
              </details>
              <details className="mt-2"><summary className="cursor-pointer text-ink-dim">Firewall</summary>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{fw.raw}</pre>
              </details>
              <details className="mt-2"><summary className="cursor-pointer text-ink-dim">Updates</summary>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{upd.raw}</pre>
              </details>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, good }:
  { label: string; value: string; good: boolean | null }) {
  return (
    <div className="rounded-md border border-divider bg-bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">{label}</div>
      <div className={"mt-0.5 text-base font-mono font-bold " + STATUS_TINT(good)}>
        {value}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-divider/40 py-0.5">
      <span className="text-ink-muted">{k}</span>
      <span className="text-ink-primary">{v}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md overflow-hidden border border-divider">
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel">{title}</header>
      <div className="bg-bg-card p-3 text-xs font-mono">{children}</div>
    </section>
  );
}
