import { useEffect, useMemo, useRef, useState } from "react";
import NmapScriptPicker, { type ScriptPickerPatch } from "../components/NmapScriptPicker";
import {
  openWs,
  fetchNmapStatus, installNmapSudo,
  fetchNmapScripts, fetchNmapScriptHelp, previewNmapCommand,
  ApiError,
  type NmapStatus, type NmapScriptEntry, type NmapPolicy,
  type NmapOptions, type NmapEvent, type NmapReport,
} from "../api";
import EmptyStateComponent from "../components/EmptyState";
import PromoteToFindingButton from "../components/PromoteToFindingButton";
import SummarizeButton from "../components/SummarizeButton";
import ToolRequirements from "../components/ToolRequirements";
import SetupWizard, { type SetupStep } from "../components/SetupWizard";
import { shouldAutoOpen } from "../lib/setupState";
import { useLabIntent } from "../lib/labIntent";

// ── Profile presets (partial overrides applied on top of `defaultOptions()`) ──

type Profile = {
  id: string; label: string; hint: string;
  patch: Partial<NmapOptions>;
};

const PROFILES: Profile[] = [
  { id: "quick",      label: "Quick",        hint: "-T4 -F (fast top-100)",
    patch: { fast_mode: true, timing_template: 4 } },
  { id: "standard",   label: "Standard",     hint: "Top 1000 + version detect",
    patch: { service_version: true, timing_template: 4 } },
  { id: "service",    label: "Service+Ver",  hint: "-sV --version-intensity 7",
    patch: { service_version: true, version_intensity: 7, timing_template: 4 } },
  { id: "aggressive", label: "Aggressive",   hint: "-A: OS + ver + scripts + traceroute",
    patch: { service_version: true, os_detect: true,
             nse_categories: ["default"], traceroute: true, timing_template: 4 } },
  { id: "vuln",       label: "Vuln",         hint: "NSE --script vuln",
    patch: { service_version: true, nse_categories: ["vuln"], timing_template: 4 } },
  { id: "os",         label: "OS Detect",    hint: "-O --osscan-guess",
    patch: { os_detect: true, osscan_guess: true, timing_template: 4 } },
  { id: "udp",        label: "UDP Top100",   hint: "-sU --top-ports 100",
    patch: { scan_type: "udp", top_ports: 100, timing_template: 4 } },
  { id: "ping",       label: "Ping Sweep",   hint: "-sn (no port scan)",
    patch: { ping_only: true } },
  { id: "full",       label: "Full Port",    hint: "All 65535 ports + version",
    patch: { all_ports: true, service_version: true, timing_template: 4 } },
];

function defaultOptions(): NmapOptions {
  return {
    targets: [],
    exclude: [],
    scan_type: "syn",
    timing_template: 4,
    no_dns: true,
    open_only: true,
    show_reason: true,
    nse_categories: [],
    nse_scripts: [],
    discovery_probes: [],
  };
}

// ── argv preview (mirrors the backend logic so the user sees the actual cmd) ──

function buildArgvPreview(opts: NmapOptions, binary: string, needsSudo: boolean): string[] {
  const argv: string[] = [];
  if (needsSudo) argv.push("sudo", "-n", binary || "nmap");
  else argv.push(binary || "nmap");
  argv.push("-oX", "/tmp/nmap.xml", "--stats-every", "2s");

  if (opts.skip_discovery) argv.push("-Pn");
  if (opts.ping_only)      argv.push("-sn");
  if (opts.no_dns)         argv.push("-n");
  else if (opts.force_dns) argv.push("-R");
  if (opts.traceroute)     argv.push("--traceroute");
  if (opts.disable_arp_ping) argv.push("--disable-arp-ping");
  (opts.discovery_probes ?? []).forEach((p) => { if (p.trim()) argv.push(`-${p.trim()}`); });

  if (!opts.ping_only) {
    const stMap: Record<string, string> = {
      syn: "-sS", connect: "-sT", udp: "-sU", null: "-sN", fin: "-sF", xmas: "-sX",
      ack: "-sA", window: "-sW", maimon: "-sM",
      sctp_init: "-sY", sctp_cookie: "-sZ", ip: "-sO",
    };
    argv.push(stMap[opts.scan_type ?? "syn"] ?? "-sS");
  }
  if (opts.all_ports) argv.push("-p-");
  else if (opts.port_spec?.trim()) argv.push("-p", opts.port_spec.trim());
  else if ((opts.top_ports ?? 0) > 0) argv.push("--top-ports", String(opts.top_ports));
  if (opts.fast_mode) argv.push("-F");
  if (opts.exclude_ports?.trim()) argv.push("--exclude-ports", opts.exclude_ports.trim());

  if (opts.service_version) {
    argv.push("-sV");
    if (opts.version_intensity !== undefined && opts.version_intensity >= 0)
      argv.push("--version-intensity", String(opts.version_intensity));
    if (opts.version_light) argv.push("--version-light");
    if (opts.version_all)   argv.push("--version-all");
  }
  if (opts.os_detect) {
    argv.push("-O");
    if (opts.osscan_limit) argv.push("--osscan-limit");
    if (opts.osscan_guess) argv.push("--osscan-guess");
  }
  argv.push(`-T${opts.timing_template ?? 3}`);
  if ((opts.min_rate ?? 0) > 0) argv.push("--min-rate", String(opts.min_rate));
  if ((opts.max_rate ?? 0) > 0) argv.push("--max-rate", String(opts.max_rate));
  if (opts.host_timeout?.trim()) argv.push("--host-timeout", opts.host_timeout.trim());
  if ((opts.max_retries ?? -1) >= 0) argv.push("--max-retries", String(opts.max_retries));

  const scripts = [...(opts.nse_categories ?? []), ...(opts.nse_scripts ?? [])]
    .map((s) => s.trim()).filter(Boolean);
  if (scripts.length) argv.push("--script", scripts.join(","));
  if (opts.nse_args?.trim()) argv.push("--script-args", opts.nse_args.trim());

  if (opts.fragment) argv.push("-f");
  if ((opts.mtu ?? 0) > 0) argv.push("--mtu", String(opts.mtu));
  if (opts.decoys?.trim()) argv.push("-D", opts.decoys.trim());
  if (opts.spoof_ip?.trim()) argv.push("-S", opts.spoof_ip.trim());
  if ((opts.source_port ?? 0) > 0) argv.push("--source-port", String(opts.source_port));
  if (opts.spoof_mac?.trim()) argv.push("--spoof-mac", opts.spoof_mac.trim());
  if (opts.badsum) argv.push("--badsum");
  if ((opts.data_length ?? 0) > 0) argv.push("--data-length", String(opts.data_length));

  if ((opts.verbose ?? 0) > 0) argv.push("-" + "v".repeat(Math.min(opts.verbose!, 4)));
  if ((opts.debug ?? 0) > 0)   argv.push("-" + "d".repeat(Math.min(opts.debug!, 4)));
  if (opts.show_reason)  argv.push("--reason");
  if (opts.open_only)    argv.push("--open");
  if (opts.packet_trace) argv.push("--packet-trace");

  if ((opts.exclude ?? []).length) argv.push("--exclude", opts.exclude!.join(","));
  if (opts.extra_args?.trim()) argv.push(...opts.extra_args.trim().split(/\s+/));

  argv.push(...opts.targets);
  return argv;
}

