import { useEffect, useState } from "react";
import {
  fetchIpReport,
  fetchIpBulk,
  isApiError,
  type IpReport,
  type IpBulkResult,
} from "../api";

const SEV: Record<string, { text: string; dot: string; border: string; bg: string }> = {
  clean: { text: "text-phos",   dot: "bg-phos",   border: "border-phos/40",   bg: "bg-phos/5" },
  info:  { text: "text-ink-muted", dot: "bg-ink-dim", border: "border-divider", bg: "bg-bg-card" },
  warn:  { text: "text-amber",  dot: "bg-amber",  border: "border-amber/40",  bg: "bg-amber/5" },
  high:  { text: "text-danger", dot: "bg-danger", border: "border-danger/40", bg: "bg-danger/5" },
};

const HISTORY_KEY = "ip-checker:history";
const HISTORY_MAX = 20;

type HistoryEntry = { target: string; severity: string; ts: number };

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch {
    /* quota — ignore */
  }
}

function pushHistory(prev: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...prev.filter((e) => e.target.toLowerCase() !== entry.target.toLowerCase())];
  return next.slice(0, HISTORY_MAX);
}

type Mode = "single" | "bulk";

export default function IpChecker() {
  const [mode, setMode] = useState<Mode>("single");
  const [target, setTarget] = useState("8.8.8.8");
  const [bulkText, setBulkText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [report, setReport] = useState<IpReport | null>(null);
  const [bulkResults, setBulkResults] = useState<IpBulkResult[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

  useEffect(() => { saveHistory(history); }, [history]);

  async function lookup(t?: string) {
    const value = (t ?? target).trim();
    if (!value) return;
    if (t) setTarget(value);
    setBusy(true);
    setError(null);
    setTimedOut(false);
    setReport(null);
    setBulkResults(null);
    try {
      const r = await fetchIpReport(value);
      setReport(r);
      setHistory((h) => pushHistory(h, { target: value, severity: r.verdict_severity, ts: Date.now() }));
    } catch (e) {
      if (isApiError(e, "TIMEOUT")) setTimedOut(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function lookupBulk() {
    const targets = bulkText
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (targets.length === 0) return;
    setBusy(true);
    setError(null);
    setTimedOut(false);
    setReport(null);
    setBulkResults(null);
    try {
      const resp = await fetchIpBulk(targets);
      setBulkResults(resp.results);
      setHistory((h) => {
        let next = h;
        for (const r of resp.results) {
          if (r.ok && r.report) {
            next = pushHistory(next, { target: r.target, severity: r.report.verdict_severity, ts: Date.now() });
          }
        }
        return next;
      });
    } catch (e) {
      if (isApiError(e, "TIMEOUT")) setTimedOut(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function clearHistory() {
    setHistory([]);
  }

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <header className="border-b border-divider px-6 pt-4 pb-3 flex flex-col gap-2">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
              Discovery
            </div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              IP Checker
            </h2>
          </div>

          <ModeToggle mode={mode} setMode={setMode} />

          <div className="flex-1 flex gap-2 items-center max-w-2xl">
            {mode === "single" ? (
              <>
                <span className="text-ink-dim text-sm select-none">›</span>
                <input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void lookup(); }}
                  placeholder="IP address or hostname"
                  className="flex-1 bg-bg-card border border-divider rounded
                             px-3 py-1.5 text-sm font-mono text-ink-primary
                             placeholder:text-ink-dim
                             focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                             transition"
                />
                <button
                  onClick={() => void lookup()}
                  disabled={busy}
                  className="bg-accent hover:bg-accentDim active:translate-y-px
                             text-white text-xs font-bold tracking-wide
                             px-3.5 py-1.5 rounded transition
                             disabled:opacity-50 disabled:cursor-not-allowed
                             border border-accent/60"
                >
                  {busy ? "Looking up…" : "▶ Look up"}
                </button>
              </>
            ) : (
              <button
                onClick={() => void lookupBulk()}
                disabled={busy}
                className="bg-accent hover:bg-accentDim active:translate-y-px
                           text-white text-xs font-bold tracking-wide
                           px-3.5 py-1.5 rounded transition
                           disabled:opacity-50 disabled:cursor-not-allowed
                           border border-accent/60"
              >
                {busy ? "Looking up…" : "▶ Look up batch"}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {mode === "bulk" && (
            <BulkInput value={bulkText} onChange={setBulkText} disabled={busy} />
          )}

          {timedOut && (
            <div className="border border-amber/40 bg-amber/10 text-amber
                            rounded px-3 py-2 text-sm font-mono flex items-center gap-3">
              <span>⏱</span>
              <div className="flex-1">
                <div className="font-bold">Lookup timed out</div>
                <div className="text-[11px] text-ink-muted">
                  The server didn't respond in time. Retry, or check connectivity.
                </div>
              </div>
              <button
                onClick={() => (mode === "single" ? void lookup() : void lookupBulk())}
                className="text-[10px] uppercase tracking-widest px-2 py-1 rounded border
                           border-amber/40 text-amber hover:bg-amber/10 transition"
              >
                Retry
              </button>
            </div>
          )}

          {error && !timedOut && (
            <div className="border border-danger/40 bg-danger/10 text-danger
                            rounded px-3 py-2 text-sm font-mono">
              Error — {error}
            </div>
          )}

          {report && <Report report={report} />}

          {bulkResults && <BulkResults results={bulkResults} onPick={(t) => { setMode("single"); void lookup(t); }} />}

          {!report && !bulkResults && !error && !timedOut && !busy && mode === "single" && (
            <EmptyState onPick={(t) => void lookup(t)} />
          )}

          {busy && (
            <div className="text-ink-dim text-xs font-mono caret-blink">
              {mode === "single" ? `Looking up ${target}` : "Looking up batch…"}
            </div>
          )}
        </div>

        {history.length > 0 && (
          <HistoryPanel
            items={history}
            onPick={(t) => { setMode("single"); void lookup(t); }}
            onClear={clearHistory}
          />
        )}
      </div>
    </div>
  );
}

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const base = "px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] border transition";
  return (
    <div className="flex rounded overflow-hidden border border-divider shrink-0">
      <button
        onClick={() => setMode("single")}
        className={base + " " + (mode === "single"
          ? "bg-accent/20 text-accent border-accent/40"
          : "bg-bg-card text-ink-dim hover:text-ink-primary border-transparent")}
      >
        Single
      </button>
      <button
        onClick={() => setMode("bulk")}
        className={base + " " + (mode === "bulk"
          ? "bg-accent/20 text-accent border-accent/40"
          : "bg-bg-card text-ink-dim hover:text-ink-primary border-transparent")}
      >
        Bulk
      </button>
    </div>
  );
}

function BulkInput({
  value, onChange, disabled,
}: { value: string; onChange: (s: string) => void; disabled: boolean }) {
  const count = value.split(/[\s,;]+/).filter(Boolean).length;
  return (
    <div className="rounded-md border border-divider overflow-hidden">
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel
                         flex items-center justify-between">
        <span>Batch · paste one IP/hostname per line</span>
        <span className="text-ink-muted">{count} target{count === 1 ? "" : "s"} · max 50</span>
      </header>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={6}
        placeholder={"8.8.8.8\n1.1.1.1\ngoogle.com"}
        className="w-full bg-bg-card text-xs font-mono text-ink-primary
                   placeholder:text-ink-dim p-3
                   focus:outline-none focus:bg-bg-card resize-y"
      />
    </div>
  );
}

function BulkResults({
  results, onPick,
}: { results: IpBulkResult[]; onPick: (t: string) => void }) {
  if (results.length === 0) return (
    <div className="text-ink-dim text-xs font-mono">No targets provided.</div>
  );
  return (
    <div className="rounded-md border border-divider overflow-hidden">
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel">
        Batch results · {results.length}
      </header>
      <div className="bg-bg-card text-xs font-mono">
        <div className="grid grid-cols-[16px_1.2fr_1fr_1fr_2fr] gap-x-3 px-3 py-2
                        border-b border-divider text-ink-dim text-[10px] uppercase tracking-wider">
          <span />
          <span>Target</span>
          <span>IP</span>
          <span>Country / Org</span>
          <span>Verdict</span>
        </div>
        {results.map((r, i) => {
          const sev = r.report ? SEV[r.report.verdict_severity] ?? SEV.info : SEV.high;
          return (
            <button
              key={i}
              onClick={() => onPick(r.target)}
              className="w-full text-left grid grid-cols-[16px_1.2fr_1fr_1fr_2fr] gap-x-3
                         px-3 py-1.5 border-b border-divider/50
                         hover:bg-bg-row-alt transition"
            >
              <span className={"inline-block w-2 h-2 rounded-full mt-1 " + sev.dot} />
              <span className="text-ink-primary break-all">{r.target}</span>
              <span className="text-ink-muted">{r.ok && r.report ? r.report.ip : "—"}</span>
              <span className="text-ink-muted break-all">
                {r.ok && r.report
                  ? [r.report.country, r.report.org].filter(Boolean).join(" · ") || "—"
                  : "—"}
              </span>
              <span className={r.ok ? sev.text : "text-danger"}>
                {r.ok && r.report ? r.report.verdict_text : (r.error ?? "Unknown error")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HistoryPanel({
  items, onPick, onClear,
}: { items: HistoryEntry[]; onPick: (t: string) => void; onClear: () => void }) {
  return (
    <aside className="w-56 shrink-0 border-l border-divider bg-bg-base
                      flex flex-col overflow-hidden">
      <header className="px-3 py-2 border-b border-divider
                         text-[10px] uppercase tracking-[0.2em] text-ink-dim
                         flex items-center justify-between">
        <span>Recent</span>
        {items.length > 0 && (
          <button
            onClick={onClear}
            className="text-ink-dim hover:text-danger transition"
            title="Clear history"
          >
            clear
          </button>
        )}
      </header>
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="p-3 text-[11px] text-ink-dim font-mono">
            History will appear here.
          </div>
        ) : (
          items.map((item) => {
            const sev = SEV[item.severity] ?? SEV.info;
            return (
              <button
                key={item.target + item.ts}
                onClick={() => onPick(item.target)}
                className="w-full text-left px-3 py-1.5 border-b border-divider/40
                           hover:bg-bg-row-alt transition flex items-center gap-2"
              >
                <span className={"inline-block w-2 h-2 rounded-full shrink-0 " + sev.dot} />
                <span className="text-xs font-mono text-ink-primary break-all flex-1">
                  {item.target}
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

const EMPTY_SAMPLES = ["8.8.8.8", "1.1.1.1", "cloudflare.com", "github.com"];

const EMPTY_CHECKS: Array<{ label: string; blurb: string }> = [
  { label: "DNSBL",   blurb: "Spam & abuse blocklist hits" },
  { label: "ASN",     blurb: "Autonomous system & country" },
  { label: "WHOIS",   blurb: "Owner & abuse contact" },
  { label: "Hosting", blurb: "Datacenter / VPS heuristic" },
];

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="h-full min-h-[260px] flex items-center justify-center p-6">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto w-14 h-14 rounded-lg bg-accent/10 border border-accent/30
                        flex items-center justify-center text-accent text-2xl leading-none
                        select-none">
          ⌖
        </div>
        <h3 className="mt-4 text-base font-semibold text-ink-primary tracking-wide">
          IP &amp; hostname intelligence
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          Enter a target above and press{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-bg-card border border-divider
                          text-[10px] text-ink-primary font-mono">Enter</kbd>,
          or try a sample.
        </p>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {EMPTY_SAMPLES.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="px-2.5 py-1 text-[11px] font-mono rounded
                         bg-bg-card border border-divider text-ink-muted
                         hover:border-accent/50 hover:text-accent transition"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 text-left">
          {EMPTY_CHECKS.map((c) => (
            <div
              key={c.label}
              className="rounded border border-divider bg-bg-card px-3 py-2"
            >
              <div className="text-[10px] uppercase tracking-[0.2em] text-accent">
                {c.label}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-muted">{c.blurb}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({
  title, accent, children,
}: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <section className={"rounded-md overflow-hidden border " + (accent ?? "border-divider")}>
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel
                         flex items-center justify-between">
        <span>{title}</span>
      </header>
      <div className="bg-bg-card p-3 text-xs font-mono">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-28 shrink-0 text-ink-dim">{k}</span>
      <span className="text-ink-primary break-all">{v}</span>
    </div>
  );
}

function Report({ report }: { report: IpReport }) {
  const sevKey = report.verdict_severity;
  const sev = SEV[sevKey] ?? SEV.info;

  return (
    <>
      {/* Big verdict banner */}
      <div className={"rounded-md border-l-4 " + sev.border + " " + sev.bg +
                      " border-r border-y border-r-divider border-y-divider " +
                      "px-4 py-3 flex items-center gap-3"}>
        <span className={"inline-block w-2.5 h-2.5 rounded-full " + sev.dot} />
        <div className="flex-1">
          <div className={"text-[10px] uppercase tracking-[0.25em] " + sev.text}>
            Verdict · {sevKey}
          </div>
          <div className={"mt-1 text-sm font-mono " + sev.text}>
            {report.verdict_text}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] tracking-widest text-ink-dim">IP</div>
          <div className="text-sm font-bold font-mono text-ink-primary">{report.ip}</div>
        </div>
      </div>

      <Card title="Triage">
        {report.input !== report.ip && <Row k="Input"      v={report.input} />}
        <Row k="Type"        v={report.ip_class} />
        <Row k="Reverse DNS" v={report.reverse_dns || <span className="text-ink-dim">(none)</span>} />
      </Card>

      <Card title="Network">
        {report.is_internal ? (
          <div className="text-ink-dim">
            (no public WHOIS / Geo for {report.ip_class} addresses)
          </div>
        ) : report.geo_error ? (
          <div className="text-amber">Geo lookup failed — {report.geo_error}</div>
        ) : (
          <>
            <Row k="Country"   v={report.country ?? "—"} />
            <Row k="ASN / Org" v={report.org ?? "—"} />
            {report.hosting && (
              <Row k="Hosting" v={<span className="text-amber">{report.hosting}</span>} />
            )}
          </>
        )}
      </Card>

      {!report.is_internal && (
        <Card title="DNSBL Checks">
          <div className="grid grid-cols-[16px_140px_1fr] gap-x-3 gap-y-1">
            {report.dnsbl.map((b) => (
              <div key={b.name} className="contents">
                <span className={b.listed ? "text-danger" : "text-phos"}>
                  {b.listed ? "✗" : "✓"}
                </span>
                <span className="text-ink-muted">{b.name}</span>
                <span className={b.listed ? "text-danger" : "text-ink-primary"}>
                  {b.status}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Abuse Contact">
        {report.abuse_contact.length === 0 ? (
          <div className="text-ink-dim">(no abuse contact found in whois)</div>
        ) : (
          <ul className="space-y-0.5">
            {report.abuse_contact.map((ln, i) => (
              <li key={i} className="text-ink-primary">{ln}</li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
