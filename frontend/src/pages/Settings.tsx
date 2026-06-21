// Central Settings page. The roadmap calls this out as a v1.0 critical
// item: API keys were previously only managable via curl (for named keys)
// or through the chat-bubble settings panel (for the Anthropic key), with
// no single place for the user to see what was configured.
//
// Sections:
//   - System: backend version, platform, hostname, Python version, refresh
//   - Anthropic API key (chat assistant)
//   - External API keys (10 keys for OSINT / cloud / breach sources)
//   - Mode (Lab vs Engagement)
//   - Appearance (theme cycle)
//   - Engagement quick-links (Engagements list, Findings, Audit log)
//
// Out of scope for this first cut:
//   - Sudoers cleanup UI (just shows current install status; revoke happens
//     via the existing tcpdump/nmap pages or `sudo rm /etc/sudoers.d/...`).
//   - Restart sidecar / clear engagement DB (destructive ops we want
//     confirmation flows for; out of v1 settings scope).

import { useCallback, useEffect, useState } from "react";
import { Button, EyebrowPill, StatusDot, WibblingSpinner } from "performative-ui";
import {
  api,
  auditPromptEdit,
  deleteApiKey, deleteNamedKey,
  fetchApiKeyStatus, fetchNamedKeys, fetchSystemInfo,
  fetchTcpdumpStatus, fetchNmapStatus,
  fetchChatSettings, updateChatSettings,
  revokeTcpdumpSudoers, revokeNmapSudoers,
  setApiKey, setNamedKey,
  type ApiKeyStatus, type NamedKeyStatus,
  type SystemInfo, type TcpdumpStatus, type NmapStatus,
  type ChatSettings,
} from "../api";
import { useTheme } from "../lib/theme";
import { useMode } from "../lib/mode";
import { switchMode } from "../lib/modeSwitch";
import { useActiveEngagementId } from "../lib/engagement";
import {
  DOPAMINE_DEFAULTS, DOPAMINE_PRESETS,
  getSettings as getDopamineSettings,
  setSettings as setDopamineSettings,
  resetSettings as resetDopamineSettings,
  playNamed,
  pulse, celebrateBig, inkConfirm, radarSweep, failStamp,
  type DopamineSettings, type DopamineMood, type EffectName,
} from "../lib/dopamine";
import Glyph, { type GlyphName, type GlyphGroup } from "../components/Glyph";

type Health = { status: string; version: string; pid: string };

type Props = {
  onJumpTo: (id: string) => void;
};

export default function Settings({ onJumpTo }: Props) {
  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
          Utilities
        </div>
        <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
          Settings
        </h2>
        <p className="mt-1 text-[11px] text-ink-dim max-w-2xl">
          API keys, system info, appearance. Keys live in the OS keychain —
          HackingPal never writes them to disk.
        </p>
      </header>

      <div className="p-6 space-y-6 max-w-3xl">
        <SystemSection />
        <AnthropicKeySection />
        <AssistantSection />
        <NamedKeysSection />
        <PrivilegedToolsSection />
        <ModeSection onJumpTo={onJumpTo} />
        <AppearanceSection />
        <EffectsSection />
        <DeveloperSection />
      </div>
    </div>
  );
}

// ── Developer ──────────────────────────────────────────────────────────────
// Glyphs + EffectsDebug used to be separate sidebar pages. They moved
// here as collapsible disclosures — the only entry point was Settings
// anyway, and keeping them out of the top nav reflects the workflow-first
// pivot in CLAUDE.md.

function DeveloperSection() {
  return (
    <Section title="Developer"
             hint="Design-system reference + effects layer debug. Open the panels you need.">
      <div className="space-y-2">
        <Disclosure
          summary="Glyphs"
          hint="Operator Glyph Set — every glyph at display + ship size, light + dark."
        >
          <GlyphsBody />
        </Disclosure>
        <Disclosure
          summary="Effects Debug"
          hint="Fire every Dopamine effect anchored to its tile so visual glitches are easy to isolate."
        >
          <EffectsDebugBody />
        </Disclosure>
      </div>
    </Section>
  );
}

// `<details>` with a styled summary chevron. Keeps both heavy debug
// panels collapsed by default so they don't dominate the Settings scroll.
function Disclosure({ summary, hint, children }: {
  summary: string; hint: string; children: React.ReactNode;
}) {
  return (
    <details className="group rounded border border-divider bg-bg-base
                        open:bg-bg-card transition">
      <summary className="cursor-pointer list-none px-3 py-2 flex items-center
                          gap-2 hover:bg-bg-nav-hover rounded">
        <span className="text-ink-dim text-[10px] transition
                         group-open:rotate-90 inline-block w-3">▶</span>
        <span className="text-ink-primary font-bold text-[12px]">{summary}</span>
        <span className="text-[11px] text-ink-dim truncate">{hint}</span>
      </summary>
      <div className="px-3 pb-3 pt-1 border-t border-divider/60">
        {children}
      </div>
    </details>
  );
}

// ── Glyphs body (inlined from former pages/Glyphs.tsx) ─────────────────────

type GlyphSection = {
  group: GlyphGroup;
  title: string;
  subtitle: string;
  lightColor: string;
  darkColor: string;
  items: { name: GlyphName; label: string }[];
};

