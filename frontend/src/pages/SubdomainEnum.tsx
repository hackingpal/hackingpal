import { useEffect, useState } from "react";
import { useAttackWS } from "../components/webattack/useAttackWS";
import { api } from "../api";

type SourceStatus = { name: string; needs_key: boolean; key_configured: boolean };

type Found = { name: string; ip: string | null; sources: string[] };

type SourceProgress = {
  state: "idle" | "running" | "done" | "error";
  count: number;
  error: string;
};

type SubdomEvent =
  | { type: "started"; domain: string; sources: string[] }
  | { type: "source_start"; source: string }
  | { type: "found"; name: string; ip: string | null; sources: string[] }
  | { type: "source_done"; source: string; count: number; error?: string }
  | { type: "done"; elapsed: number; total: number; resolved: number; stopped: boolean }
  | { type: "error"; detail: string };

const FREE_DEFAULT = ["crt.sh", "hackertarget", "otx", "rapiddns"];

export default function SubdomainEnum() {
  const [domain, setDomain] = useState("example.com");
  const [sourceStatus, setSourceStatus] = useState<SourceStatus[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(FREE_DEFAULT));
  const [doResolve, setDoResolve] = useState(true);

  const [sourcesProgress, setSourcesProgress] = useState<Record<string, SourceProgress>>({});
  const [found, setFound] = useState<Map<string, Found>>(new Map());
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    api<{ sources: SourceStatus[] }>("/subdom/status")
      .then((r) => setSourceStatus(r.sources))
      .catch(() => {});
  }, []);

  const { status, error, start, stop } = useAttackWS<SubdomEvent>(
    "/ws/subdom-enum",
    (ev) => {
      if (ev.type === "started") {
        const init: Record<string, SourceProgress> = {};
        for (const s of ev.sources) init[s] = { state: "idle", count: 0, error: "" };
        setSourcesProgress(init);
        setFound(new Map());
        setElapsed(null);
      } else if (ev.type === "source_start") {
        setSourcesProgress((p) => ({ ...p, [ev.source]: { state: "running", count: 0, error: "" } }));
      } else if (ev.type === "found") {
        setFound((m) => {
          const next = new Map(m);
          next.set(ev.name, { name: ev.name, ip: ev.ip, sources: ev.sources });
          return next;
        });
      } else if (ev.type === "source_done") {
        setSourcesProgress((p) => ({
          ...p,
          [ev.source]: {
            state: ev.error ? "error" : "done",
            count: ev.count, error: ev.error || "",
          },
        }));
      } else if (ev.type === "done") {
        setElapsed(ev.elapsed);
      }
    },
    "/subdom/enum",
  );

  function go() {
    const d = domain.trim().toLowerCase();
    if (!d) return;
    start({ domain: d, sources: [...selected], resolve: doResolve });
  }

  function toggle(name: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const running = status === "connecting" || status === "running";
  const total = found.size;
  const resolved = [...found.values()].filter((f) => f.ip).length;

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-hidden">
      <header>
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">SUBDOMAIN ENUM</h2>
        <p className="text-[11px] text-ink-dim">
          Aggregates passive sources. crt.sh + HackerTarget + OTX + RapidDNS need no key;
          SecurityTrails / VirusTotal / Shodan use Keychain-stored API keys.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3">
        <div>
          <label className="block text-[11px] text-ink-muted mb-1 tracking-wider">REGISTRABLE DOMAIN</label>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={running}
            placeholder="example.com"
            className="w-full bg-bg-base border border-divider rounded px-2 py-1.5 text-[13px] font-mono
                       focus:outline-none focus:border-accent disabled:opacity-50"
          />
        </div>

        <div>
          <label className="block text-[11px] text-ink-muted mb-1 tracking-wider">SOURCES</label>
          <div className="grid grid-cols-2 gap-2">
            {sourceStatus.map((s) => {
              const disabled = s.needs_key && !s.key_configured;
              return (
                <label key={s.name}
                       className={"flex items-center gap-2 text-[12px] " +
                         (disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer")}>
                  <input
                    type="checkbox"
                    checked={selected.has(s.name)}
                    disabled={disabled || running}
                    onChange={() => toggle(s.name)}
                  />
                  <span className="text-ink-primary">{s.name}</span>
                  {s.needs_key && (
                    <span className={s.key_configured ? "text-phos text-[10px]" : "text-amber text-[10px]"}>
                      {s.key_configured ? "key ✓" : "no key"}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        <label className="flex items-center gap-2 text-[12px] cursor-pointer">
          <input type="checkbox" checked={doResolve}
                 onChange={(e) => setDoResolve(e.target.checked)}
                 disabled={running} />
          <span className="text-ink-primary">Resolve discovered names to IPs</span>
        </label>

        <div className="flex gap-2">
          {!running ? (
            <button onClick={go} disabled={!domain.trim() || selected.size === 0}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              Start
            </button>
          ) : (
            <button onClick={stop}
                    className="px-3 py-1.5 rounded bg-bg-base border border-danger text-danger text-[12px]">
              Stop
            </button>
          )}
          {elapsed !== null && (
            <span className="text-[11px] text-ink-dim self-center">
              done in {elapsed}s · {total} unique · {resolved} resolved
            </span>
          )}
          {error && <span className="text-[11px] text-danger self-center">⚠ {error}</span>}
        </div>
      </div>

      {/* Source progress */}
      {Object.keys(sourcesProgress).length > 0 && (
        <div className="bg-bg-card border border-divider rounded p-3">
          <div className="text-[11px] text-ink-muted tracking-wider mb-2">SOURCE STATUS</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            {Object.entries(sourcesProgress).map(([name, p]) => (
              <div key={name} className="flex items-center gap-1.5">
                <span className={
                  "w-1.5 h-1.5 rounded-full " +
                  (p.state === "running" ? "bg-amber animate-pulse"
                   : p.state === "done"  ? "bg-phos"
                   : p.state === "error" ? "bg-danger"
                   : "bg-ink-dim")
                } />
                <span className="text-ink-primary">{name}</span>
                <span className="text-ink-dim tabular-nums">({p.count})</span>
                {p.error && <span className="text-danger truncate" title={p.error}>{p.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto bg-bg-card border border-divider rounded">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-bg-sidebar border-b border-divider">
            <tr className="text-ink-muted text-[10px] tracking-wider">
              <th className="text-left px-3 py-2">SUBDOMAIN</th>
              <th className="text-left px-3 py-2">IP</th>
              <th className="text-left px-3 py-2">SOURCES</th>
            </tr>
          </thead>
          <tbody>
            {[...found.values()].sort((a, b) => a.name.localeCompare(b.name)).map((f) => (
              <tr key={f.name} className="border-b border-divider hover:bg-bg-base">
                <td className="px-3 py-1.5 font-mono text-ink-primary">{f.name}</td>
                <td className="px-3 py-1.5 font-mono text-phos">{f.ip ?? "—"}</td>
                <td className="px-3 py-1.5 text-ink-dim">{f.sources.join(", ")}</td>
              </tr>
            ))}
            {found.size === 0 && (
              <tr><td colSpan={3} className="px-3 py-4 text-ink-dim text-center">No results yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
