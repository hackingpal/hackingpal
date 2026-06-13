import { useState } from "react";
import AdAuthForm, { useAdCreds } from "../components/AdAuthForm";
import { authFetch, parseError } from "../api";
import { useLabIntent, intentHost } from "../lib/labIntent";
import SeverityBadge, { normalizeSeverity } from "../components/SeverityBadge";
import CopyButton from "../components/CopyButton";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";

type Share = {
  name: string; type: number; comment: string;
  readable: boolean; files: { name: string; size: number; is_dir: boolean }[];
};

type Finding = {
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string; detail: string; evidence?: unknown;
};

type EnumResponse = {
  target: string;
  server: { name: string; os: string; domain: string };
  shares: Share[];
  logged_in_users: { username: string; logon_domain: string }[];
  findings: Finding[];
};

export default function SmbEnum() {
  const intent = useLabIntent("smb");
  const [creds, setCreds] = useAdCreds();
  const [target, setTarget] = useState(intentHost(intent) ?? "");
  const [result, setResult] = useState<EnumResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await authFetch(`/smb/enum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creds, target, list_files: true }),
      });
      if (!r.ok) throw new Error(await parseError(r));
      setResult(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">SMB ENUMERATOR</h2>
        <p className="text-[11px] text-ink-dim">
          Impacket-based SMB enumeration: shares + read/write probes, OS info, logged-in
          users via RPC. Leave username/password empty for a null session.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3 mb-4">
        <AdAuthForm creds={creds} setCreds={setCreds} disabled={loading} />
        <div>
          <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
            TARGET (optional — defaults to DC HOST)
          </label>
          <input value={target} onChange={(e) => setTarget(e.target.value)}
                 disabled={loading} placeholder="fileserver01.corp.local"
                 className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                            text-[12px] font-mono focus:outline-none focus:border-accent" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={go} disabled={loading || !creds.dc_host}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? "Enumerating…" : "Enumerate"}
          </button>
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      {!result && !loading && !error && (
        <EmptyState
          icon="🗂️"
          title="SMB enumerator"
          description="Impacket-based: shares, read/write probes, OS info, RPC user list. Leave creds blank for null session."
          hint="Use the AD form above to authenticate, then click Enumerate."
        />
      )}

      {result && (
        <div className="space-y-3">
          {/* Server card */}
          <div className="bg-bg-card border border-divider rounded p-3 text-[12px]">
            <div className="text-[10px] text-ink-muted tracking-wider mb-1">SERVER</div>
            <div className="grid grid-cols-3 gap-3 text-[12px]">
              <div><span className="text-ink-dim">Name:</span> <span className="text-accent font-mono">{result.server.name}</span></div>
              <div><span className="text-ink-dim">Domain:</span> <span className="text-ink-primary">{result.server.domain}</span></div>
              <div><span className="text-ink-dim">OS:</span> <span className="text-ink-primary">{result.server.os}</span></div>
            </div>
          </div>

          <StatsBar
            total={result.shares.length}
            critical={result.findings.filter((f) => normalizeSeverity(f.severity) === "critical").length}
            high={result.findings.filter((f) => normalizeSeverity(f.severity) === "high").length}
            medium={result.findings.filter((f) => normalizeSeverity(f.severity) === "medium").length}
            low={result.findings.filter((f) => normalizeSeverity(f.severity) === "low").length}
            extra={`${result.shares.filter((s) => s.readable).length} readable · ${result.logged_in_users.length} users`}
          />

          {/* Findings */}
          {result.findings.length > 0 && (
            <div>
              <div className="text-[11px] text-ink-muted tracking-wider mb-1">FINDINGS</div>
              <div className="space-y-2">
                {result.findings.map((f, i) => {
                  const sev = normalizeSeverity(f.severity);
                  const copyText = `[${sev.toUpperCase()}] ${f.title} — ${f.detail}`;
                  return (
                    <div
                      key={i}
                      style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                      className={"mhp-result-in group border border-divider rounded p-2 " +
                                 (sev === "critical" ? "mhp-critical-pulse" : "")}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <SeverityBadge severity={sev} />
                        <span className="text-ink-primary text-[12px] font-bold">{f.title}</span>
                        <CopyButton text={copyText} className="ml-auto" />
                      </div>
                      <div className="text-[12px] text-ink-muted">{f.detail}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Shares table */}
          <div>
            <div className="text-[11px] text-ink-muted tracking-wider mb-1">
              SHARES ({result.shares.length})
            </div>
            <div className="bg-bg-card border border-divider rounded overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-panel border-b border-divider text-ink-muted text-[10px] tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-1.5">SHARE</th>
                    <th className="text-left px-3 py-1.5 w-20">READABLE</th>
                    <th className="text-left px-3 py-1.5">COMMENT</th>
                    <th className="text-left px-3 py-1.5">FILES SAMPLE</th>
                    <th className="px-3 py-1.5 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {result.shares.map((s, i) => {
                    const filesPreview = s.files.slice(0, 5).map((f) =>
                      `${f.is_dir ? "📁" : "📄"} ${f.name}`).join(", ") + (s.files.length > 5 ? " …" : "");
                    const copyText = `\\\\${result.target}\\${s.name}${s.readable ? " (readable)" : ""}${s.comment ? ` — ${s.comment}` : ""}`;
                    return (
                      <tr
                        key={s.name}
                        style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                        className="mhp-result-in group border-b border-divider align-top hover:bg-bg-nav-hover"
                      >
                        <td className="px-3 py-1.5 font-mono text-accent">{s.name}</td>
                        <td className={"px-3 py-1.5 font-mono " + (s.readable ? "text-phos" : "text-ink-dim")}>
                          {s.readable ? "yes" : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-ink-muted">{s.comment}</td>
                        <td className="px-3 py-1.5 font-mono text-ink-dim">{filesPreview}</td>
                        <td className="px-3 py-1.5"><CopyButton text={copyText} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Logged-in users */}
          {result.logged_in_users.length > 0 && (
            <div>
              <div className="text-[11px] text-ink-muted tracking-wider mb-1">
                LOGGED-IN USERS ({result.logged_in_users.length})
              </div>
              <div className="bg-bg-card border border-divider rounded p-3 text-[12px] font-mono space-y-0.5">
                {result.logged_in_users.map((u, i) => {
                  const display = `${u.logon_domain}\\${u.username}`;
                  return (
                    <div
                      key={i}
                      style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                      className="mhp-result-in group flex items-center gap-2 text-ink-primary"
                    >
                      <span className="flex-1">
                        <span className="text-accent">{u.logon_domain}</span>\
                        <span>{u.username}</span>
                      </span>
                      <CopyButton text={display} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
