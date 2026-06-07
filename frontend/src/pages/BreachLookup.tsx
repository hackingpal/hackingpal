import { useEffect, useMemo, useState } from "react";
import { api, authFetch, parseError } from "../api";
import { sanitizeHtml } from "../lib/sanitizeHtml";
import EmptyState from "../components/EmptyState";
import CopyButton from "../components/CopyButton";
import StatsBar from "../components/StatsBar";
import SeverityBadge from "../components/SeverityBadge";

type Mode = "password" | "email";

type PasswordResult = { pwned: boolean; count: number; prefix: string };
type Breach = {
  Name: string; Title: string; Domain: string;
  BreachDate: string; AddedDate: string;
  PwnCount: number; Description: string;
  DataClasses: string[]; IsVerified: boolean;
  IsSensitive: boolean; IsRetired: boolean;
};
type EmailResult = { email: string; breaches: Breach[]; count: number };
type StatusResp = { password_check: boolean; email_check_available: boolean };

export default function BreachLookup() {
  const [mode, setMode] = useState<Mode>("password");
  const [statusResp, setStatusResp] = useState<StatusResp | null>(null);

  useEffect(() => {
    api<StatusResp>("/breach/status").then(setStatusResp).catch(() => {});
  }, []);

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">BREACH LOOKUP</h2>
        <p className="text-[11px] text-ink-dim">
          Cross-check passwords (free, k-anonymity) and emails (HIBP, requires API key)
          against known data breaches.
        </p>
      </header>

      <div className="flex gap-2 mb-4">
        {(["password", "email"] as Mode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)}
                  className={
                    "px-3 py-1.5 rounded text-[12px] tracking-wider uppercase " +
                    (mode === m
                      ? "bg-accent text-white font-bold"
                      : "bg-bg-base border border-divider text-ink-primary hover:bg-bg-nav-hover")
                  }>
            {m}
          </button>
        ))}
      </div>

      {mode === "password" ? <PasswordTab /> : <EmailTab status={statusResp} />}
    </div>
  );
}

