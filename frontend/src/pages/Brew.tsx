import { useEffect, useRef, useState } from "react";
import {
  fetchBrewInstalled, fetchBrewStatus, openWs, searchBrew,
  type BrewExecEvent, type PackageManager,
} from "../api";

type Tab = "search" | "installed";

// Display label per manager — Mac shows "Brew", Linux shows the actual tool.
const MGR_LABEL: Record<PackageManager, string> = {
  brew:   "Brew",
  apt:    "apt",
  dnf:    "dnf",
  pacman: "pacman",
  none:   "Packages",
};

export default function Brew() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [manager,   setManager]   = useState<PackageManager>("brew");
  const [tab,       setTab]       = useState<Tab>("search");
  const [query,     setQuery]     = useState("");
  const [searching, setSearching] = useState(false);
  const [formulae,  setFormulae]  = useState<string[]>([]);
  const [casks,     setCasks]     = useState<string[]>([]);
  const [installed, setInstalled] = useState<{ formulae: string[]; casks: string[] } | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const [running,  setRunning]  = useState<string | null>(null);  // current package name
  const [lines,    setLines]    = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetchBrewStatus()
      .then((s) => { setAvailable(s.available); setManager(s.manager); })
      .catch(() => setAvailable(false));
    fetchBrewInstalled().then(setInstalled).catch(() => setInstalled(null));
  }, []);

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true); setError(null);
    setFormulae([]); setCasks([]);
    try {
      const r = await searchBrew(query.trim());
      setFormulae(r.formulae); setCasks(r.casks);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  function runOp(action: "install" | "uninstall", name: string, cask: boolean) {
    if (running) return;
    setRunning(name); setLines([]); setError(null);
    const ws = openWs("/ws/brew-exec");
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ action, name, cask }));
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data) as BrewExecEvent;
      if (ev.type === "started") setLines([`$ ${ev.cmd}`]);
      else if (ev.type === "line") setLines((l) => [...l.slice(-499), ev.text]);
      else if (ev.type === "done") {
        setRunning(null); ws.close();
        fetchBrewInstalled().then(setInstalled).catch(() => {});
      } else if (ev.type === "error") {
        setError(ev.detail); setRunning(null); ws.close();
      }
    };
    ws.onerror = () => { setError("WebSocket error"); setRunning(null); };
  }

  if (available === false) {
    return (
      <div className="h-full flex flex-col">
        <header className="border-b border-divider px-6 pt-4 pb-3">
          <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Utilities</div>
          <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">{MGR_LABEL[manager]}</h2>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-amber text-sm font-mono">
            {manager === "none"
              ? "No supported package manager (brew / apt / dnf / pacman) found on this system."
              : `${manager} is not installed on this system.`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Utilities</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">{MGR_LABEL[manager]}</h2>
          </div>
          <div className="flex gap-1">
            <TabBtn active={tab === "search"}    onClick={() => setTab("search")}>Search</TabBtn>
            <TabBtn active={tab === "installed"} onClick={() => setTab("installed")}>
              Installed {installed && `(${installed.formulae.length + installed.casks.length})`}
            </TabBtn>
          </div>
          {tab === "search" && (
            <div className="flex-1 flex gap-2 items-center">
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
                     placeholder={manager === "brew" ? "search formulae and casks" : "search packages"}
                     className="flex-1 bg-bg-card border border-divider rounded
                                px-3 py-1.5 text-sm font-mono text-ink-primary
                                placeholder:text-ink-dim focus:outline-none focus:border-accent
                                focus:ring-1 focus:ring-accent/30" />
              <button onClick={runSearch} disabled={searching}
                      className="bg-accent hover:bg-accentDim active:translate-y-px
                                 text-white text-xs font-bold tracking-wide
                                 px-3.5 py-1.5 rounded border border-accent/60
                                 disabled:opacity-50">
                {searching ? "Searching…" : "▶ Search"}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-4 overflow-auto">
          {error && (
            <div className="border border-danger/40 bg-danger/10 text-danger
                            rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
          )}
          {tab === "search" && (
            <>
              <PackageList title="Formulae" items={formulae} onAct={(n) => runOp("install", n, false)} running={running} />
              <PackageList title="Casks"    items={casks}    onAct={(n) => runOp("install", n, true)}  running={running} />
              {!searching && formulae.length === 0 && casks.length === 0 && (
                <div className="text-ink-dim text-xs">Search for a package above.</div>
              )}
            </>
          )}
          {tab === "installed" && installed && (
            <>
              <PackageList title="Formulae" items={installed.formulae}
                           onAct={(n) => runOp("uninstall", n, false)} actLabel="Uninstall"
                           running={running} />
              <PackageList title="Casks"    items={installed.casks}
                           onAct={(n) => runOp("uninstall", n, true)} actLabel="Uninstall"
                           running={running} />
            </>
          )}
        </div>

        <div className="border border-divider rounded-md bg-bg-card overflow-hidden flex flex-col">
          <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                             text-ink-dim border-b border-divider bg-bg-panel">
            {running ? `Output — ${running}` : "Output"}
          </header>
          <pre className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-snug
                          whitespace-pre-wrap text-ink-primary">
            {lines.length === 0
              ? <span className="text-ink-dim">(nothing running)</span>
              : lines.map((ln, i) => (
                  <div key={i}
                       className={ln.startsWith("$") ? "text-ink-dim"
                                : /error|fail/i.test(ln) ? "text-danger"
                                : /warning/i.test(ln)    ? "text-amber"
                                : ""}>
                    {ln || " "}
                  </div>
                ))}
          </pre>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }:
  { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
            className={"text-xs uppercase tracking-widest px-3 py-1.5 rounded transition border " +
              (active ? "bg-accent/15 text-accent border-accent/40"
                      : "text-ink-muted border-transparent hover:text-ink-primary")}>
      {children}
    </button>
  );
}

function PackageList({ title, items, onAct, actLabel = "Install", running }:
  { title: string; items: string[]; onAct: (name: string) => void; actLabel?: string; running: string | null }) {
  if (items.length === 0) return null;
  return (
    <section className="border border-divider rounded-md overflow-hidden bg-bg-card">
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel
                         flex justify-between">
        <span>{title}</span>
        <span>{items.length}</span>
      </header>
      <div className="font-mono text-xs">
        {items.map((n, i) => (
          <div key={n}
               className={"flex items-center justify-between gap-3 px-3 py-1 " +
                          (i % 2 === 0 ? "bg-bg-card" : "bg-bg-row-alt")}>
            <span className="text-ink-primary truncate">{n}</span>
            <button onClick={() => onAct(n)} disabled={running !== null}
                    className="text-[10px] uppercase tracking-widest text-accent
                               hover:text-white hover:bg-accent
                               border border-accent/60 rounded px-2 py-0.5
                               disabled:opacity-40 disabled:cursor-not-allowed">
              {running === n ? "…" : actLabel}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
