import { useState } from "react";
import AdAuthForm, { useAdCreds } from "../components/AdAuthForm";
import { BACKEND_URL, parseError } from "../api";

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

  async function go() {
    setLoading(true); setError(""); setResult(null);
    try {
      const path = mode === "kerberoast" ? "/kerberoast/run" : "/asrep/run";
      const body = mode === "kerberoast"
        ? { creds, spn_filter: spnFilter }
        : { creds, users: usersText.split("\n").map((s) => s.trim()).filter(Boolean) };
      const r = await fetch(`${BACKEND_URL}${path}`, {
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

        <div className="flex items-center gap-2">
          <button onClick={go} disabled={loading || !canRoast}
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

      {result && (
        <div>
          {result.message && (
            <div className="text-[12px] text-ink-muted italic mb-3">{result.message}</div>
          )}
          {mode === "kerberoast" && result.targets && result.targets.length > 0 && (
            <div className="text-[11px] text-ink-muted mb-2">
              Found <span className="text-phos">{result.targets.length}</span> SPN-bearing
              account{result.targets.length === 1 ? "" : "s"}.
            </div>
          )}
          {mode === "asrep" && result.users && result.users.length > 0 && (
            <div className="text-[11px] text-ink-muted mb-2">
              Targeted <span className="text-phos">{result.users.length}</span>{" "}
              user{result.users.length === 1 ? "" : "s"}.
            </div>
          )}
          {result.hashes.length > 0 && crackableCount > 0 ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[11px] text-ink-muted tracking-wider">
                  HASHES ({crackableCount} crackable
                  {modesSeen.length > 0
                    ? `, hashcat mode${modesSeen.length > 1 ? "s" : ""} ${modesSeen.join(", ")}`
                    : ""})
                </div>
                <button
                  onClick={() => navigator.clipboard?.writeText(
                    result.hashes.filter((h) => h.hash).map((h) => h.hash).join("\n")
                  )}
                  className="ml-auto text-[11px] text-accent hover:underline">
                  Copy all hashes
                </button>
              </div>
              <pre className="bg-bg-panel border border-divider rounded p-2 mb-3
                              text-[10px] font-mono text-phos whitespace-pre-wrap break-all
                              max-h-96 overflow-y-auto">
                {result.hashes.filter((h) => h.hash).map((h) => h.hash).join("\n\n")}
              </pre>
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