const GLYPH_SECTIONS: GlyphSection[] = [
  {
    group: "recon",
    title: "Recon & Intel",
    subtitle: "Passive discovery, enumeration, OSINT",
    lightColor: "#2c7a52",
    darkColor:  "#4fd089",
    items: [
      { name: "ping",             label: "Ping" },
      { name: "wifi-scan",        label: "WiFi Scan" },
      { name: "local-discovery",  label: "Local Discovery" },
      { name: "dns-recon",        label: "DNS Recon" },
      { name: "whois",            label: "WHOIS" },
      { name: "subdomain-enum",   label: "Subdomain Enum" },
      { name: "http-probe",       label: "HTTP Probe" },
      { name: "shodan",           label: "Shodan / Censys" },
      { name: "dorking",          label: "Google Dorking" },
      { name: "dorks-gen",        label: "Dorks Generator" },
      { name: "ct-logs",          label: "CT Logs" },
      { name: "wayback",          label: "Wayback URLs" },
      { name: "cms-detect",       label: "CMS Detect" },
      { name: "github-leak",      label: "GitHub Leak" },
      { name: "profile-finder",   label: "Profile Finder" },
      { name: "people-enum",      label: "People Enum" },
      { name: "email-harvest",    label: "Email Harvest" },
      { name: "reverse-ip",       label: "Reverse IP" },
      { name: "ip-checker",       label: "IP Checker" },
      { name: "aws-recon",        label: "AWS Recon" },
      { name: "fingerprint",      label: "Fingerprint" },
      { name: "url-scan",         label: "URL Scan" },
      { name: "port-scanner",     label: "Port Scanner" },
      { name: "nmap",             label: "Nmap" },
      { name: "lan-scan",         label: "LAN Scan" },
      { name: "s3-scanner",       label: "S3 Scanner" },
      { name: "ldap-enum",        label: "LDAP Enum" },
      { name: "smb-enum",         label: "SMB Enum" },
      { name: "bluetooth",        label: "Bluetooth Recon" },
      { name: "wifi-integrity",   label: "WiFi Integrity" },
      { name: "graphql",          label: "GraphQL" },
      { name: "stego",            label: "Steganography" },
    ],
  },
  {
    group: "offense",
    title: "Offense & Exploitation",
    subtitle: "Active attack, payloads, credential abuse",
    lightColor: "#b8513a",
    darkColor:  "#e88467",
    items: [
      { name: "c2-beacon",          label: "C2 Beacon" },
      { name: "kerberos-roast",     label: "Kerberos Roast" },
      { name: "attack-results",     label: "Attack Results" },
      { name: "wpa-capture",        label: "WPA Capture" },
      { name: "persistence",        label: "Persistence" },
      { name: "hash-cracker",       label: "Hash Cracker" },
      { name: "reverse-shell",      label: "Reverse Shell" },
      { name: "exploits",           label: "Exploits" },
      { name: "ad-spray",           label: "AD Spray" },
      { name: "lateral-movement",   label: "Lateral Movement" },
      { name: "evil-twin",          label: "Evil Twin" },
      { name: "breach-lookup",      label: "Breach Lookup" },
      { name: "subdomain-takeover", label: "Subdomain Takeover" },
      { name: "stego-embed",        label: "Stego Embed" },
    ],
  },
  {
    group: "system",
    title: "Posture & System",
    subtitle: "Defense, hardening, host & service state",
    lightColor: "#33373e",
    darkColor:  "#dfe3e8",
    items: [
      { name: "linux-posture",   label: "Linux Posture" },
      { name: "macos-posture",   label: "macOS Posture" },
      { name: "windows-posture", label: "Windows Posture" },
      { name: "network-audit",   label: "Network Audit" },
      { name: "ids",             label: "IDS" },
      { name: "tls-auditor",     label: "TLS Auditor" },
      { name: "email-security",  label: "Email Security" },
      { name: "firewall-rules",  label: "Firewall Rules" },
      { name: "systemd-units",   label: "Systemd Units" },
      { name: "processes",       label: "Processes" },
      { name: "tcpdump",         label: "TCPDump" },
      { name: "ai-assistant",    label: "AI Assistant" },
      { name: "report",          label: "Report" },
    ],
  },
];

function GlyphsBody() {
  const total = GLYPH_SECTIONS.reduce((n, s) => n + s.items.length, 0);
  return (
    <div className="pt-2">
      <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono
                      text-ink-muted mb-4">
        <GlyphLegendDot color="#2c7a52" label="recon & intel" />
        <GlyphLegendDot color="#b8513a" label="offense & exploit" />
        <GlyphLegendDot color="#33373e" label="posture & system" />
        <span className="flex-1" />
        <span className="text-ink-dim">
          24-grid · 1.6 stroke · round caps · {total} glyphs
        </span>
      </div>
      <div className="space-y-6">
        {GLYPH_SECTIONS.map((sec) => <GlyphSectionBlock key={sec.group} section={sec} />)}
      </div>
    </div>
  );
}

