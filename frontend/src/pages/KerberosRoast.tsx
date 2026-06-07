import { useState } from "react";
import AdAuthForm, { useAdCreds } from "../components/AdAuthForm";
import AuthorizationGate from "../components/AuthorizationGate";
import { authFetch, parseError } from "../api";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";

type Mode = "kerberoast" | "asrep";

type HashEntry = {
  user: string; spn?: string; etype?: number;
  hashcat_mode?: number; hash?: string; error?: string;
};

type RoastResponse = {
  targets?: { sam: string; spns: string[] }[];
  users?: string[];
  hashes: HashEntry[];
  hashcat_hint: string;
  message?: string;
};

export default function KerberosRoast() {
  const [mode, setMode] = useState<Mode>("kerberoast");
  const [creds, setCreds] = useAdCreds();
  const [spnFilter, setSpnFilter] = useState("");
  const [usersText, setUsersText] = useState("");
  const [result, setResult] = useState<RoastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authorized, setAuthorized] = useState(false);

  async function go() {
    setLoading(true); setError(""); setResult(null);
    try {
      const path = mode === "kerberoast" ? "/kerberoast/run" : "/asrep/run";
      const body = mode === "kerberoast"
        ? { creds, spn_filter: spnFilter, confirm_auth: true }
        : { creds, users: usersText.split("\n").map((s) => s.trim()).filter(Boolean),
            confirm_auth: true };
      const r = await authFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await parseError(r));
      setResult(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  const hasCreds =
    !!creds.username && !!creds.domain && !!creds.dc_host &&
    (!!creds.password || !!creds.nt_hash);
  const userList = usersText.split("\n").map((s) => s.trim()).filter(Boolean);
  const canRoast =
    mode === "kerberoast"
      ? hasCreds
      : hasCreds || (!!creds.dc_host && !!creds.domain && userList.length > 0);
  const disabledReason =
    !creds.dc_host || !creds.domain
      ? "Fill in DC host and domain to continue."
      : mode === "kerberoast"
      ? "Kerberoasting requires valid AD creds (any user)."
      : "AS-REP needs either creds (for LDAP enum) or a user list.";

  const crackableCount = result?.hashes.filter((h) => h.hash).length ?? 0;
  const modesSeen = Array.from(
    new Set(
      (result?.hashes ?? [])
        .map((h) => h.hashcat_mode)
        .filter((m): m is number => typeof m === "number"),
    ),
  ).sort((a, b) => a - b);

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">KERBEROS ROASTING</h2>
        <p className="text-[11px] text-ink-dim">
          Produce hashcat-format crackable material from AD. Kerberoasting needs
          any valid AD account. AS-REP Roasting needs no account if you supply
          a user list, or any account to enumerate UF_DONT_REQUIRE_PREAUTH users
          automatically.
        </p>
      </header>

      <div className="flex gap-2 mb-3">
        {(["kerberoast", "asrep"] as Mode[]).map((m) => (
          <button key={m} onClick={() => { setMode(m); setResult(null); }}
                  className={"px-3 py-1.5 rounded text-[12px] tracking-wider uppercase " +
                    (mode === m
                      ? "bg-accent text-white font-bold"
                      : "bg-bg-base border border-divider text-ink-primary hover:bg-bg-nav-hover")}>
            {m === "kerberoast" ? "Kerberoasting" : "AS-REP Roasting"}
          </button>
        ))}
      </div>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3 mb-4">
        <AdAuthForm creds={creds} setCreds={setCreds} disabled={loading} />

        {mode === "kerberoast" ? (
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
              SPN FILTER (optional)
            </label>
            <input value={spnFilter} onChange={(e) => setSpnFilter(e.target.value)}
                   disabled={loading} placeholder="MSSQL"
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                              text-[12px] font-mono focus:outline-none focus:border-accent" />
          </div>
        ) : (
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
              USERS (one per line — leave empty to enumerate via LDAP)
            </label>
            <textarea value={usersText} onChange={(e) => setUsersText(e.target.value)}
                      disabled={loading} rows={4}
                      placeholder="alice&#10;bob"
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] font-mono focus:outline-none focus:border-accent" />
          </div>
        )}

        <AuthorizationGate authorized={authorized} setAuthorized={setAuthorized}
                           toolName={mode === "kerberoast" ? "Kerberos roasting" : "AS-REP roasting"}
                           disabled={loading} />
        <div className="flex items-center gap-2">
          <button onClick={go} disabled={loading || !canRoast || !authorized}
                  title={canRoast ? "" : disabledReason}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? "Roasting…" : "Roast"}
          </button>
          {!canRoast && !error && (
            <span className="text-[11px] text-ink-dim">{disabledReason}</span>
          )}
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      {!result && !loading && !error && (
        <EmptyState
          icon="🔑"
          title={mode === "kerberoast" ? "Kerberoasting" : "AS-REP Roasting"}
          description={mode === "kerberoast"
            ? "Request TGS-REQ tickets for SPN-bearing accounts → produces hashcat-ready hashes (mode 13100)."
            : "Request AS-REP for UF_DONT_REQUIRE_PREAUTH accounts → produces hashcat-ready hashes (mode 18200)."}
          hint="Fill AD form above (AS-REP can use a user list with no creds)."
        />
      )}

      {result && (
        <div>
          {result.message && (
            <div className="text-[12px] text-ink-muted italic mb-3">{result.message}</div>
          )}
          <StatsBar
            total={result.hashes.length}
            critical={crackableCount}
            extra={mode === "kerberoast"
              ? `${result.targets?.length ?? 0} SPN account${(result.targets?.length ?? 0) === 1 ? "" : "s"}${modesSeen.length ? ` · hashcat ${modesSeen.join(",")}` : ""}`
              : `${result.users?.length ?? 0} target${(result.users?.length ?? 0) === 1 ? "" : "s"}${modesSeen.length ? ` · hashcat ${modesSeen.join(",")}` : ""}`}
            className="mb-3"
          />

          {result.hashes.length > 0 && crackableCount > 0 ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[11px] text-ink-muted tracking-wider">
                  HASHES ({crackableCount} crackable)
                </div>
                <CopyButton
                  text={result.hashes.filter((h) => h.hash).map((h) => h.hash).join("\n")}
                  label="Copy all hashes"
                  alwaysVisible
                  className="ml-auto"
                />
              </div>
              <div className="space-y-1.5 mb-3">
                {result.hashes.filter((h) => h.hash).map((h, i) => (
                  <div
                    key={i}
                    style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                    className="mhp-result-in group bg-bg-panel border border-divider rounded p-2 mhp-critical-pulse"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-amber text-[11px] font-bold font-mono">{h.user}</span>
                      {h.spn && <span className="text-[10px] text-ink-dim font-mono truncate">{h.spn}</span>}
                      {h.hashcat_mode != null && (
                        <span className="text-[10px] text-ink-muted">m{h.hashcat_mode}</span>
                      )}
                      <CopyButton text={h.hash ?? ""} className="ml-auto" />
                    </div>
                    <pre className="text-[10px] font-mono text-phos whitespace-pre-wrap break-all
                                    max-h-32 overflow-y-auto">{h.hash}</pre>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-ink-muted mb-2">
                Hashcat command:{" "}
                <code className="text-amber font-mono">{result.hashcat_hint}</code>
              </div>
            </>
          ) : result.hashes.length > 0 ? (
            <div className="text-[11px] text-ink-muted italic mb-2">
              No crackable hashes — every target returned an error (see below).
            </div>
          ) : null}
          {result.hashes.some((h) => h.error) && (
            <details className="mt-2" open={crackableCount === 0}>
              <summary className="text-[11px] text-ink-muted cursor-pointer">
                Errors ({result.hashes.filter((h) => h.error).length})
              </summary>
              <ul className="mt-1 text-[11px] text-ink-dim space-y-0.5">
                {result.hashes.filter((h) => h.error).map((h, i) => (
                  <li key={i} className="font-mono">
                    <span className="text-amber">{h.user}</span>: {h.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
