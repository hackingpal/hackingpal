import { useEffect, useState } from "react";
import { fetchWindowsPosture, type WindowsPosture } from "../api";
import SeverityBadge, { normalizeSeverity } from "../components/SeverityBadge";
import CopyButton from "../components/CopyButton";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";

const STATUS_TINT = (good: boolean | null): string =>
  good === null ? "text-ink-dim" : good ? "text-phos" : "text-danger";

export default function WindowsPosturePage() {
  const [report, setReport] = useState<WindowsPosture | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try { setReport(await fetchWindowsPosture()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void run(); }, []);

  const bl  = report?.bitlocker;
  const df  = report?.defender;
  const uac = report?.uac;
  const fw  = report?.firewall;
  const ss  = report?.smartscreen;
  const sb  = report?.secureboot;
  const upd = report?.updates;

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Forensics</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Windows Posture
            </h2>
          </div>
          <div className="flex-1 text-xs text-ink-muted">
            BitLocker · Defender · UAC · Firewall · SmartScreen · Secure Boot · last
            Windows update.
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

        {!report && !busy && !error && (
          <EmptyState
            icon="🪟"
            title="Windows posture"
            description="BitLocker · Defender · UAC · Firewall · SmartScreen · Secure Boot · last update."
          />
        )}
        {report && bl && df && uac && fw && ss && sb && upd && (
          <>
            <StatsBar
              total={report.findings.length}
              critical={report.findings.filter((f) => normalizeSeverity(f.severity) === "critical").length}
              high={report.findings.filter((f) => normalizeSeverity(f.severity) === "high").length}
              medium={report.findings.filter((f) => normalizeSeverity(f.severity) === "medium").length}
              extra="Windows"
            />
            <div className="grid grid-cols-4 gap-3">
              <Stat label="BitLocker"
                    value={bl.status === "enabled"
                      ? `on · ${bl.method || "encrypted"}`
                      : bl.status === "partial"
                        ? `${bl.percentage || 0}% encrypted`
                        : bl.status}
                    good={bl.status === "enabled" ? true :
                          bl.status === "disabled" ? false : null} />
              <Stat label="Defender RT"
                    value={df.realtime ? "on" : df.status}
                    good={df.realtime === true ? true :
                          df.realtime === false ? false : null} />
              <Stat label="Tamper Protect"
                    value={df.tamper_protected ? "on" : "off"}
                    good={df.tamper_protected === true ? true :
                          df.tamper_protected === false ? false : null} />
              <Stat label="UAC"
                    value={uac.status === "enabled"
                      ? `EnableLUA=${uac.enable_lua}` : uac.status}
                    good={uac.enable_lua === 1 ? true :
                          uac.enable_lua === 0 ? false : null} />
              <Stat label="Firewall"
                    value={fw.all_enabled
                      ? `all profiles on`
                      : `${fw.profiles.filter((p) => p.enabled).length}/${fw.profiles.length} on`}
                    good={fw.all_enabled} />
              <Stat label="SmartScreen"
                    value={ss.status}
                    good={ss.status === "enabled" ? true :
                          ss.status === "disabled" ? false : null} />
              <Stat label="Secure Boot"
                    value={sb.status}
                    good={sb.status === "enabled" ? true :
                          sb.status === "disabled" ? false :
                          sb.status === "legacy-bios" ? null : null} />
              <Stat label="Last update"
                    value={upd.days_since_last >= 0
                      ? `${upd.days_since_last}d ago`
                      : "unknown"}
                    good={upd.days_since_last < 0 ? null :
                          upd.days_since_last <= 30 ? true :
                          upd.days_since_last <= 60 ? null : false} />
            </div>

            {report.findings.length > 0 && (
              <Card title={`Findings · ${report.findings.length}`}>
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
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

            <Card title="Firewall profiles">
              <div className="space-y-0.5">
                {fw.profiles.map((p) => (
                  <div key={p.name}
                       className="flex justify-between border-b border-divider/40 py-0.5">
                    <span className="text-ink-muted">{p.name}</span>
                    <span className={p.enabled ? "text-phos" : "text-danger"}>
                      {p.enabled ? "on" : "off"} · in:{p.inbound} · out:{p.outbound}
                    </span>
                  </div>
                ))}
                {fw.profiles.length === 0 && (
                  <div className="text-ink-dim">No firewall profiles reported.</div>
                )}
              </div>
            </Card>

            <Card title={`Defender (sig ${df.sig_version || "?"})`}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                <Row k="Antivirus"          v={df.antivirus ? "on" : "off"} />
                <Row k="Real-time"          v={df.realtime ? "on" : "off"} />
                <Row k="Anti-spyware"       v={df.antispyware ? "on" : "off"} />
                <Row k="Tamper Protection"  v={df.tamper_protected ? "on" : "off"} />
                <Row k="Behaviour Monitor"  v={df.behaviour_monitor ? "on" : "off"} />
                <Row k="IOAV Protection"    v={df.ioav_protection ? "on" : "off"} />
                <Row k="Network Inspection" v={df.network_inspection ? "on" : "off"} />
                <Row k="Sig updated"        v={df.sig_updated || "unknown"} />
              </div>
            </Card>

            <Card title="UAC">
              <div className="space-y-0.5">
                <Row k="EnableLUA"             v={String(uac.enable_lua)} />
                <Row k="ConsentPromptBehaviorAdmin" v={String(uac.consent_prompt_admin)} />
                <Row k="ConsentPromptBehaviorUser"  v={String(uac.consent_prompt_user)} />
                <Row k="PromptOnSecureDesktop"      v={String(uac.prompt_on_secure_desktop)} />
              </div>
            </Card>

            {upd.recent.length > 0 && (
              <Card title="Recent hotfixes">
                <div className="space-y-0.5">
                  {upd.recent.map((h, i) => (
                    <div key={i}
                         className="flex justify-between border-b border-divider/40 py-0.5">
                      <span className="text-ink-muted">{h.id} · {h.description}</span>
                      <span className="text-ink-primary">{h.installed || "?"}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card title="Raw output (collapsed)">
              <details><summary className="cursor-pointer text-ink-dim">BitLocker</summary>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{bl.raw}</pre>
              </details>
              <details className="mt-2"><summary className="cursor-pointer text-ink-dim">Defender</summary>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{df.raw}</pre>
              </details>
              <details className="mt-2"><summary className="cursor-pointer text-ink-dim">Firewall</summary>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{fw.raw}</pre>
              </details>
              <details className="mt-2"><summary className="cursor-pointer text-ink-dim">Secure Boot</summary>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{sb.raw}</pre>
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