function GlyphSectionBlock({ section }: { section: GlyphSection }) {
  return (
    <section className="border-t border-divider pt-4">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="w-2 h-2 rounded-full"
              style={{ background: section.lightColor }} />
        <h3 className="text-[13px] font-semibold text-ink-primary">{section.title}</h3>
        <span className="text-[11px] text-ink-muted">{section.subtitle}</span>
        <span className="flex-1" />
        <span className="text-[10px] font-mono text-ink-dim">
          {String(section.items.length).padStart(2, "0")} glyphs
        </span>
      </div>
      <div className="grid gap-3"
           style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        {section.items.map((it) => (
          <div key={it.name} className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <div className="flex-1 flex items-center justify-center gap-3 h-[78px]
                              rounded-md border"
                   style={{ background: "#f7f5ef", borderColor: "#eae7dd",
                            color: section.lightColor }}>
                <Glyph name={it.name} size={30} />
                <Glyph name={it.name} size={18} />
              </div>
              <div className="flex-1 flex items-center justify-center gap-3 h-[78px]
                              rounded-md border"
                   style={{ background: "#16181b", borderColor: "#16181b",
                            color: section.darkColor }}>
                <Glyph name={it.name} size={30} />
                <Glyph name={it.name} size={18} />
              </div>
            </div>
            <div className="text-center font-mono text-[11px] text-ink-muted tracking-wide">
              {it.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GlyphLegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

// ── Effects Debug body (inlined from former pages/EffectsDebug.tsx) ────────

type EffectsDebugRow = {
  id: string;
  label: string;
  blurb: string;
  fire: (el: HTMLElement) => Promise<void>;
};

const EFFECTS_DEBUG_BUILTINS: EffectName[] = [
  "solarbloom", "inkstroke", "comic", "fail", "ripple",
  "confetti", "heartburst", "lightning",
];

const EFFECTS_DEBUG_NOTE: Record<EffectName, string> = {
  solarbloom: "bloom + check anchored at origin",
  inkstroke:  "ink stroke anchored at origin",
  comic:      "comic word anchored at origin",
  fail:       "✗ stamp anchored at origin",
  ripple:     "concentric waves from origin",
  confetti:   "panel burst from origin",
  heartburst: "panel burst from origin",
  lightning:  "strike from origin",
};

function EffectsDebugBody() {
  const [debugOn, setDebugOn] = useState<boolean>(
    () => (typeof window !== "undefined"
      && window.localStorage.getItem("mhp:dopamine-debug") === "1"),
  );
  const [lastFired, setLastFired] = useState<string | null>(null);
  const [errored, setErrored] = useState<Set<string>>(new Set());
  const [success, setSuccess] = useState<Set<string>>(new Set());
  const [inflight, setInflight] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem("mhp:dopamine-debug", debugOn ? "1" : "0");
    } catch { /* ignore */ }
  }, [debugOn]);

  async function safeFire(id: string, btn: HTMLElement, fn: () => Promise<void>) {
    setInflight(id);
    setLastFired(id);
    const onErr = (e: ErrorEvent | PromiseRejectionEvent) => {
      // eslint-disable-next-line no-console
      console.warn("[effects-debug]", id, "window error:", e);
    };
    window.addEventListener("error", onErr as EventListener);
    window.addEventListener("unhandledrejection", onErr as EventListener);
    try {
      await fn();
      setSuccess((s) => new Set(s).add(id));
      setErrored((s) => { const n = new Set(s); n.delete(id); return n; });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[effects-debug]", id, "rejected:", e);
      setErrored((s) => new Set(s).add(id));
    } finally {
      window.removeEventListener("error", onErr as EventListener);
      window.removeEventListener("unhandledrejection", onErr as EventListener);
      setTimeout(() => setInflight((cur) => cur === id ? null : cur), 250);
    }
    void btn;
  }

  const rows: EffectsDebugRow[] = [
    ...EFFECTS_DEBUG_BUILTINS.map<EffectsDebugRow>((name) => ({
      id: `play:${name}`,
      label: name,
      blurb: EFFECTS_DEBUG_NOTE[name],
      fire: (el) => playNamed(name, el),
    })),
    { id: "helper:pulse",        label: "pulse() — celebrate",
      blurb: "m.celebrate(…) with current settings",
      fire: (el) => pulse(el) },
    { id: "helper:celebrateBig", label: "celebrateBig() — milestone",
      blurb: "celebrate boosted by 1.5×",
      fire: (el) => celebrateBig(el) },
    { id: "helper:inkConfirm",   label: "inkConfirm() — checkbox",
      blurb: "m.celebrateInk(…)",
      fire: (el) => inkConfirm(el) },
    { id: "helper:radarSweep",   label: "radarSweep() — scan start",
      blurb: 'm.play("ripple", …)',
      fire: (el) => radarSweep(el) },
    { id: "helper:failStamp",    label: "failStamp() — error",
      blurb: "m.fail(…)",
      fire: (el) => failStamp(el) },
  ];

  return (
    <div className="pt-2">
      <div className="flex items-center gap-4 text-[11px] mb-3">
        <EyebrowPill icon={false} className="mhp-eyebrow">DEBUG</EyebrowPill>
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={debugOn}
                 onChange={(e) => setDebugOn(e.target.checked)}
                 className="accent-accent" />
          <span className="text-ink-primary">Console debug (mhp:dopamine-debug)</span>
        </label>
        <span className="text-ink-dim">·</span>
        <span className="text-ink-muted">
          Last fired: <span className="font-mono text-ink-primary">{lastFired ?? "—"}</span>
        </span>
        {inflight && (
          <span className="ml-auto text-ink-muted inline-flex items-center gap-2">
            <WibblingSpinner />
          </span>
        )}
      </div>

      <p className="text-[11px] text-ink-muted mb-3 max-w-2xl">
        Click any tile to fire that effect anchored to the tile's center. Tiles
        turn green on success, red on a thrown error — a quiet visual glitch
        (black-screen) won't show up here, watch the page itself.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {rows.map((r) => {
          const ok = success.has(r.id);
          const bad = errored.has(r.id);
          return (
            <button key={r.id}
                    onClick={(e) => safeFire(r.id, e.currentTarget,
                                             () => r.fire(e.currentTarget))}
                    disabled={inflight === r.id}
                    className={
                      "text-left rounded-md border px-3 py-2.5 transition " +
                      (bad ? "border-danger/60 bg-danger/10 "
                        : ok ? "border-phos/60 bg-phos/10 "
                        : "border-divider hover:border-ink-muted bg-bg-card ")
                    }>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-primary text-[12px] font-bold font-mono">
                  {r.label}
                </span>
                <span className="text-[10px] uppercase tracking-wider">
                  {bad ? <span className="text-danger">err</span>
                    : ok ? <span className="text-phos">ok</span>
                    : <span className="text-ink-dim">idle</span>}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-ink-muted font-mono truncate">
                {r.blurb}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── System ─────────────────────────────────────────────────────────────────

function SystemSection() {
  const [health, setHealth] = useState<Health | null>(null);
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [h, s] = await Promise.all([
        api<Health>("/health").catch(() => null),
        fetchSystemInfo().catch(() => null),
      ]);
      setHealth(h);
      setSysInfo(s);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Section title="System" hint="Sidecar runtime + platform — useful when filing a bug.">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
        <Row label="Backend version" value={health?.version ?? "—"} />
        <Row label="Backend PID"     value={health?.pid ?? "—"} />
        <Row label="Status"          value={health?.status ?? "unreachable"}
             tone={health?.status === "ok" ? "text-phos" : "text-danger"} />
        <Row label="Platform"        value={sysInfo?.system ?? "—"} />
        <Row label="Release"         value={sysInfo?.release ?? "—"} />
        <Row label="Architecture"    value={sysInfo?.arch ?? "—"} />
        <Row label="Hostname"        value={sysInfo?.hostname ?? "—"} />
        <Row label="Python"          value={sysInfo?.python_version ?? "—"} />
      </div>
      <div className="mt-3">
        <button onClick={refresh} disabled={refreshing}
                className="px-3 py-1.5 rounded bg-bg-base border border-divider
                           text-[11px] text-ink-primary hover:border-accent
                           disabled:opacity-40">
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </Section>
  );
}

// ── Anthropic key ──────────────────────────────────────────────────────────

function AnthropicKeySection() {
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try { setStatus(await fetchApiKeyStatus()); }
    catch { setStatus({ present: false }); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function save() {
    const k = input.trim();
    if (!k) return;
    setBusy(true); setError("");
    try {
      setStatus(await setApiKey(k));
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remove the saved Anthropic API key from the Keychain?")) return;
    setBusy(true); setError("");
    try { setStatus(await deleteApiKey()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Section title="Anthropic API key" hint="Powers the AI chat assistant (claude-opus-4-7).">
      {status?.present ? (
        <div className="flex items-center gap-3 text-[12px]">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-phos" />
          <span className="text-ink-primary">
            Configured · ending <code className="text-amber">…{status.last4}</code>
          </span>
          <button onClick={remove} disabled={busy}
                  className="ml-auto px-2 py-0.5 rounded border border-divider
                             text-[11px] text-ink-muted hover:border-danger
                             hover:text-danger disabled:opacity-40">
            Remove
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="sk-ant-…"
            disabled={busy}
            className="flex-1 bg-bg-base border border-divider rounded
                       px-2 py-1.5 text-[12px] font-mono text-ink-primary
                       focus:outline-none focus:border-accent"
          />
          <button onClick={save} disabled={busy || !input.trim()}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px]
                             font-bold disabled:opacity-40">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      )}
      {error && <div className="mt-2 text-[11px] text-danger">⚠ {error}</div>}
    </Section>
  );
}

// ── Assistant (model + system prompt) ──────────────────────────────────────

const MODEL_LABELS: Record<string, { label: string; hint: string }> = {
  "claude-opus-4-7": {
    label: "Opus 4.7",
    hint: "Smartest, slowest, most expensive.",
  },
  "claude-sonnet-4-6": {
    label: "Sonnet 4.6",
    hint: "Recommended default — fast + plenty smart for explaining scans.",
  },
  "claude-haiku-4-5-20251001": {
    label: "Haiku 4.5",
    hint: "Fastest + cheapest. Weaker on multi-step reasoning.",
  },
};

function AssistantSection() {
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState("");

  const refresh = useCallback(async () => {
    try {
      const s = await fetchChatSettings();
      setSettings(s);
      setPrompt(s.system_prompt);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function pickModel(m: string) {
    setBusy(true); setError("");
    try {
      const updated = await updateChatSettings({ model: m });
      setSettings(updated);
      setSavedFlash("Model updated.");
      window.setTimeout(() => setSavedFlash(""), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function savePrompt() {
    setBusy(true); setError("");
    const before = settings?.system_prompt.length ?? 0;
    try {
      const updated = await updateChatSettings({ system_prompt: prompt });
      setSettings(updated);
      setSavedFlash("System prompt saved.");
      window.setTimeout(() => setSavedFlash(""), 2000);
      // Audit best-effort — save already succeeded; a failed audit POST
      // shouldn't unwind it.
      void auditPromptEdit(before, updated.system_prompt.length, updated.model)
        .catch(() => { /* best-effort */ });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function resetPrompt() {
    if (settings) setPrompt(settings.system_prompt);
  }

  if (!settings) {
    return (
      <Section title="Assistant" hint="Model + system prompt for the in-app AI chat.">
        <div className="text-[11px] text-ink-dim">Loading…</div>
      </Section>
    );
  }

  const dirty = settings.system_prompt !== prompt;

  return (
    <Section title="Assistant" hint="Model + system prompt for the in-app AI chat.">
      <div className="space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1.5">
            Model
          </div>
          <div className="flex flex-col gap-1.5">
            {settings.available_models.map((m) => {
              const meta = MODEL_LABELS[m] ?? { label: m, hint: "" };
              const active = settings.model === m;
              return (
                <label key={m}
                       className={"flex items-start gap-2 px-2.5 py-2 rounded border cursor-pointer transition " +
                         (active
                           ? "border-accent/60 bg-accent/10"
                           : "border-divider bg-bg-card hover:border-ink-muted")}>
                  <input type="radio" checked={active}
                         disabled={busy}
                         onChange={() => void pickModel(m)}
                         className="mt-0.5" />
                  <div className="flex-1">
                    <div className="text-[12px] font-bold text-ink-primary">
                      {meta.label}
                      <span className="ml-2 font-mono font-normal text-[10px] text-ink-dim">{m}</span>
                    </div>
                    {meta.hint && (
                      <div className="text-[10px] text-ink-muted mt-0.5">{meta.hint}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-widest text-ink-dim">
              System prompt
            </span>
            {settings.system_prompt_path && (
              <span className="text-[10px] font-mono text-ink-dim truncate">
                {settings.system_prompt_path}
              </span>
            )}
          </div>
          {settings.system_prompt_editable ? (
            <>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={10}
                disabled={busy}
                spellCheck={false}
                className="w-full bg-bg-base border border-divider rounded
                           px-2.5 py-2 text-[11px] font-mono text-ink-primary
                           focus:outline-none focus:border-accent resize-y"
              />
              <div className="flex items-center gap-2 mt-2">
                <button onClick={savePrompt}
                        disabled={busy || !dirty}
                        className="px-3 py-1.5 rounded bg-accent text-white text-[11px] font-bold
                                   disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy ? "Saving…" : "Save prompt"}
                </button>
                <button onClick={resetPrompt}
                        disabled={busy || !dirty}
                        className="px-3 py-1.5 rounded bg-bg-base border border-divider
                                   text-[11px] text-ink-muted hover:text-ink-primary
                                   disabled:opacity-40">
                  Revert
                </button>
                <span className="ml-auto text-[10px] text-ink-dim">
                  {prompt.length.toLocaleString()} chars
                </span>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-amber bg-amber/10 border border-amber/30 rounded p-2">
              System prompt is read-only — <code>MHP_CHAT_SYSTEM_PROMPT</code> env var is set,
              which overrides the file.
            </div>
          )}
        </div>

        {savedFlash && <div className="text-[11px] text-phos">{savedFlash}</div>}
        {error && <div className="text-[11px] text-danger">⚠ {error}</div>}
      </div>
    </Section>
  );
}

// ── Named external-service keys ────────────────────────────────────────────

function NamedKeysSection() {
  const [keys, setKeys] = useState<NamedKeyStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setKeys(await fetchNamedKeys()); }
    catch { setKeys([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Section title="External API keys"
             hint="OSINT / breach / cloud / search sources. Each unlocks the matching tool.">
      {loading && keys.length === 0 ? (
        <div className="text-[12px] text-ink-dim italic">Loading…</div>
      ) : keys.length === 0 ? (
        <div className="text-[12px] text-ink-dim italic">
          Backend hasn't reported any configurable keys yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {keys.map((k) => (
            <NamedKeyRow key={k.name} initial={k} onChange={refresh} />
          ))}
        </div>
      )}
    </Section>
  );
}

function NamedKeyRow({ initial, onChange }: {
  initial: NamedKeyStatus; onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(initial);

  useEffect(() => { setStatus(initial); }, [initial]);

  async function save() {
    const v = input.trim();
    if (!v) return;
    setBusy(true); setError("");
    try {
      setStatus(await setNamedKey(status.name, v));
      setInput("");
      setEditing(false);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove the ${status.label} from the Keychain?`)) return;
    setBusy(true); setError("");
    try {
      setStatus(await deleteNamedKey(status.name));
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-divider/40 last:border-0">
      <div className="flex items-center gap-3 py-1.5">
        <span className={"inline-block w-1.5 h-1.5 rounded-full " +
                         (status.present ? "bg-phos" : "bg-ink-dim")} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-ink-primary truncate">
            {status.label}
          </div>
          <div className="text-[10px] text-ink-dim font-mono truncate">
            {status.name}
            {status.present && status.last4 && (
              <span className="ml-1.5 text-amber">…{status.last4}</span>
            )}
          </div>
        </div>
        {!editing ? (
          <>
            <button onClick={() => { setEditing(true); setInput(""); setError(""); }}
                    disabled={busy}
                    className="px-2 py-0.5 rounded bg-bg-base border border-divider
                               text-[11px] text-ink-primary hover:border-accent
                               disabled:opacity-40">
              {status.present ? "Replace" : "Set"}
            </button>
            {status.present && (
              <button onClick={remove} disabled={busy}
                      className="px-2 py-0.5 rounded border border-divider
                                 text-[11px] text-ink-muted hover:border-danger
                                 hover:text-danger disabled:opacity-40">
                Remove
              </button>
            )}
          </>
        ) : (
          <>
            <input
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="paste secret"
              disabled={busy}
              autoFocus
              className="w-64 bg-bg-base border border-divider rounded
                         px-2 py-1 text-[11px] font-mono text-ink-primary
                         focus:outline-none focus:border-accent"
            />
            <button onClick={save} disabled={busy || !input.trim()}
                    className="px-2 py-0.5 rounded bg-accent text-white text-[11px]
                               font-bold disabled:opacity-40">
              {busy ? "…" : "Save"}
            </button>
            <button onClick={() => { setEditing(false); setInput(""); }}
                    disabled={busy}
                    className="px-2 py-0.5 rounded border border-divider
                               text-[11px] text-ink-muted disabled:opacity-40">
              Cancel
            </button>
          </>
        )}
      </div>
      {error && (
        <div className="pl-5 pb-1.5 text-[10px] text-danger">⚠ {error}</div>
      )}
    </div>
  );
}

// ── Privileged tools (sudoers status, read-only) ──────────────────────────

function PrivilegedToolsSection() {
  const [tcp, setTcp] = useState<TcpdumpStatus | null>(null);
  const [nmap, setNmap] = useState<NmapStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"tcpdump" | "nmap" | null>(null);
  const [error, setError] = useState<{ tool: "tcpdump" | "nmap"; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    const [t, n] = await Promise.all([
      fetchTcpdumpStatus().catch(() => null),
      fetchNmapStatus().catch(() => null),
    ]);
    setTcp(t);
    setNmap(n);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await refresh();
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [refresh]);

  async function revoke(tool: "tcpdump" | "nmap") {
    const target = tool === "tcpdump" ? "tcpdump" : "nmap (SYN/UDP/OS)";
    if (!confirm(
      `Remove the passwordless-sudo entry for ${target}?\n\n` +
      `Future scans that need root will prompt for your password again. ` +
      `You'll see the OS admin prompt next to authorize the removal.`,
    )) return;
    setBusy(tool); setError(null);
    try {
      if (tool === "tcpdump") await revokeTcpdumpSudoers();
      else                    await revokeNmapSudoers();
      await refresh();
    } catch (e) {
      setError({ tool, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <Section title="Privileged tools" hint="Sudoers drop-ins for tcpdump + nmap.">
        <div className="text-[12px] text-ink-dim italic">Loading…</div>
      </Section>
    );
  }

  return (
    <Section title="Privileged tools"
             hint="Sudoers drop-ins let tcpdump + nmap SYN/UDP/OS scans run without re-prompting. Use Revoke to remove with one click — the OS admin prompt covers the privileged file removal.">
      <div className="space-y-1.5 text-[12px]">
        <StatusLine label="tcpdump"
                    installed={!!tcp?.passwordless}
                    detail={tcp?.passwordless
                      ? (tcp.sudoers_path || "/etc/sudoers.d/network-tools-tcpdump")
                      : "not installed (install on the TCPDump page)"}
                    onRevoke={tcp?.passwordless ? () => revoke("tcpdump") : undefined}
                    busy={busy === "tcpdump"}
                    error={error?.tool === "tcpdump" ? error.msg : null} />
        <StatusLine label="nmap (SYN/UDP/OS)"
                    installed={!!nmap?.passwordless}
                    detail={nmap?.passwordless
                      ? (nmap.sudoers_path || "/etc/sudoers.d/network-tools-nmap")
                      : "not installed (install on the Nmap page)"}
                    onRevoke={nmap?.passwordless ? () => revoke("nmap") : undefined}
                    busy={busy === "nmap"}
                    error={error?.tool === "nmap" ? error.msg : null} />
      </div>
    </Section>
  );
}

function StatusLine({ label, installed, detail, onRevoke, busy, error }: {
  label: string; installed: boolean; detail: string;
  onRevoke?: () => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <StatusDot
          color={installed ? "rgb(var(--phos-rgb))" : "rgb(var(--ink-dim-rgb))"}
          static={!installed}
        />
        <span className="text-ink-primary w-40">{label}</span>
        <span className="text-ink-muted font-mono text-[11px] flex-1 truncate">{detail}</span>
        {onRevoke && (
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => { void onRevoke(); }}
            title="Remove the passwordless-sudo drop-in. You'll see the OS admin prompt."
          >
            Revoke
          </Button>
        )}
      </div>
      {error && (
        <div className="pl-5 pt-0.5 text-[10px] text-danger">⚠ {error}</div>
      )}
    </div>
  );
}

// ── Appearance ─────────────────────────────────────────────────────────────

// ── Mode (Lab vs Engagement) ───────────────────────────────────────────────

function ModeSection({ onJumpTo }: { onJumpTo: (id: string) => void }) {
  const mode = useMode();
  const activeId = useActiveEngagementId();
  const isEngagement = mode === "engagement";

  return (
    <Section
      title="Mode"
      hint="Lab is for free experimentation. Engagement enforces scope and auto-records evidence."
    >
      <div className="flex items-stretch gap-2">
        <button
          onClick={() => switchMode("lab")}
          className={
            "flex-1 text-left p-3 rounded border transition " +
            (!isEngagement
              ? "border-amber bg-bg-base"
              : "border-divider bg-bg-base hover:border-ink-muted")
          }
        >
          <div className="flex items-center gap-2">
            <span className={"inline-block w-1.5 h-1.5 rounded-full " +
              (!isEngagement ? "bg-amber" : "bg-ink-dim")} />
            <span className="text-[12px] font-bold text-ink-primary">Lab</span>
            {!isEngagement && (
              <span className="ml-auto text-[10px] uppercase tracking-wider text-amber">
                Active
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-ink-dim">
            Scope checks skipped. Auto-record suppressed. Use against your own
            targets — home lab, public test sites, your own infra.
          </div>
        </button>

        <button
          onClick={() => switchMode("engagement")}
          className={
            "flex-1 text-left p-3 rounded border transition " +
            (isEngagement
              ? "border-phos bg-bg-base"
              : "border-divider bg-bg-base hover:border-ink-muted")
          }
        >
          <div className="flex items-center gap-2">
            <span className={"inline-block w-1.5 h-1.5 rounded-full " +
              (isEngagement ? "bg-phos" : "bg-ink-dim")} />
            <span className="text-[12px] font-bold text-ink-primary">Engagement</span>
            {isEngagement && (
              <span className="ml-auto text-[10px] uppercase tracking-wider text-phos">
                Active
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-ink-dim">
            Scope enforced against the active engagement. Results auto-attach
            to the evidence timeline. Use for authorized assessments.
          </div>
        </button>
      </div>

      {isEngagement && !activeId && (
        <div className="mt-3 px-3 py-2 rounded border border-amber/40 bg-amber/5
                        text-[11px] text-amber">
          No active engagement. Target-accepting tools will be denied until
          you{" "}
          <button onClick={() => onJumpTo("engagements")}
                  className="underline hover:text-ink-primary">
            pick one
          </button>
          .
        </div>
      )}
    </Section>
  );
}

function AppearanceSection() {
  const theme = useTheme();
  const choices: { id: typeof theme.choice; label: string; hint: string }[] = [
    { id: "dark",   label: "Dark",   hint: "the default" },
    { id: "light",  label: "Light",  hint: "" },
    { id: "system", label: "System", hint: `currently ${theme.resolved}` },
  ];
  return (
    <Section title="Appearance" hint="Theme is persisted to localStorage.">
      <div className="flex gap-2">
        {choices.map((c) => (
          <button key={c.id}
                  onClick={() => theme.setChoice(c.id)}
                  className={
                    "px-3 py-1.5 rounded text-[12px] " +
                    (theme.choice === c.id
                      ? "bg-accent text-white font-bold"
                      : "bg-bg-base border border-divider text-ink-primary hover:border-accent")
                  }>
            {c.label}
            {c.hint && (
              <span className={"ml-1.5 text-[10px] " +
                               (theme.choice === c.id ? "text-white/70" : "text-ink-dim")}>
                {c.hint}
              </span>
            )}
          </button>
        ))}
      </div>
    </Section>
  );
}

// ── Visual effects (Dopamine) ─────────────────────────────────────────────

const PREVIEW_EFFECTS: { id: Parameters<typeof playNamed>[0]; label: string;
                         hint: string }[] = [
  { id: "ripple",      label: "Radar sweep",      hint: "scan-start wavefronts" },
  { id: "solarbloom",  label: "Pulse",            hint: "scan-complete bloom" },
  { id: "inkstroke",   label: "Ink stroke",       hint: "auth confirmation" },
  { id: "confetti",    label: "Confetti",         hint: "celebratory burst" },
  { id: "heartburst",  label: "Heart burst",      hint: "warm acknowledgement" },
  { id: "lightning",   label: "Lightning",        hint: "sharp electric arc" },
  { id: "fail",        label: "Fail stamp",       hint: "error / critical" },
  { id: "comic",       label: "Comic impact",     hint: "BAM! / POW!" },
];

const MOODS: { id: DopamineMood; label: string; hint: string }[] = [
  { id: "serene",      label: "Serene",      hint: "quiet, cool" },
  { id: "celebratory", label: "Celebratory", hint: "warm, bright" },
  { id: "electric",    label: "Electric",    hint: "violet, alert (default)" },
];

function EffectsSection() {
  const [settings, setSettings] = useState<DopamineSettings>(() => getDopamineSettings());
  const [activePresetId, setActivePresetId] = useState<string | null>(() => detectPreset(getDopamineSettings()));
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);

  // Keep settings UI in sync if another part of the app changes them.
  useEffect(() => {
    function onChange(e: Event) {
      const next = (e as CustomEvent<DopamineSettings>).detail;
      if (next) {
        setSettings(next);
        setActivePresetId(detectPreset(next));
      }
    }
    window.addEventListener("mhp:dopamine-changed", onChange);
    return () => window.removeEventListener("mhp:dopamine-changed", onChange);
  }, []);

  function patch(p: Partial<DopamineSettings>) {
    const next = setDopamineSettings(p);
    setSettings(next);
    setActivePresetId(detectPreset(next));
  }

  function applyPreset(id: string) {
    const preset = DOPAMINE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const next = setDopamineSettings(preset.patch);
    setSettings(next);
    setActivePresetId(id);
  }

  function reset() {
    const next = resetDopamineSettings();
    setSettings(next);
    setActivePresetId(detectPreset(next));
  }

  async function preview(effect: Parameters<typeof playNamed>[0]) {
    setPreviewBusy(effect);
    try {
      // Preview always fires from the center of the viewport — the preview
      // buttons can be anywhere on the Settings page so anchoring to them
      // pushes the effect off-screen / clipped. Center reads cleanly.
      await playNamed(effect, { x: 0.5, y: 0.5 });
    } finally {
      window.setTimeout(() => setPreviewBusy((p) => p === effect ? null : p), 1500);
    }
  }

  const disabled = !settings.enabled;

  return (
    <Section title="Visual effects"
             hint="Powered by Dopamine. Fires on scan start, scan complete, and auth confirmation. Persists to localStorage.">
      {/* Master toggle */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-divider">
        <div>
          <div className="text-[12px] font-bold text-ink-primary">
            {settings.enabled ? "Effects enabled" : "Effects disabled"}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-dim">
            Master kill-switch. When off, every effect call across the app is a no-op.
            Reduced-motion preference always wins regardless of this setting.
          </div>
        </div>
        <button
          onClick={() => patch({ enabled: !settings.enabled })}
          className={
            "px-3 py-1.5 rounded text-[12px] font-bold transition " +
            (settings.enabled
              ? "bg-accent text-white"
              : "bg-bg-base border border-divider text-ink-primary hover:border-accent")
          }
        >
          {settings.enabled ? "On" : "Off"}
        </button>
      </div>

      {/* Vibe presets */}
      <div className={disabled ? "opacity-40 pointer-events-none" : ""}>
        <div className="text-[11px] uppercase tracking-widest text-ink-dim mb-2">
          Vibe preset
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          {DOPAMINE_PRESETS.map((p) => {
            const isActive = activePresetId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                title={p.hint}
                className={
                  "px-3 py-1.5 rounded text-[12px] transition " +
                  (isActive
                    ? "bg-accent text-white font-bold"
                    : "bg-bg-base border border-divider text-ink-primary hover:border-accent")
                }
              >
                {p.label}
                <span className={"ml-1.5 text-[10px] " +
                                 (isActive ? "text-white/70" : "text-ink-dim")}>
                  {p.hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* Mood picker */}
        <div className="text-[11px] uppercase tracking-widest text-ink-dim mb-2">
          Mood
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          {MOODS.map((m) => {
            const isActive = settings.mood === m.id;
            return (
              <button
                key={m.id}
                onClick={() => patch({ mood: m.id })}
                className={
                  "px-3 py-1.5 rounded text-[12px] transition " +
                  (isActive
                    ? "bg-accent text-white font-bold"
                    : "bg-bg-base border border-divider text-ink-primary hover:border-accent")
                }
              >
                {m.label}
                <span className={"ml-1.5 text-[10px] " +
                                 (isActive ? "text-white/70" : "text-ink-dim")}>
                  {m.hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* Fine-tune sliders */}
        <div className="grid grid-cols-1 gap-4 mb-5">
          <Slider
            label="Intensity"
            hint="Overall energy — higher = bigger, brighter"
            value={settings.intensity}
            onChange={(v) => patch({ intensity: v })}
          />
          <Slider
            label="Whimsy"
            hint="Playfulness — higher = more variation per fire"
            value={settings.whimsy}
            onChange={(v) => patch({ whimsy: v })}
          />
        </div>

        {/* Preview gallery */}
        <div className="text-[11px] uppercase tracking-widest text-ink-dim mb-2">
          Preview
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
          {PREVIEW_EFFECTS.map((e) => (
            <button
              key={e.id}
              onClick={() => void preview(e.id)}
              disabled={previewBusy === e.id}
              title={`Fire ${e.label} from the center of the page`}
              className="text-left p-2.5 rounded bg-bg-base border border-divider
                         hover:border-accent transition group disabled:opacity-50"
            >
              <div className="text-[12px] font-bold text-ink-primary group-hover:text-accent">
                {previewBusy === e.id ? "▶ Firing…" : e.label}
              </div>
              <div className="text-[10px] text-ink-dim mt-0.5">{e.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Reset */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-divider">
        <div className="text-[10px] text-ink-dim">
          Stored at <code className="text-ink-muted">localStorage["mhp:dopamine"]</code>
        </div>
        <button
          onClick={reset}
          className="px-3 py-1.5 rounded bg-bg-base border border-divider
                     text-[11px] text-ink-primary hover:border-accent"
          title={`Reset to enabled · electric · intensity ${DOPAMINE_DEFAULTS.intensity} · whimsy ${DOPAMINE_DEFAULTS.whimsy}`}
        >
          Reset to defaults
        </button>
      </div>
    </Section>
  );
}

function Slider({
  label, hint, value, onChange,
}: { label: string; hint: string; value: number;
     onChange: (v: number) => void }) {
  const pct = Math.round(value * 100);
  return (
    <label className="block">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[11px] uppercase tracking-widest text-ink-muted font-bold">
          {label}
        </span>
        <span className="text-[10px] text-ink-dim">{hint}</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-accent tabular-nums">
          {value.toFixed(2)} · {pct}%
        </span>
      </div>
      <input
        type="range"
        min={0} max={1} step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

/** Return the preset id whose patch exactly matches the current settings, or
 * null if the user has fine-tuned away from any quick-pick. */
function detectPreset(s: DopamineSettings): string | null {
  for (const p of DOPAMINE_PRESETS) {
    const merged: DopamineSettings = { ...DOPAMINE_DEFAULTS, ...p.patch };
    if (merged.enabled !== s.enabled) continue;
    if (!merged.enabled) return p.id;  // "Off" preset only depends on enabled
    if (Math.abs((merged.intensity ?? 0) - s.intensity) > 0.001) continue;
    if (Math.abs((merged.whimsy ?? 0) - s.whimsy) > 0.001) continue;
    return p.id;
  }
  return null;
}

// ── Shared layout helpers ─────────────────────────────────────────────────

function Section({ title, hint, children }: {
  title: string; hint: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-divider bg-bg-card">
      <header className="px-4 py-2.5 border-b border-divider">
        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-muted font-bold">
          {title}
        </div>
        <div className="mt-0.5 text-[11px] text-ink-dim">{hint}</div>
      </header>
      <div className="p-4 relative">{children}</div>
    </section>
  );
}

function Row({ label, value, tone }: {
  label: string; value: string; tone?: string;
}) {
  return (
    <>
      <div className="text-ink-muted">{label}</div>
      <div className={"font-mono text-ink-primary " + (tone ?? "")}>{value}</div>
    </>
  );
}
