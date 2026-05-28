import { useState } from "react";
import AdAuthForm, { useAdCreds } from "../components/AdAuthForm";
import { authFetch, parseError } from "../api";

const CATEGORIES = ["users", "groups", "dcs", "policy", "gpos", "computers", "spns", "admins"];

type Finding = {
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  detail: string;
  evidence?: unknown;
};

type EnumResponse = {
  domain: string;
  base_dn: string;
  categories: Record<string, any>;
  findings: Finding[];
};

const SEV: Record<string, string> = {
  critical: "text-danger border-danger/40 bg-danger/10",
  high:     "text-amber border-amber/40 bg-amber/10",
  medium:   "text-amber border-amber/30 bg-amber/5",
  low:      "text-accent border-accent/30 bg-accent/5",
  info:     "text-ink-muted border-divider",
};

export default function LdapEnum() {
  const [creds, setCreds] = useAdCreds();
  const [picked, setPicked] = useState<Set<string>>(new Set(CATEGORIES));
  const [result, setResult] = useState<EnumResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function toggle(c: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }

  async function go() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await authFetch(`/ldap/enum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creds, categories: [...picked] }),
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
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">LDAP ENUMERATOR</h2>
        <p className="text-[11px] text-ink-dim">
          ldap3-based AD inventory: users, groups, DCs, password policy, GPOs, SPNs,
          Domain Admins. Flags PASSWD_NOTREQD, DONT_REQUIRE_PREAUTH (AS-REP roastable),
          accounts with SPNs (Kerberoastable), and stale passwords.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3 mb-4">
        <AdAuthForm creds={creds} setCreds={setCreds} disabled={loading} />
        <div className="border-t border-divider pt-3">
          <div className="text-[11px] text-ink-muted tracking-wider mb-1">CATEGORIES</div>
          <div className="grid grid-cols-4 gap-1 text-[12px]">
            {CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={picked.has(c)} disabled={loading}
                       onChange={() => toggle(c)} />
                <span className="text-ink-primary">{c}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={go} disabled={loading || !creds.dc_host || picked.size === 0}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? "Querying…" : "Enumerate"}
          </button>
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          {/* Findings */}
          {result.findings.length > 0 && (
            <div>
              <div className="text-[11px] text-ink-muted tracking-wider mb-1">
                FINDINGS ({result.findings.length})
              </div>
              <div className="space-y-2">
                {result.findings.map((f, i) => (
                  <div key={i} className={"border rounded p-2 " + SEV[f.severity]}>
                    <div className="text-[11px] mb-1">
                      <span className="font-bold uppercase tracking-wider">{f.severity}</span>{" — "}
                      <span className="text-ink-primary">{f.title}</span>
                    </div>
                    <div className="text-[12px] text-ink-muted">{f.detail}</div>
                    {f.evidence != null && (
                      <details className="mt-1">
                        <summary className="text-[10px] text-ink-dim cursor-pointer">Evidence</summary>
                        <pre className="text-[10px] font-mono text-phos bg-bg-panel border border-divider
                                        rounded p-1.5 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap">
                          {JSON.stringify(f.evidence, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-category data */}
          {Object.entries(result.categories).map(([cat, data]) => (
            <details key={cat} open>
              <summary className="text-[11px] text-ink-muted tracking-wider cursor-pointer
                                  hover:text-ink-primary">
                {cat.toUpperCase()} — {data.error
                  ? <span className="text-danger">{data.error}</span>
                  : <span>{summarizeCategory(cat, data)}</span>}
              </summary>
              <pre className="bg-bg-panel border border-divider rounded p-2 mt-1
                              text-[11px] font-mono text-phos max-h-64 overflow-y-auto
                              whitespace-pre-wrap">
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function summarizeCategory(cat: string, data: any): string {
  if (!data) return "(empty)";
  const inner = data[cat] ?? data;
  if (Array.isArray(inner)) return `${inner.length} entries`;
  if (typeof inner === "object" && inner !== null) {
    return Object.entries(inner).map(([k, v]) => `${k}=${typeof v === "object" ? "{…}" : v}`).slice(0, 4).join(", ");
  }
  return String(inner);
}
