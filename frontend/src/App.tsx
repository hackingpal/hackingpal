import { useEffect, useRef, useState } from "react";
import Sidebar, { type NavId } from "./components/Sidebar";
import { fetchSystemInfo, type SystemInfo } from "./api";
import IpChecker from "./pages/IpChecker";
import DnsRecon from "./pages/DnsRecon";
import Whois from "./pages/Whois";
import TlsAudit from "./pages/TlsAudit";
import Fingerprint from "./pages/Fingerprint";
import HttpProbe from "./pages/HttpProbe";
import CtLog from "./pages/CtLog";
import EmailSecurity from "./pages/EmailSecurity";
import Takeover from "./pages/Takeover";
import ReverseIp from "./pages/ReverseIp";
import Cms from "./pages/Cms";
import MacosPosture from "./pages/MacosPosture";
import LinuxPosture from "./pages/LinuxPosture";
import WindowsPosture from "./pages/WindowsPosture";
import Systemd from "./pages/Systemd";
import FirewallRules from "./pages/FirewallRules";
import UsersAudit from "./pages/UsersAudit";
import LocalDiscovery from "./pages/LocalDiscovery";
import Jwt from "./pages/Jwt";
import Graphql from "./pages/Graphql";
import HashCracker from "./pages/HashCracker";
import PortScanner from "./pages/PortScanner";
import Nmap from "./pages/Nmap";
import LanScan from "./pages/LanScan";
import NetworkAudit from "./pages/NetworkAudit";
import Ids from "./pages/Ids";
import Ping from "./pages/Ping";
import Tcpdump from "./pages/Tcpdump";
import Wifi from "./pages/Wifi";
import Terminal from "./pages/Terminal";
import Brew from "./pages/Brew";
import Persistence from "./pages/Persistence";
import Processes from "./pages/Processes";
import Stego from "./pages/Stego";
import ReverseShell from "./pages/ReverseShell";
import SubdomainEnum from "./pages/SubdomainEnum";
import Xss from "./pages/Xss";
import Sqli from "./pages/Sqli";
import Cmdi from "./pages/Cmdi";
import Lfi from "./pages/Lfi";
import Ssrf from "./pages/Ssrf";
import Idor from "./pages/Idor";
import Placeholder from "./pages/Placeholder";
import PlannedToolPage from "./pages/PlannedToolPage";
import Engagements from "./pages/Engagements";
import EngagementDashboard from "./pages/EngagementDashboard";
import Playbooks from "./pages/Playbooks";
import Labs from "./pages/Labs";
import SelfAssess from "./pages/SelfAssess";
import CvssCalculator from "./pages/CvssCalculator";
import Obfuscator from "./pages/Obfuscator";
import Imds from "./pages/Imds";
import S3Scanner from "./pages/S3Scanner";
import BreachLookup from "./pages/BreachLookup";
import Dorking from "./pages/Dorking";
import GithubLeak from "./pages/GithubLeak";
import ShodanCensys from "./pages/ShodanCensys";
import PeopleEnum from "./pages/PeopleEnum";
import AwsRecon from "./pages/AwsRecon";
import AzureRecon from "./pages/AzureRecon";
import GcpRecon from "./pages/GcpRecon";
import LdapEnum from "./pages/LdapEnum";
import SmbEnum from "./pages/SmbEnum";
import AdSpray from "./pages/AdSpray";
import KerberosRoast from "./pages/KerberosRoast";
import WifiScan from "./pages/WifiScan";
import EvilTwin from "./pages/EvilTwin";
import BtRecon from "./pages/BtRecon";
import WpaCapture from "./pages/WpaCapture";
import PivotingHelper from "./pages/PivotingHelper";
import CredHarvest from "./pages/CredHarvest";
import C2Beacon from "./pages/C2Beacon";
import ProfileFinder from "./pages/ProfileFinder";
import BloodHound from "./pages/BloodHound";
import LateralMove from "./pages/LateralMove";
import Exploits from "./pages/Exploits";
import Wayback from "./pages/Wayback";
import UrlScan from "./pages/UrlScan";
import EmailHarvest from "./pages/EmailHarvest";
import DorksGen from "./pages/DorksGen";
import Audit from "./pages/Audit";
import Settings from "./pages/Settings";
import AiAssistant from "./pages/AiAssistant";
import Tools from "./pages/Tools";
import Targets from "./pages/Targets";
import EngagementWorkspace from "./pages/EngagementWorkspace";
import Findings from "./pages/Findings";
import EffectsDebug from "./pages/EffectsDebug";
import CommandPalette from "./components/CommandPalette";
import ToolCatalog from "./components/ToolCatalog";
import ActiveTargetPicker from "./components/ActiveTargetPicker";
import EngagementPill from "./components/EngagementPill";
import ModePill from "./components/ModePill";
import ErrorBoundary from "./components/ErrorBoundary";
import ChatBubble from "./components/ChatBubble";
import EngagementTabs from "./components/EngagementTabs";
import PageBackBar from "./components/PageBackBar";
import { getTabs, getActiveTabId, setTabPage } from "./lib/engagementTabs";
import { useTheme } from "./lib/theme";
import { isPlannedId } from "./lib/plannedTools";
import { api, resetAuthToken } from "./api";