function PasswordTab() {
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<PasswordResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function check() {
    if (!pwd) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await authFetch(`/breach/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      if (!r.ok) throw new Error(await parseError(r));
      setResult(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="bg-bg-card border border-divider rounded p-3 text-[12px] text-ink-muted">
        <b className="text-ink-primary">Privacy:</b> we SHA-1 hash your password locally,
        send only the first <code className="text-amber">5 hex chars</code> of the hash to
        haveibeenpwned.com, then compare the tail against returned matches on this machine.
        Your password never crosses the network. This is HIBP's k-anonymity flow.
      </div>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-2">
        <label className="block text-[11px] text-ink-muted tracking-wider">PASSWORD</label>
        <div className="flex gap-2">
          <input value={pwd} type={show ? "text" : "password"}
                 onChange={(e) => setPwd(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") check(); }}
                 placeholder="Enter a password to check"
                 className="flex-1 bg-bg-base border border-divider rounded px-2 py-1.5
                            text-[13px] font-mono focus:outline-none focus:border-accent" />
          <button onClick={() => setShow((v) => !v)}
                  className="px-2 py-1 rounded border border-divider text-ink-muted text-[11px]">
            {show ? "Hide" : "Show"}
          </button>
        </div>
        <button onClick={check} disabled={loading || !pwd}
                className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                           disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? "Checking…" : "Check"}
        </button>
        {error && <div className="text-[11px] text-danger">⚠ {error}</div>}
      </div>

      {!result && !loading && !error && (
        <EmptyState
          icon="🔐"
          title="Pwned-password check"
          description="HIBP k-anonymity check: SHA-1 your password locally, send only the first 5 hex chars."
          hint="Your password never crosses the network."
        />
      )}

      {result && (
        <div className={"mhp-result-in bg-bg-card border rounded p-4 " +
          (result.pwned ? "border-danger/60 mhp-critical-pulse" : "border-phos/60")}>
          <div className="flex items-center gap-2 mb-1">
            {result.pwned ? <SeverityBadge severity="critical" /> : <SeverityBadge severity="info" label="Clean" />}
            <div className={"text-[14px] font-bold " +
              (result.pwned ? "text-danger" : "text-phos")}>
              {result.pwned
                ? `Seen ${result.count.toLocaleString()} times in known breaches`
                : "Not found in any known breach"}
            </div>
            {result.pwned && (
              <CopyButton text={`Pwned ${result.count.toLocaleString()}× (prefix ${result.prefix})`} className="ml-auto" />
            )}
          </div>
          <div className="text-[11px] text-ink-dim font-mono">
            Hash prefix queried: <span className="text-amber">{result.prefix}</span>
          </div>
          {result.pwned && (
            <p className="text-[12px] text-ink-muted mt-2">
              Do not use this password. The count reflects appearances across many
              public breach datasets — high counts mean it's in most cracking dictionaries.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EmailTab({ status }: { status: StatusResp | null }) {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<EmailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function check() {
    if (!email.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await api<EmailResult>(`/breach/email/${encodeURIComponent(email.trim())}`);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const hasKey = status?.email_check_available ?? false;

  return (
    <div className="space-y-3 max-w-2xl">
      {!hasKey && (
        <div className="bg-amber/10 border border-amber/30 rounded p-3 text-[12px] text-amber">
          HIBP email lookup needs a paid API key ($3.95/month). Once you have one:
          <pre className="mt-2 bg-bg-base border border-divider rounded p-2 text-[11px]
                          text-phos">
{`curl -X POST http://127.0.0.1:8765/settings/keys/hibp_api_key \\
  -H 'Content-Type: application/json' \\
  -d '{"value":"<your-key>"}'`}
          </pre>
        </div>
      )}

      <div className="bg-bg-card border border-divider rounded p-3 space-y-2">
        <label className="block text-[11px] text-ink-muted tracking-wider">EMAIL</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") check(); }}
               placeholder="user@example.com"
               disabled={!hasKey}
               className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                          text-[13px] font-mono focus:outline-none focus:border-accent
                          disabled:opacity-40" />
        <button onClick={check} disabled={loading || !email.trim() || !hasKey}
                className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                           disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? "Checking…" : "Check"}
        </button>
        {error && <div className="text-[11px] text-danger">⚠ {error}</div>}
      </div>

      {!result && !loading && !error && hasKey && (
        <EmptyState
          icon="📧"
          title="HIBP email lookup"
          description="Cross-check an email address against HaveIBeenPwned's full breach database."
          exampleTarget="user@example.com"
          onExample={setEmail}
        />
      )}

      {result && (
        <div>
          <StatsBar
            total={result.count}
            critical={result.breaches.filter((b) => b.IsSensitive).length}
            medium={result.count - result.breaches.filter((b) => b.IsSensitive).length}
            extra={result.email}
            className="mb-3"
          />
          {result.breaches.map((b, i) => {
            const copyText = `${b.Title} (${b.Domain}) — ${b.BreachDate} · ${b.PwnCount.toLocaleString()} affected${b.DataClasses?.length ? ` · ${b.DataClasses.join(", ")}` : ""}`;
            return (
              <div
                key={b.Name}
                style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                className={"mhp-result-in group border border-divider rounded p-3 mb-2 " +
                           (b.IsSensitive ? "mhp-critical-pulse" : "")}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[13px] font-bold text-ink-primary">{b.Title}</span>
                  <span className="text-[10px] text-ink-dim">({b.Domain})</span>
                  {b.IsSensitive && <SeverityBadge severity="critical" label="SENSITIVE" />}
                  <CopyButton text={copyText} className="ml-auto" />
                </div>
                <div className="text-[10px] text-ink-dim mb-2">
                  Breach date: {b.BreachDate} · Added to HIBP: {b.AddedDate} ·
                  Affected: {b.PwnCount.toLocaleString()}
                </div>
                {b.Description && <BreachDescription html={b.Description} />}
                {b.DataClasses && b.DataClasses.length > 0 && (
                  <div className="text-[10px] text-ink-dim">
                    Compromised data: <span className="text-ink-primary">{b.DataClasses.join(", ")}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BreachDescription({ html }: { html: string }) {
  // HIBP descriptions are third-party HTML — sanitize before rendering.
  const safe = useMemo(() => sanitizeHtml(html), [html]);
  return (
    <div className="text-[11px] text-ink-muted mb-2"
         dangerouslySetInnerHTML={{ __html: safe }} />
  );
}