const PRIV_SCAN_TYPES = new Set(["syn", "udp", "null", "fin", "xmas",
                                 "ack", "window", "maimon",
                                 "sctp_init", "sctp_cookie", "ip"]);

function needsPrivileged(o: NmapOptions): boolean {
  if (o.ping_only) return false;
  if (o.scan_type && PRIV_SCAN_TYPES.has(o.scan_type)) return true;
  if (o.os_detect || o.fragment || (o.spoof_mac?.trim())) return true;
  return false;
}

// ── Page ──────────────────────────────────────────────────────────────────────

type AdvancedTab = "discovery" | "scantype" | "ports" | "service" | "os"
                 | "timing" | "nse" | "evasion" | "output";

type ResultsTab = "hosts" | "ports" | "scripts" | "raw";

export default function Nmap() {
  const intent = useLabIntent("nmap");
  const [targetsText, setTargetsText] = useState(
    intent?.target ? `${intent.target}\n` : "127.0.0.1\n",
  );
  const [excludeText, setExcludeText] = useState("");
  const [opts, setOpts] = useState<NmapOptions>(() => defaultOptions());
  const [activeProfile, setActiveProfile] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advTab, setAdvTab] = useState<AdvancedTab>("scantype");

  const [status, setStatus] = useState<NmapStatus | null>(null);
  const [scripts, setScripts] = useState<NmapScriptEntry[] | null>(null);
  const [scriptCats, setScriptCats] = useState<[string, number][]>([]);
  const [scriptFilter, setScriptFilter] = useState("");
  const [scriptHelp, setScriptHelp] = useState<{ name: string; help: string } | null>(null);

  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [needConfirm, setNeedConfirm] = useState<NmapPolicy[] | null>(null);
  const [cmdLine, setCmdLine] = useState<string>("");
  const [rawLog,  setRawLog]  = useState<string[]>([]);
  const [pct, setPct] = useState<number>(0);
  const [hostsDone, setHostsDone] = useState<number>(0);
  const [hostsUp, setHostsUp]   = useState<number>(0);
  const [report, setReport] = useState<NmapReport | null>(null);

  const [resultsTab, setResultsTab] = useState<ResultsTab>("hosts");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [nmapIntroDone, setNmapIntroDone] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const rawEndRef = useRef<HTMLDivElement | null>(null);
  const autoOpenedSetupRef = useRef(false);

  // ── Initial loads ──
  useEffect(() => {
    fetchNmapStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  // Auto-open the setup wizard the first time we see needs-install state.
  useEffect(() => {
    if (status === null || autoOpenedSetupRef.current) return;
    const needs = status.available && !status.passwordless;
    if (shouldAutoOpen("nmap", needs)) {
      autoOpenedSetupRef.current = true;
      setWizardOpen(true);
    }
  }, [status]);

  useEffect(() => {
    fetchNmapScripts()
      .then((r) => { setScripts(r.scripts); setScriptCats(r.categories); })
      .catch(() => {});
  }, []);

  // Auto-scroll the raw log
  useEffect(() => {
    if (rawEndRef.current && resultsTab === "raw") {
      rawEndRef.current.scrollTop = rawEndRef.current.scrollHeight;
    }
  }, [rawLog, resultsTab]);

  // Close any in-flight scan if the user navigates away.
  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  // Parse targets on every render to keep the live argv preview honest
  const parsedTargets = useMemo(
    () => targetsText.split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
    [targetsText],
  );
  const parsedExcludes = useMemo(
    () => excludeText.split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
    [excludeText],
  );

  const effectiveOpts: NmapOptions = useMemo(
    () => ({ ...opts, targets: parsedTargets, exclude: parsedExcludes }),
    [opts, parsedTargets, parsedExcludes],
  );

  const willUseSudo = needsPrivileged(effectiveOpts);
  const argvPreview = useMemo(
    () => buildArgvPreview(effectiveOpts, status?.binary ?? "nmap", willUseSudo),
    [effectiveOpts, status, willUseSudo],
  );
  const cmdPreview = argvPreview.map(quoteIfNeeded).join(" ");

  // Server-authoritative validation of the previewed command. The client
  // argv above is instant but enforces none of the backend's safety checks
  // (forbidden flags, shell metacharacters in extra_args). Debounce a call
  // to /nmap/preview and surface the rejection reason so the user learns a
  // run would be refused *before* clicking Run, not after.
  const [cmdWarning, setCmdWarning] = useState<string | null>(null);
  useEffect(() => {
    if (!effectiveOpts.targets.length) { setCmdWarning(null); return; }
    let cancelled = false;
    const t = window.setTimeout(() => {
      previewNmapCommand(effectiveOpts)
        .then(() => { if (!cancelled) setCmdWarning(null); })
        .catch((e) => {
          if (cancelled) return;
          // Only a 400 means the backend would *reject* these options. Auth
          // (401), transport, and timeout (504) errors aren't a verdict on
          // the command — don't mislead the user; just clear the warning.
          setCmdWarning(e instanceof ApiError && e.status === 400 ? e.message : null);
        });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [effectiveOpts]);

  function applyProfile(p: Profile) {
    setActiveProfile(p.id);
    setOpts((cur) => ({ ...defaultOptions(),
      // preserve a couple of UX-friendly toggles
      no_dns: cur.no_dns ?? true,
      open_only: cur.open_only ?? true,
      show_reason: cur.show_reason ?? true,
      ...p.patch,
    }));
  }

  function patch(p: Partial<NmapOptions>) {
    setOpts((cur) => ({ ...cur, ...p }));
    setActiveProfile(""); // manual edits drop the preset highlight
  }

  function start(confirm = false) {
    if (running) return;
    if (parsedTargets.length === 0) { setError("at least one target is required"); return; }
    if (!status?.available) { setError("nmap not available on this host"); return; }

    if (willUseSudo && !status.passwordless) {
      setError("This scan needs root (SYN/UDP/OS/stealth). Click \"Install Permission\".");
      return;
    }

    setRunning(true); setStopped(false); setError(null); setNeedConfirm(null);
    setRawLog([]); setReport(null); setPct(0); setHostsDone(0); setHostsUp(0);
    setCmdLine("");

    const ws = openWs("/ws/nmap");
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ opts: effectiveOpts, confirm }));

    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data) as NmapEvent;
      switch (ev.type) {
        case "policy":
          // verdicts are informational; we only act if backend later sends need_confirm
          break;
        case "started":
          setCmdLine(ev.cmd);
          break;
        case "line":
          setRawLog((rl) => rl.length > 5000 ? [...rl.slice(-4000), ev.text] : [...rl, ev.text]);
          break;
        case "progress":
          if (ev.pct !== undefined) setPct(ev.pct);
          if (ev.hosts_done !== undefined) setHostsDone(ev.hosts_done);
          if (ev.hosts_up !== undefined)   setHostsUp(ev.hosts_up);
          break;
        case "stderr":
          setRawLog((rl) => [...rl, `[err] ${ev.text}`]);
          break;
        case "done":
          setReport(ev.report);
          setStopped(ev.stopped);
          setRunning(false);
          setPct(100);
          ws.close();
          break;
        case "error":
          if (ev.need_confirm) {
            setNeedConfirm([{ target: "(see verdicts above)", verdict: "warn", reason: ev.detail }]);
          } else {
            setError(ev.detail);
          }
          setRunning(false);
          ws.close();
          break;
      }
    };

    ws.onerror = () => { setError("WebSocket error — is the backend running?"); setRunning(false); };
    ws.onclose = () => { if (running) setRunning(false); };
  }

  function stop() {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "stop" }));
    }
  }

  const nmapWizardSteps = useMemo<SetupStep[]>(() => {
    const passwordless = !!status?.passwordless;
    return [
      {
        id: "intro",
        title: "Why some nmap scans need root",
        description: (
          <>
            SYN, UDP, OS-fingerprint, and traceroute scans all open raw
            sockets, which macOS reserves for root. We&apos;ll grant the{" "}
            <code className="text-ink-primary">nmap</code> binary
            passwordless sudo — nothing else gets elevated.
          </>
        ),
        done: nmapIntroDone || passwordless,
        cta: { label: "I'm ready", onRun: () => setNmapIntroDone(true) },
      },
      {
        id: "install",
        title: "Grant passwordless sudo for nmap",
        description: (
          <>
            macOS will pop the admin dialog once. After this, privileged
            scans run without any further password prompts.
          </>
        ),
        done: passwordless,
        cta: {
          label: "Install Permission",
          busyLabel: "Installing",
          onRun: async () => {
            await installNmapSudo();
            const s = await fetchNmapStatus();
            setStatus(s);
          },
        },
      },
    ];
  }, [status, nmapIntroDone]);

  async function showScriptHelp(name: string) {
    setScriptHelp({ name, help: "loading..." });
    try {
      const r = await fetchNmapScriptHelp(name);
      setScriptHelp(r);
    } catch (e: any) {
      setScriptHelp({ name, help: e?.message || "failed to load" });
    }
  }

  function importTargetsFromFile() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".txt,.lst,.csv,text/plain";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const text = await f.text();
      setTargetsText((cur) => {
        const sep = cur.endsWith("\n") || !cur ? "" : "\n";
        return cur + sep + text;
      });
    };
    inp.click();
  }

  const portsAll = useMemo(() => {
    if (!report) return [] as { host: string; p: NmapPortResultExt }[];
    const out: { host: string; p: NmapPortResultExt }[] = [];
    for (const h of report.hosts) {
      const hl = h.hostnames[0] || h.ip;
      for (const p of h.ports) out.push({ host: hl, p: p as NmapPortResultExt });
    }
    return out;
  }, [report]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-3"><ToolRequirements toolId="nmap" /></div>
      {/* Header */}
      <header className="border-b border-divider px-6 pt-4 pb-3 space-y-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Recon</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">Nmap</h2>
          </div>

          <div className="flex-1 grid grid-cols-[1fr_280px_auto] gap-3 items-stretch">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">
                Targets — one per line, IP / CIDR / range / hostname
              </span>
              <textarea
                value={targetsText}
                onChange={(e) => setTargetsText(e.target.value)}
                disabled={running}
                placeholder={"127.0.0.1\n192.168.1.0/24\n10.0.0.1-50"}
                rows={3}
                className="bg-bg-card border border-divider rounded
                           px-3 py-1.5 text-sm font-mono text-ink-primary
                           placeholder:text-ink-dim resize-y
                           focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                           disabled:opacity-60"
              />
              <div className="flex justify-between mt-1">
                <button
                  onClick={importTargetsFromFile}
                  disabled={running}
                  className="text-[10px] uppercase tracking-widest text-ink-dim hover:text-accent disabled:opacity-50"
                >
                  ↥ Import file…
                </button>
                <span className="text-[10px] text-ink-dim font-mono">
                  {parsedTargets.length} target{parsedTargets.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">Exclude</span>
              <textarea
                value={excludeText}
                onChange={(e) => setExcludeText(e.target.value)}
                disabled={running}
                placeholder="(none)"
                rows={3}
                className="bg-bg-card border border-divider rounded
                           px-3 py-1.5 text-sm font-mono text-ink-primary
                           placeholder:text-ink-dim resize-y
                           focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                           disabled:opacity-60"
              />
            </div>

            <div className="flex flex-col justify-end gap-2">
              {!running ? (
                <button
                  onClick={() => start(false)}
                  className="bg-accent hover:bg-accentDim active:translate-y-px
                             text-white text-xs font-bold tracking-wide
                             px-4 py-2 rounded transition border border-accent/60"
                >
                  ▶ Scan
                </button>
              ) : (
                <button
                  onClick={stop}
                  className="bg-danger/10 hover:bg-danger/20 active:translate-y-px
                             text-danger text-xs font-bold tracking-wide
                             px-4 py-2 rounded transition border border-danger/60"
                >
                  ■ Stop
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Profiles */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] uppercase tracking-widest text-ink-dim mr-1">Profile</span>
          {PROFILES.map((p) => (
            <button
              key={p.id}
              onClick={() => { if (!running) applyProfile(p); }}
              disabled={running}
              title={p.hint}
              className={
                "text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border transition " +
                "disabled:opacity-50 disabled:cursor-not-allowed " +
                (activeProfile === p.id
                  ? "bg-accent/20 text-accent border-accent/40"
                  : "bg-bg-card text-ink-dim hover:text-ink-primary border-divider hover:border-accent/40")
              }
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border
                       bg-bg-card text-ink-dim hover:text-ink-primary border-divider hover:border-accent/40 ml-2"
          >
            {showAdvanced ? "▼" : "▶"} Advanced
          </button>
        </div>

        {/* Advanced panel */}
        {showAdvanced && (
          <div className="border border-divider rounded-md bg-bg-card">
            <div className="flex border-b border-divider overflow-x-auto">
              {(["discovery","scantype","ports","service","os","timing","nse","evasion","output"] as AdvancedTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setAdvTab(t)}
                  className={
                    "text-[10px] uppercase tracking-widest px-3 py-1.5 transition border-b-2 " +
                    (advTab === t
                      ? "border-accent text-accent"
                      : "border-transparent text-ink-dim hover:text-ink-primary")
                  }
                >
                  {advTab === t ? "▸ " : ""}{tabLabel(t)}
                </button>
              ))}
            </div>
            <div className="p-3">
              {advTab === "discovery" && <DiscoveryTab opts={opts} patch={patch} disabled={running} />}
              {advTab === "scantype"  && <ScanTypeTab  opts={opts} patch={patch} disabled={running} />}
              {advTab === "ports"     && <PortsTab     opts={opts} patch={patch} disabled={running} />}
              {advTab === "service"   && <ServiceTab   opts={opts} patch={patch} disabled={running} />}
              {advTab === "os"        && <OsTab        opts={opts} patch={patch} disabled={running} />}
              {advTab === "timing"    && <TimingTab    opts={opts} patch={patch} disabled={running} />}
              {advTab === "nse"       && (
                <NseTab
                  opts={opts}
                  patch={patch}
                  scripts={scripts}
                  scriptCats={scriptCats}
                  filter={scriptFilter}
                  setFilter={setScriptFilter}
                  showHelp={showScriptHelp}
                  disabled={running}
                />
              )}
              {advTab === "evasion"   && <EvasionTab   opts={opts} patch={patch} disabled={running} />}
              {advTab === "output"    && <OutputTab    opts={opts} patch={patch} disabled={running} />}
            </div>
          </div>
        )}

        {/* Command preview */}
        <div className="font-mono text-[11px] bg-bg-panel border border-divider rounded px-3 py-1.5
                        text-ink-muted overflow-x-auto whitespace-nowrap">
          <span className="text-ink-dim">$ </span>
          <span className={willUseSudo ? "text-amber" : ""}>{cmdPreview}</span>
        </div>
        {cmdWarning && (
          <div className="text-[10px] text-danger font-mono -mt-1">
            ⚠ This command would be rejected: {cmdWarning}
          </div>
        )}

        {/* Status strip */}
        <div className="flex items-center gap-3 text-[10px] tracking-widest text-ink-dim font-mono">
          {status?.available ? (
            <>
              <span>NMAP <span className="text-ink-primary">{status.version}</span></span>
              <span className="text-divider">│</span>
              <span>SCRIPTS <span className="text-ink-primary">{status.scripts_count}</span></span>
              <span className="text-divider">│</span>
              <span>
                SUDO{" "}
                <span className={
                  status.needs_upgrade ? "text-amber"
                  : status.passwordless ? "text-phos"
                  : "text-amber"
                }>
                  {status.needs_upgrade
                    ? "△ UPGRADE"
                    : status.passwordless ? "✓ READY" : "○ NEEDED"}
                </span>
              </span>
              {(!status.passwordless || status.needs_upgrade) && (
                <button
                  onClick={async () => {
                    if (status.needs_upgrade) {
                      // Direct re-install — skip the wizard intro since
                      // the user already knows what this does.
                      await installNmapSudo();
                      const s = await fetchNmapStatus();
                      setStatus(s);
                    } else {
                      setWizardOpen(true);
                    }
                  }}
                  className="ml-1 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border
                             bg-bg-card text-accent border-accent/40 hover:bg-accent/10"
                >
                  {status.needs_upgrade ? "Re-install" : "Run Setup"}
                </button>
              )}
              {willUseSudo && (
                <>
                  <span className="text-divider">│</span>
                  <span className="text-amber">PRIVILEGED SCAN</span>
                </>
              )}
            </>
          ) : status === null ? (
            <span>checking…</span>
          ) : (
            <span className="text-danger">NMAP NOT FOUND</span>
          )}
        </div>

        {/* Progress / status line */}
        {(running || report || stopped) && (
          <div className="space-y-1">
            <div className="h-1 rounded bg-bg-panel overflow-hidden">
              <div className="h-full bg-accent transition-[width] duration-100"
                   style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] tracking-widest text-ink-dim font-mono">
              <span className="truncate">
                {cmdLine ? `pid running · ${parsedTargets.length} targets` : "starting…"}
              </span>
              <span>
                {pct.toFixed(0)}% · {hostsDone} done · {hostsUp} up
                {report && ` · ${report.hosts_up}/${report.hosts_total} up · ${report.elapsed}s`}
                {stopped && " · STOPPED"}
              </span>
            </div>
          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Script picker — feeds nse_categories / nse_scripts / nse_args
            straight into `opts` so the existing argv preview picks it up. */}
        <NmapScriptPicker
          selectedCategories={opts.nse_categories ?? []}
          selectedScripts={opts.nse_scripts ?? []}
          scriptArgs={opts.nse_args ?? ""}
          onApply={(patch: ScriptPickerPatch & { _preset?: string | null }) => {
            setOpts((o) => {
              const next: NmapOptions = { ...o };
              if (patch.nse_categories !== undefined) next.nse_categories = patch.nse_categories;
              if (patch.nse_scripts    !== undefined) next.nse_scripts    = patch.nse_scripts;
              if (patch.nse_args       !== undefined) next.nse_args       = patch.nse_args;
              if (patch.port_spec      !== undefined && patch.port_spec)
                next.port_spec = patch.port_spec;
              if (patch.service_version) next.service_version = true;
              if (patch.os_detect)       next.os_detect       = true;
              if (patch.traceroute)      next.traceroute      = true;
              return next;
            });
            if (patch._preset !== undefined) setActiveProfile(patch._preset ?? "");
          }}
        />
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">
            Error — {error}
          </div>
        )}

        {needConfirm && !running && (
          <div className="border border-amber/40 bg-amber/10 text-amber
                          rounded px-3 py-2 text-sm font-mono space-y-2">
            <div>This scan targets one or more external hosts — confirm before continuing.</div>
            <div className="flex gap-2">
              <button
                onClick={() => start(true)}
                className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border bg-amber/20 border-amber/60"
              >
                Confirm & Scan
              </button>
              <button
                onClick={() => setNeedConfirm(null)}
                className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border border-divider text-ink-dim"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {scriptHelp && (
          <ScriptHelpModal data={scriptHelp} onClose={() => setScriptHelp(null)} />
        )}

        {(report || running || rawLog.length > 0) && (
          <div>
            <div className="flex border-b border-divider mb-3">
              {(["hosts","ports","scripts","raw"] as ResultsTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setResultsTab(t)}
                  className={
                    "text-[10px] uppercase tracking-widest px-3 py-1.5 transition border-b-2 " +
                    (resultsTab === t
                      ? "border-accent text-accent"
                      : "border-transparent text-ink-dim hover:text-ink-primary")
                  }
                >
                  {t === "hosts" ? "Hosts" : t === "ports" ? "Ports" : t === "scripts" ? "Scripts" : "Raw"}
                  {t === "hosts" && report   && <span className="ml-1 text-ink-dim">{report.hosts.length}</span>}
                  {t === "ports" && report   && <span className="ml-1 text-ink-dim">{portsAll.length}</span>}
                  {t === "raw"   && rawLog.length > 0 && <span className="ml-1 text-ink-dim">{rawLog.length}</span>}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5 pb-1.5">
                {report && <ExportBar report={report} />}
              </div>
            </div>

            {resultsTab === "hosts" && <HostsTable report={report} />}
            {resultsTab === "ports" && <PortsTable rows={portsAll} />}
            {resultsTab === "scripts" && <ScriptsView report={report} />}
            {resultsTab === "raw" && (
              <div ref={rawEndRef} className="font-mono text-[11px] bg-bg-panel border border-divider rounded
                                              p-3 max-h-[60vh] overflow-auto">
                {rawLog.length === 0 ? (
                  <span className="text-ink-dim">(no output yet)</span>
                ) : rawLog.map((l, i) => (
                  <div key={i} className={l.startsWith("[err] ") ? "text-amber" : "text-ink-muted"}>
                    {l}
                  </div>
                ))}
              </div>
            )}
            {report && !running && (
              <SummarizeButton
                tool="nmap"
                target={report.hosts.map((h) => h.ip).join(", ")}
                raw={{
                  hosts: report.hosts.length,
                  ports_open: portsAll.filter((r) => r.p.state === "open").length,
                  ports: portsAll.slice(0, 200).map((r) => ({
                    host: r.host,
                    port: r.p.port,
                    proto: r.p.proto,
                    state: r.p.state,
                    service: r.p.service,
                    version: [r.p.product, r.p.version, r.p.extra_info]
                      .filter(Boolean).join(" "),
                  })),
                }}
              />
            )}
          </div>
        )}

        {!report && !running && rawLog.length === 0 && !error && !needConfirm && (
          <EmptyStateComponent
            icon="🛰"
            title="Nmap · full surface"
            description="Pick a profile or open Advanced, then press ▶ Scan. Multi-target · all flags exposed · 612 NSE scripts · live XML parse."
            exampleTarget="scanme.nmap.org"
            onExample={(t) => setTargetsText(t + "\n")}
          />
        )}
      </div>
      <SetupWizard
        open={wizardOpen}
        toolKey="nmap"
        title="Set Up Nmap"
        steps={nmapWizardSteps}
        onClose={() => setWizardOpen(false)}
      />
    </div>
  );
}

function tabLabel(t: AdvancedTab): string {
  return ({
    discovery: "Discovery", scantype: "Scan Type", ports: "Ports",
    service: "Service / Ver", os: "OS", timing: "Timing", nse: "NSE",
    evasion: "Evasion", output: "Output",
  } as Record<AdvancedTab, string>)[t];
}

function quoteIfNeeded(s: string): string {
  if (s === "") return "''";
  if (/^[A-Za-z0-9_./:,@%+=\-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── Field primitives ─────────────────────────────────────────────────────────

function Field({ label, hint, children }:
                { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-ink-dim block mb-1">
        {label}{hint && <span className="ml-1 text-ink-dim normal-case tracking-normal">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "w-full bg-bg-panel border border-divider rounded " +
        "px-2 py-1 text-xs font-mono text-ink-primary " +
        "placeholder:text-ink-dim " +
        "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 " +
        "disabled:opacity-60 " + (props.className ?? "")
      }
    />
  );
}

function Toggle({ checked, onChange, label, disabled }:
                { checked: boolean; onChange: (b: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-primary cursor-pointer
                      hover:text-accent disabled:opacity-50">
      <input
        type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent"
      />
      <span>{label}</span>
    </label>
  );
}

// ── Advanced tab panels ──────────────────────────────────────────────────────

type TabProps = { opts: NmapOptions; patch: (p: Partial<NmapOptions>) => void; disabled: boolean };

function DiscoveryTab({ opts, patch, disabled }: TabProps) {
  const probes = (opts.discovery_probes ?? []).join(" ");
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Toggle checked={!!opts.skip_discovery} onChange={(v) => patch({ skip_discovery: v })} label="-Pn — Skip host discovery" disabled={disabled} />
      <Toggle checked={!!opts.ping_only}      onChange={(v) => patch({ ping_only: v })}      label="-sn — Ping scan only" disabled={disabled} />
      <Toggle checked={!!opts.traceroute}     onChange={(v) => patch({ traceroute: v })}     label="--traceroute" disabled={disabled} />
      <Toggle checked={!!opts.no_dns}         onChange={(v) => patch({ no_dns: v, force_dns: v ? false : opts.force_dns })} label="-n — No DNS resolution" disabled={disabled} />
      <Toggle checked={!!opts.force_dns}      onChange={(v) => patch({ force_dns: v, no_dns: v ? false : opts.no_dns })} label="-R — Always resolve" disabled={disabled} />
      <Toggle checked={!!opts.disable_arp_ping} onChange={(v) => patch({ disable_arp_ping: v })} label="--disable-arp-ping" disabled={disabled} />
      <div className="col-span-2 md:col-span-3">
        <Field label="Discovery probes" hint="space-separated, e.g. PS22,80 PA80 PE PP PM PU53">
          <TextInput
            value={probes}
            onChange={(e) => patch({
              discovery_probes: e.target.value.split(/\s+/).map(s => s.trim()).filter(Boolean),
            })}
            disabled={disabled}
            placeholder="PS22,80 PE"
          />
        </Field>
      </div>
    </div>
  );
}

const SCAN_TYPES: { id: NmapOptions["scan_type"]; flag: string; hint: string }[] = [
  { id: "syn",         flag: "-sS", hint: "TCP SYN stealth — needs root" },
  { id: "connect",     flag: "-sT", hint: "TCP connect — no root needed" },
  { id: "udp",         flag: "-sU", hint: "UDP scan — needs root" },
  { id: "null",        flag: "-sN", hint: "Null scan (stealthy, root)" },
  { id: "fin",         flag: "-sF", hint: "FIN scan (stealthy, root)" },
  { id: "xmas",        flag: "-sX", hint: "Xmas scan (stealthy, root)" },
  { id: "ack",         flag: "-sA", hint: "ACK scan (firewall map, root)" },
  { id: "window",      flag: "-sW", hint: "Window scan (root)" },
  { id: "maimon",      flag: "-sM", hint: "Maimon scan (root)" },
  { id: "sctp_init",   flag: "-sY", hint: "SCTP INIT (root)" },
  { id: "sctp_cookie", flag: "-sZ", hint: "SCTP cookie-echo (root)" },
  { id: "ip",          flag: "-sO", hint: "IP protocol scan (root)" },
];

function ScanTypeTab({ opts, patch, disabled }: TabProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
      {SCAN_TYPES.map((s) => (
        <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer
                                      hover:bg-bg-base p-1.5 rounded">
          <input
            type="radio" name="scan_type" disabled={disabled}
            checked={opts.scan_type === s.id}
            onChange={() => patch({ scan_type: s.id })}
            className="accent-accent"
          />
          <span className="font-mono text-accent w-8">{s.flag}</span>
          <span className="text-ink-muted text-[11px]">{s.hint}</span>
        </label>
      ))}
    </div>
  );
}

function PortsTab({ opts, patch, disabled }: TabProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Port spec" hint="e.g. 22,80,443  or  1-1024  or  U:53,T:80">
        <TextInput
          value={opts.port_spec ?? ""}
          onChange={(e) => patch({ port_spec: e.target.value })}
          disabled={disabled || opts.fast_mode || opts.all_ports || (opts.top_ports ?? 0) > 0}
          placeholder="1-1024"
        />
      </Field>
      <Field label="Exclude ports">
        <TextInput
          value={opts.exclude_ports ?? ""}
          onChange={(e) => patch({ exclude_ports: e.target.value })}
          disabled={disabled}
          placeholder="(none)"
        />
      </Field>
      <Field label="Top N ports" hint="--top-ports N (ignored if Port spec is set)">
        <TextInput
          type="number" min={0} max={65535}
          value={opts.top_ports ?? 0}
          onChange={(e) => patch({ top_ports: parseInt(e.target.value, 10) || 0 })}
          disabled={disabled || !!opts.port_spec?.trim() || opts.fast_mode || opts.all_ports}
        />
      </Field>
      <div className="flex flex-col gap-2 justify-end pb-1">
        <Toggle checked={!!opts.fast_mode} onChange={(v) => patch({ fast_mode: v, top_ports: 0 })} label="-F — Fast (top 100)" disabled={disabled} />
        <Toggle checked={!!opts.all_ports} onChange={(v) => patch({ all_ports: v, top_ports: 0 })} label="-p- — All 65535 ports" disabled={disabled} />
      </div>
    </div>
  );
}

function ServiceTab({ opts, patch, disabled }: TabProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Toggle checked={!!opts.service_version} onChange={(v) => patch({ service_version: v })} label="-sV — Service/version detect" disabled={disabled} />
      <Field label="--version-intensity 0..9" hint="-1 = default (7)">
        <TextInput
          type="number" min={-1} max={9}
          value={opts.version_intensity ?? -1}
          onChange={(e) => patch({ version_intensity: parseInt(e.target.value, 10) })}
          disabled={disabled || !opts.service_version}
        />
      </Field>
      <Toggle checked={!!opts.version_light} onChange={(v) => patch({ version_light: v })} label="--version-light (intensity 2)" disabled={disabled || !opts.service_version} />
      <Toggle checked={!!opts.version_all}   onChange={(v) => patch({ version_all: v })}   label="--version-all (intensity 9)" disabled={disabled || !opts.service_version} />
    </div>
  );
}

function OsTab({ opts, patch, disabled }: TabProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Toggle checked={!!opts.os_detect}     onChange={(v) => patch({ os_detect: v })}     label="-O — OS detection (needs root)" disabled={disabled} />
      <Toggle checked={!!opts.osscan_limit}  onChange={(v) => patch({ osscan_limit: v })}  label="--osscan-limit" disabled={disabled || !opts.os_detect} />
      <Toggle checked={!!opts.osscan_guess}  onChange={(v) => patch({ osscan_guess: v })}  label="--osscan-guess" disabled={disabled || !opts.os_detect} />
    </div>
  );
}