type Health = { status: string; version: string; pid: string };

const SIDEBAR_COLLAPSED_KEY = "sidebar:hidden";

export default function App() {
  // `active` is widened to `string` so planned-tool ids (`planned:<slug>`)
  // also work. Built-in tools still use the `NavId` union — assignment from
  // it to `string` is always safe.
  //
  // Default landing page: Home. Routes to EngagementDashboard, which shows
  // the active engagement at a glance (scope, findings, next-step checklist)
  // when one is active, or a soft onboarding card pointing at the
  // Engagements list when none is.
  const [active, setActive] = useState<NavId | string>(() => {
    const t = getTabs().find((x) => x.id === getActiveTabId());
    return t?.activePage ?? "home";
  });
  // navigate() is the "user-initiated" nav setter — pushes the destination
  // into the active tab's history so Back/Forward in EngagementTabs work.
  // The EngagementTabs component itself wires through the *raw* setActive
  // when switching tabs or invoking back/forward — otherwise it would
  // re-push the destination and corrupt the history stack.
  const navigate = (page: NavId | string) => {
    setActive(page);
    setTabPage(getActiveTabId(), String(page));
  };
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  // `everConnected` distinguishes "still booting" (show CONNECTING) from a
  // mid-session drop (show UNREACHABLE).
  const [everConnected, setEverConnected] = useState(false);
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarHidden ? "1" : "0"); } catch {}
  }, [sidebarHidden]);

  // Keyboard shortcuts:
  //   ⌘B / Ctrl+B — toggle sidebar (matches VS Code, Linear, etc.)
  //   ⌘K / Ctrl+K — open command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        setSidebarHidden((v) => !v);
      } else if (k === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (k === "i") {
        // ⌘I opens the tool catalog (i for "ideas")
        e.preventDefault();
        setCatalogOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Track the backend pid we last successfully talked to. If it changes
  // (cold-start race where the renderer cached a token against an old
  // backend, or a mid-session sidecar restart), clear the auth-token cache
  // so the next api() call fetches a fresh token from the live backend.
  const lastBackendPid = useRef<string | null>(null);

  useEffect(() => {
    let stop = false;
    let delay = 250; // poll fast at first so we catch the backend booting
    const tick = async () => {
      try {
        const h = await api<Health>("/health");
        if (stop) return;
        if (lastBackendPid.current !== h.pid) {
          resetAuthToken();
          lastBackendPid.current = h.pid;
        }
        setHealth(h);
        setEverConnected(true);
        delay = 5000; // back off once we've seen it
      } catch {
        if (stop) return;
        setHealth(null);
        // Ramp 250 → 500 → 1000 while we wait for the sidecar to come up.
        delay = Math.min(delay * 2, 1000);
      }
      if (!stop) setTimeout(tick, delay);
    };
    tick();
    return () => { stop = true; };
  }, []);

  // Fetch system info once the backend is reachable, then memoize.
  useEffect(() => {
    if (!health || sysInfo) return;
    fetchSystemInfo().then(setSysInfo).catch(() => {});
  }, [health, sysInfo]);

  const platform = (sysInfo?.platform as "darwin" | "linux" | "win32" | undefined) ?? null;
  const theme = useTheme();
  const themeIcon = theme.choice === "dark" ? "🌙"
    : theme.choice === "light" ? "☀"
    : "🖥";
  const themeLabel = theme.choice === "system"
    ? `auto (${theme.resolved})`
    : theme.choice;

  return (
    <div className="flex h-full bg-bg-base text-ink-primary">
      {!sidebarHidden && (
        <Sidebar active={active} onSelect={navigate} platform={platform} />
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top status strip — also draggable.
            - macOS: traffic lights overlay top-left ~88px when sidebar is
              hidden, so we inset past them.
            - win32: titleBarOverlay min/max/close sit in the top-right
              ~150px, so we reserve that space on the right edge instead. */}
        <div
          className={
            "app-drag h-9 border-b border-divider bg-bg-sidebar flex items-center justify-between gap-2 " +
            (platform === "win32" ? "pr-[150px] " : "pr-3 ") +
            (sidebarHidden && platform !== "win32" && platform !== "linux"
              ? "pl-[92px]"
              : "pl-2")
          }
        >
          <div className="flex items-center gap-1.5 app-no-drag min-w-0">
            <button
              onClick={() => setSidebarHidden((v) => !v)}
              title={(sidebarHidden ? "Show sidebar" : "Hide sidebar") + " (⌘B)"}
              className="text-ink-muted hover:text-ink-primary
                         text-[14px] leading-none px-1.5 py-0.5 rounded
                         hover:bg-bg-nav-hover transition shrink-0"
              aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
            >
              {sidebarHidden ? "›" : "‹"}
            </button>
            <button
              onClick={() => setPaletteOpen(true)}
              title="Search tools (⌘K)"
              className="flex items-center gap-1.5 px-2 py-0.5 rounded
                         text-[10px] tracking-wider text-ink-dim
                         border border-divider hover:border-ink-muted
                         hover:text-ink-primary transition shrink-0"
            >
              <span aria-hidden>⌕</span>
              <span className="hidden md:inline">Search…</span>
              <kbd className="text-ink-dim text-[9px] font-mono hidden lg:inline">⌘K</kbd>
            </button>
            <button
              onClick={() => setCatalogOpen(true)}
              title="Tool catalog — plan new tools (⌘I)"
              className="flex items-center gap-1 px-2 py-0.5 rounded
                         text-[10px] tracking-wider text-ink-dim
                         border border-divider hover:border-ink-muted
                         hover:text-ink-primary transition shrink-0"
              aria-label="Open tool catalog"
            >
              <span className="text-[12px] leading-none font-bold">+</span>
              <span className="hidden md:inline">Tool</span>
              <kbd className="text-ink-dim text-[9px] font-mono hidden lg:inline">⌘I</kbd>
            </button>
          </div>
          <div className="flex items-center gap-2 text-[10px] tracking-widest text-ink-dim app-no-drag min-w-0">
            <ModePill onOpenEngagementsPage={() => navigate("engagements")} />
            <EngagementPill onOpenEngagementsPage={() => navigate("engagements")} />
            <ActiveTargetPicker onOpenTargetsPage={() => navigate("targets")} />
            <button
              onClick={theme.cycle}
              title={`Theme: ${themeLabel} — click to cycle (dark → light → system)`}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded
                         hover:bg-bg-nav-hover hover:text-ink-primary transition leading-none shrink-0"
              aria-label={`Switch theme (current: ${themeLabel})`}
            >
              <span className="text-[12px] leading-none">{themeIcon}</span>
            </button>
            <div
              className="flex items-center gap-1.5 shrink-0"
              title={
                health
                  ? `Backend connected · pid ${health.pid}`
                  : everConnected
                    ? "Backend unreachable"
                    : "Backend connecting…"
              }
            >
              <span
                className={
                  "inline-block w-1.5 h-1.5 rounded-full " +
                  (health
                    ? "bg-phos"
                    : everConnected
                      ? "bg-danger animate-pulse"
                      : "bg-amber animate-pulse")
                }
              />
              <span className="hidden md:inline">
                {health
                  ? "BACKEND"
                  : everConnected
                    ? "OFFLINE"
                    : "CONNECTING"}
              </span>
            </div>
          </div>
        </div>

        <EngagementTabs onChange={setActive} />
        <PageBackBar />
        <main className="flex-1 overflow-hidden">
         <ErrorBoundary resetKey={String(active)}>
          {active === "home"       ? <EngagementDashboard onNavigate={navigate} /> :
           active === "dashboard"  ? <EngagementDashboard onNavigate={navigate} /> :
           active === "engagements" ? <Engagements /> :
           active === "targets"     ? <Targets onJumpTo={navigate} /> :
           active === "tools"       ? <Tools onJumpTo={navigate} /> :
           active === "workspace"   ? <EngagementWorkspace onJumpTo={navigate} /> :
           active === "evidence"    ? <EngagementWorkspace onJumpTo={navigate} /> :
           active === "reports"     ? <EngagementWorkspace onJumpTo={navigate} /> :
           active === "findings"    ? <Findings onJumpTo={navigate} /> :
           active === "assistant"   ? <AiAssistant activePage={active} /> :
           active === "playbooks"   ? <Playbooks initialTab="browse" onJumpTo={navigate} /> :
           active === "playbook-builder" ? <Playbooks initialTab="build" onJumpTo={navigate} /> :
           active === "labs"        ? <Labs onJumpTo={navigate} /> :
           active === "selfassess"  ? <SelfAssess onJumpTo={navigate} /> :
           active === "ip"          ? <IpChecker /> :
           active === "dns"         ? <DnsRecon /> :
           active === "whois"       ? <Whois /> :
           active === "tls"         ? <TlsAudit /> :
           active === "fingerprint" ? <Fingerprint /> :
           active === "http"        ? <HttpProbe /> :
           active === "ct"          ? <CtLog /> :
           active === "email"       ? <EmailSecurity /> :
           active === "takeover"    ? <Takeover /> :
           active === "revip"       ? <ReverseIp /> :
           active === "cms"         ? <Cms /> :
           active === "jwt"         ? <Jwt /> :
           active === "graphql"     ? <Graphql /> :
           active === "subdom"      ? <SubdomainEnum /> :
           active === "xss"         ? <Xss /> :
           active === "sqli"        ? <Sqli /> :
           active === "cmdi"        ? <Cmdi /> :
           active === "lfi"         ? <Lfi /> :
           active === "ssrf"        ? <Ssrf /> :
           active === "idor"        ? <Idor /> :
           active === "imds"        ? <Imds /> :
           active === "s3"          ? <S3Scanner /> :
           active === "aws"         ? <AwsRecon /> :
           active === "azure"       ? <AzureRecon /> :
           active === "gcp"         ? <GcpRecon /> :
           active === "ldap"        ? <LdapEnum /> :
           active === "smb"         ? <SmbEnum /> :
           active === "adspray"     ? <AdSpray /> :
           active === "kerberoast"  ? <KerberosRoast /> :
           active === "bloodhound"  ? <BloodHound /> :
           active === "lateral"     ? <LateralMove /> :
           active === "wifiscan"    ? <WifiScan /> :
           active === "eviltwin"    ? <EvilTwin /> :
           active === "bt"          ? <BtRecon /> :
           active === "wpacap"      ? <WpaCapture /> :
           active === "pivot"       ? <PivotingHelper /> :
           active === "credhrv"     ? <CredHarvest /> :
           active === "c2"          ? <C2Beacon /> :
           active === "breach"      ? <BreachLookup /> :
           active === "dorking"     ? <Dorking /> :
           active === "ghleak"      ? <GithubLeak /> :
           active === "shodanc"     ? <ShodanCensys /> :
           active === "people"      ? <PeopleEnum /> :
           active === "profiles"    ? <ProfileFinder /> :
           active === "obfuscator"  ? <Obfuscator /> :
           active === "cvss"        ? <CvssCalculator /> :
           active === "hash"        ? <HashCracker /> :
           active === "macos"       ? <MacosPosture /> :
           active === "linuxposture" ? <LinuxPosture /> :
           active === "windowsposture" ? <WindowsPosture /> :
           active === "systemd"     ? <Systemd /> :
           active === "firewallrules" ? <FirewallRules /> :
           active === "usersaudit"  ? <UsersAudit /> :
           active === "localdisco"  ? <LocalDiscovery /> :
           active === "ports"       ? <PortScanner /> :
           active === "nmap"        ? <Nmap /> :
           active === "lan"         ? <LanScan /> :
           active === "audit"       ? <NetworkAudit /> :
           active === "ids"         ? <Ids /> :
           active === "persistence" ? <Persistence /> :
           active === "processes"   ? <Processes /> :
           active === "stego"       ? <Stego /> :
           active === "revshell"    ? <ReverseShell /> :
           active === "ping"        ? <Ping /> :
           active === "tcpdump"     ? <Tcpdump /> :
           active === "wifi"        ? <Wifi /> :
           active === "term"        ? <Terminal /> :
           active === "brew"        ? <Brew /> :
           active === "exploits"    ? <Exploits /> :
           active === "wayback"     ? <Wayback /> :
           active === "urlscan"     ? <UrlScan /> :
           active === "emailharvest" ? <EmailHarvest /> :
           active === "dorksgen"    ? <DorksGen /> :
           active === "audit-log"   ? <Audit /> :
           active === "effects-debug" ? <EffectsDebug /> :
           active === "settings"    ? <Settings onJumpTo={navigate} /> :
           isPlannedId(active)      ? <PlannedToolPage
                                          id={active}
                                          onOpenCatalog={() => setCatalogOpen(true)}
                                          onAfterRemove={() => navigate("home")}
                                        /> :
                                      <Placeholder name={active} />}
         </ErrorBoundary>
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelect={(id) => navigate(id)}
        platform={platform}
      />
      <ToolCatalog
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onOpenTool={(id) => navigate(id)}
      />
      <ChatBubble activePage={String(active)} />
    </div>
  );
}