function TimingTab({ opts, patch, disabled }: TabProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Field label="Timing template" hint="0 paranoid → 5 insane">
        <select
          value={opts.timing_template ?? 3}
          onChange={(e) => patch({ timing_template: parseInt(e.target.value, 10) })}
          disabled={disabled}
          className="w-full bg-bg-panel border border-divider rounded px-2 py-1 text-xs font-mono text-ink-primary
                     focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-60"
        >
          <option value={0}>-T0 Paranoid</option>
          <option value={1}>-T1 Sneaky</option>
          <option value={2}>-T2 Polite</option>
          <option value={3}>-T3 Normal</option>
          <option value={4}>-T4 Aggressive</option>
          <option value={5}>-T5 Insane</option>
        </select>
      </Field>
      <Field label="--min-rate pkts/s">
        <TextInput type="number" min={0}
          value={opts.min_rate ?? 0}
          onChange={(e) => patch({ min_rate: parseInt(e.target.value, 10) || 0 })}
          disabled={disabled}
        />
      </Field>
      <Field label="--max-rate pkts/s">
        <TextInput type="number" min={0}
          value={opts.max_rate ?? 0}
          onChange={(e) => patch({ max_rate: parseInt(e.target.value, 10) || 0 })}
          disabled={disabled}
        />
      </Field>
      <Field label="--host-timeout" hint="e.g. 30s 5m 1h">
        <TextInput
          value={opts.host_timeout ?? ""}
          onChange={(e) => patch({ host_timeout: e.target.value })}
          disabled={disabled}
          placeholder="(none)"
        />
      </Field>
      <Field label="--max-retries" hint="-1 = default">
        <TextInput type="number" min={-1}
          value={opts.max_retries ?? -1}
          onChange={(e) => patch({ max_retries: parseInt(e.target.value, 10) })}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

type NseTabProps = TabProps & {
  scripts: NmapScriptEntry[] | null;
  scriptCats: [string, number][];
  filter: string; setFilter: (s: string) => void;
  showHelp: (name: string) => void;
};

function NseTab({ opts, patch, scripts, scriptCats, filter, setFilter, showHelp, disabled }: NseTabProps) {
  const selectedCats = new Set(opts.nse_categories ?? []);
  const selectedScripts = new Set(opts.nse_scripts ?? []);

  const filteredScripts = useMemo(() => {
    if (!scripts) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return scripts;
    return scripts.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.categories.some((c) => c.toLowerCase().includes(q))
    );
  }, [scripts, filter]);

  function toggleCat(c: string) {
    const next = new Set(selectedCats);
    if (next.has(c)) next.delete(c); else next.add(c);
    patch({ nse_categories: [...next] });
  }
  function toggleScript(name: string) {
    const next = new Set(selectedScripts);
    if (next.has(name)) next.delete(name); else next.add(name);
    patch({ nse_scripts: [...next] });
  }

  return (
    <div className="grid grid-cols-[200px_1fr] gap-3">
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-ink-dim">Categories</div>
        <div className="space-y-0.5 max-h-[280px] overflow-y-auto pr-1">
          {scriptCats.map(([c, n]) => (
            <label key={c} className="flex items-center gap-2 text-xs cursor-pointer hover:text-accent">
              <input
                type="checkbox" disabled={disabled}
                checked={selectedCats.has(c)}
                onChange={() => toggleCat(c)}
                className="accent-accent"
              />
              <span className="flex-1 text-ink-muted">{c}</span>
              <span className="text-ink-dim text-[10px]">{n}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <TextInput
            placeholder={scripts ? `filter ${scripts.length} scripts…` : "loading scripts…"}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={disabled || !scripts}
          />
          {selectedScripts.size > 0 && (
            <span className="text-[10px] uppercase tracking-widest text-ink-dim whitespace-nowrap">
              {selectedScripts.size} selected
            </span>
          )}
        </div>
        <div className="border border-divider rounded bg-bg-panel max-h-[260px] overflow-y-auto">
          {filteredScripts.slice(0, 500).map((s) => (
            <div key={s.name}
                 className={"flex items-center gap-2 px-2 py-0.5 text-[11px] font-mono " +
                            "hover:bg-bg-card"}>
              <input
                type="checkbox" disabled={disabled}
                checked={selectedScripts.has(s.name)}
                onChange={() => toggleScript(s.name)}
                className="accent-accent"
              />
              <button onClick={() => showHelp(s.name)}
                      className="text-ink-primary hover:text-accent text-left flex-1 truncate"
                      title={s.categories.join(", ")}>
                {s.name}
              </button>
              <span className="text-ink-dim text-[10px] truncate max-w-[160px]">
                {s.categories.join(", ")}
              </span>
            </div>
          ))}
          {filteredScripts.length > 500 && (
            <div className="px-2 py-1 text-[10px] text-ink-dim">
              {filteredScripts.length - 500} more — refine the filter to see them.
            </div>
          )}
        </div>
        <Field label="--script-args" hint="key=value,key=value">
          <TextInput
            value={opts.nse_args ?? ""}
            onChange={(e) => patch({ nse_args: e.target.value })}
            disabled={disabled}
            placeholder="(none)"
          />
        </Field>
      </div>
    </div>
  );
}

function EvasionTab({ opts, patch, disabled }: TabProps) {
  return (
    <div>
      <div className="text-[10px] text-amber mb-2 uppercase tracking-widest">
        ⚠ Use only on authorised targets — many of these are detection-evasion knobs.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Toggle checked={!!opts.fragment} onChange={(v) => patch({ fragment: v })} label="-f — Fragment packets" disabled={disabled} />
        <Field label="--mtu (multiple of 8)">
          <TextInput type="number" min={0} step={8}
            value={opts.mtu ?? 0}
            onChange={(e) => patch({ mtu: parseInt(e.target.value, 10) || 0 })}
            disabled={disabled}
          />
        </Field>
        <Field label="-D decoys" hint="e.g. RND:5 or 1.2.3.4,5.6.7.8,ME">
          <TextInput value={opts.decoys ?? ""} onChange={(e) => patch({ decoys: e.target.value })} disabled={disabled} placeholder="(none)" />
        </Field>
        <Field label="-S spoof IP">
          <TextInput value={opts.spoof_ip ?? ""} onChange={(e) => patch({ spoof_ip: e.target.value })} disabled={disabled} placeholder="(none)" />
        </Field>
        <Field label="--source-port">
          <TextInput type="number" min={0} max={65535}
            value={opts.source_port ?? 0}
            onChange={(e) => patch({ source_port: parseInt(e.target.value, 10) || 0 })}
            disabled={disabled}
          />
        </Field>
        <Field label="--spoof-mac">
          <TextInput value={opts.spoof_mac ?? ""} onChange={(e) => patch({ spoof_mac: e.target.value })} disabled={disabled} placeholder="(none)" />
        </Field>
        <Field label="--data-length bytes">
          <TextInput type="number" min={0}
            value={opts.data_length ?? 0}
            onChange={(e) => patch({ data_length: parseInt(e.target.value, 10) || 0 })}
            disabled={disabled}
          />
        </Field>
        <Toggle checked={!!opts.badsum} onChange={(v) => patch({ badsum: v })} label="--badsum" disabled={disabled} />
      </div>
    </div>
  );
}

function OutputTab({ opts, patch, disabled }: TabProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Field label="Verbosity">
        <select value={opts.verbose ?? 0}
                onChange={(e) => patch({ verbose: parseInt(e.target.value, 10) })}
                disabled={disabled}
                className="w-full bg-bg-panel border border-divider rounded px-2 py-1 text-xs font-mono text-ink-primary
                           focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-60">
          <option value={0}>(none)</option>
          <option value={1}>-v</option>
          <option value={2}>-vv</option>
          <option value={3}>-vvv</option>
        </select>
      </Field>
      <Field label="Debug">
        <select value={opts.debug ?? 0}
                onChange={(e) => patch({ debug: parseInt(e.target.value, 10) })}
                disabled={disabled}
                className="w-full bg-bg-panel border border-divider rounded px-2 py-1 text-xs font-mono text-ink-primary
                           focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-60">
          <option value={0}>(none)</option>
          <option value={1}>-d</option>
          <option value={2}>-dd</option>
          <option value={3}>-ddd</option>
        </select>
      </Field>
      <Toggle checked={!!opts.show_reason} onChange={(v) => patch({ show_reason: v })} label="--reason" disabled={disabled} />
      <Toggle checked={!!opts.open_only}   onChange={(v) => patch({ open_only: v })}   label="--open (open ports only)" disabled={disabled} />
      <Toggle checked={!!opts.packet_trace} onChange={(v) => patch({ packet_trace: v })} label="--packet-trace" disabled={disabled} />
      <div className="col-span-2 md:col-span-3">
        <Field label="Raw extra args" hint="anything not exposed above; space-separated, no shell metas">
          <TextInput value={opts.extra_args ?? ""} onChange={(e) => patch({ extra_args: e.target.value })} disabled={disabled} placeholder="(none)" />
        </Field>
      </div>
    </div>
  );
}

// ── Results panels ───────────────────────────────────────────────────────────

type NmapPortResultExt = NmapReport["hosts"][number]["ports"][number];

function HostsTable({ report }: { report: NmapReport | null }) {
  if (!report) return <div className="text-ink-dim text-xs font-mono">(scanning…)</div>;
  if (report.hosts.length === 0) return <div className="text-ink-dim text-xs font-mono">No hosts.</div>;
  return (
    <section className="border border-divider rounded-md overflow-hidden bg-bg-card">
      <div className="grid grid-cols-[130px_1fr_70px_80px_100px_1fr] gap-3 px-3 py-1.5
                      bg-bg-panel border-b border-divider text-[10px]
                      uppercase tracking-[0.2em] text-ink-dim">
        <span>IP</span>
        <span>Hostname</span>
        <span>State</span>
        <span>Open</span>
        <span>MAC</span>
        <span>OS / Vendor</span>
      </div>
      <div className="font-mono text-xs">
        {report.hosts.map((h, i) => {
          const openCount = h.ports.filter(p => p.state === "open").length;
          const os = h.os_guesses[0]?.name ?? "";
          return (
            <div key={h.ip + i}
                 className={"grid grid-cols-[130px_1fr_70px_80px_100px_1fr] gap-3 px-3 py-1 " +
                            (i % 2 === 0 ? "bg-bg-card" : "bg-bg-row-alt")}>
              <span className="text-ink-primary">{h.ip || "—"}</span>
              <span className="text-ink-muted truncate">{h.hostnames.join(", ") || "—"}</span>
              <span className={h.state === "up" ? "text-phos" : "text-ink-dim"}>{h.state}</span>
              <span className="text-ink-primary tabular-nums">{openCount}</span>
              <span className="text-ink-muted truncate">{h.mac || "—"}</span>
              <span className="text-ink-muted truncate" title={os}>{os || h.vendor || "—"}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PortsTable({ rows }: { rows: { host: string; p: NmapPortResultExt }[] }) {
  if (rows.length === 0) return <div className="text-ink-dim text-xs font-mono">No ports.</div>;
  return (
    <section className="border border-divider rounded-md overflow-hidden bg-bg-card">
      <div className="grid grid-cols-[1fr_60px_50px_60px_140px_1fr_70px] gap-3 px-3 py-1.5
                      bg-bg-panel border-b border-divider text-[10px]
                      uppercase tracking-[0.2em] text-ink-dim">
        <span>Host</span>
        <span>Port</span>
        <span>Proto</span>
        <span>State</span>
        <span>Service</span>
        <span>Version</span>
        <span></span>
      </div>
      <div className="font-mono text-xs">
        {rows.map((r, i) => {
          const versionStr = [r.p.product, r.p.version, r.p.extra_info]
            .filter(Boolean).join(" ");
          const evidence =
            `Host:    ${r.host}\n` +
            `Port:    ${r.p.proto}/${r.p.port}\n` +
            `State:   ${r.p.state}${r.p.reason ? ` (${r.p.reason})` : ""}\n` +
            `Service: ${r.p.service || "?"}\n` +
            (versionStr ? `Version: ${versionStr}\n` : "") +
            (r.p.cpe?.length ? `CPE:     ${r.p.cpe.join(", ")}\n` : "");
          return (
          <div key={r.host + r.p.proto + r.p.port + i}
               className={"group grid grid-cols-[1fr_60px_50px_60px_140px_1fr_70px] gap-3 px-3 py-1 " +
                          (i % 2 === 0 ? "bg-bg-card" : "bg-bg-row-alt")}>
            <span className="text-ink-muted truncate">{r.host}</span>
            <span className="text-ink-primary tabular-nums">{r.p.port}</span>
            <span className="text-ink-dim">{r.p.proto}</span>
            <span className={r.p.state === "open" ? "text-phos"
                           : r.p.state === "filtered" ? "text-amber"
                           : "text-ink-dim"}>{r.p.state}</span>
            <span className="text-ink-muted">{r.p.service || "—"}</span>
            <span className="text-ink-primary truncate"
                  title={versionStr}>
              {versionStr || "—"}
            </span>
            <span className="flex justify-end">
              {r.p.state === "open" && (
                <PromoteToFindingButton
                  variant="compact"
                  seed={{
                    tool: "nmap",
                    target: `${r.host}:${r.p.port}/${r.p.proto}`,
                    title: `Open ${r.p.service || r.p.proto.toUpperCase()} on ${r.host}:${r.p.port}` +
                           (versionStr ? ` (${versionStr})` : ""),
                    severity: nmapSeverity(r.p.port, r.p.service, versionStr),
                    evidence,
                  }}
                />
              )}
            </span>
          </div>
          );
        })}
      </div>
    </section>
  );
}

function nmapSeverity(port: number, service: string, version: string): "info" | "low" | "medium" | "high" | "critical" {
  const svc = (service || "").toLowerCase();
  const ver = (version || "").toLowerCase();
  // Anything still advertising a known-old OpenSSH/Apache/IIS hints triage.
  if (ver.includes("openssh_4.") || ver.includes("openssh_5.")) return "high";
  if (port === 3389) return "high";
  if (port === 1433 || port === 3306 || port === 5432
      || port === 6379 || port === 9200 || port === 27017) return "high";
  if (port === 445 || port === 139 || port === 23 || port === 21) return "high";
  if (port === 22 || svc.includes("ssh")) return "medium";
  if (port === 80 || port === 443 || svc.startsWith("http")) return "info";
  return "low";
}

function ScriptsView({ report }: { report: NmapReport | null }) {
  if (!report) return <div className="text-ink-dim text-xs font-mono">(scanning…)</div>;
  const blocks: { host: string; portLabel?: string; id: string; output: string }[] = [];
  for (const h of report.hosts) {
    const hl = h.hostnames[0] || h.ip;
    for (const s of h.host_scripts) blocks.push({ host: hl, id: s.id, output: s.output });
    for (const p of h.ports) {
      for (const s of p.scripts) {
        blocks.push({ host: hl, portLabel: `${p.proto}/${p.port}`, id: s.id, output: s.output });
      }
    }
  }
  if (blocks.length === 0) return <div className="text-ink-dim text-xs font-mono">No script output.</div>;
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <div key={i} className="border border-divider rounded bg-bg-panel">
          <div className="border-b border-divider px-3 py-1 text-[10px] uppercase tracking-widest text-ink-dim flex gap-3">
            <span className="text-ink-primary">{b.host}</span>
            {b.portLabel && <span className="text-accent">{b.portLabel}</span>}
            <span className="text-ink-muted">{b.id}</span>
          </div>
          <pre className="px-3 py-2 text-[11px] font-mono text-ink-muted whitespace-pre-wrap">{b.output}</pre>
        </div>
      ))}
    </div>
  );
}

function ScriptHelpModal({ data, onClose }:
                          { data: { name: string; help: string }; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6"
         onClick={onClose}>
      <div className="bg-bg-card border border-divider rounded-md max-w-2xl w-full max-h-[80vh] flex flex-col"
           onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-divider px-4 py-2 flex justify-between items-center">
          <h3 className="font-mono text-sm text-ink-primary">{data.name}</h3>
          <button onClick={onClose}
                  className="text-ink-dim hover:text-ink-primary text-xs uppercase tracking-widest">
            Close ✕
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-4 text-[11px] font-mono text-ink-muted whitespace-pre-wrap">
          {data.help}
        </pre>
      </div>
    </div>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

function csvEscape(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
function downloadFile(name: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a);
  a.click(); a.remove(); URL.revokeObjectURL(url);
}
function safeName(s: string): string {
  return (s || "scan").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40) || "scan";
}

function ExportBar({ report }: { report: NmapReport }) {
  const [copied, setCopied] = useState<string | null>(null);
  function flash(label: string) {
    setCopied(label);
    window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
  }
  async function copyJson() {
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); flash("json"); } catch {}
  }
  function downloadCsv() {
    const lines = ["host,ip,port,proto,state,service,product,version"];
    for (const h of report.hosts) {
      const label = h.hostnames[0] || h.ip;
      for (const p of h.ports) {
        lines.push([
          csvEscape(label), csvEscape(h.ip), p.port, p.proto, p.state,
          csvEscape(p.service), csvEscape(p.product), csvEscape(p.version),
        ].join(","));
      }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const tgt = report.hosts[0]?.ip || "scan";
    downloadFile(`nmap_${safeName(tgt)}_${stamp}.csv`, "text/csv", lines.join("\n") + "\n");
  }
  function downloadJson() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const tgt = report.hosts[0]?.ip || "scan";
    downloadFile(`nmap_${safeName(tgt)}_${stamp}.json`,
      "application/json", JSON.stringify(report, null, 2));
  }
  const btn = "text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border " +
              "bg-bg-card text-ink-dim hover:text-ink-primary border-divider hover:border-accent/40 transition";
  return (
    <>
      <button onClick={copyJson}   className={btn}>{copied === "json" ? "✓ Copied" : "Copy JSON"}</button>
      <button onClick={downloadCsv}  className={btn}>↓ CSV</button>
      <button onClick={downloadJson} className={btn}>↓ JSON</button>
    </>
  );
}

