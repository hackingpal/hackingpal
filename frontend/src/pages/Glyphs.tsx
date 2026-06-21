// Glyphs — design-canvas mirror of the Operator Glyph Set.
//
// Browse every glyph at display (30px) and ship (18px) size, on both light
// and dark backgrounds. Grouped by category with the spec colours
// (recon=phos / offense=danger / system=ink). This is the in-app picker the
// rest of the UI scaffolding can refer back to when reaching for the right
// glyph on a new tool page.

import Glyph, { type GlyphName, type GlyphGroup } from "../components/Glyph";

type Section = {
  group: GlyphGroup;
  title: string;
  subtitle: string;
  // Spec colours from /Glyph System.dc.html — recon-light/dark, etc.
  lightColor: string;
  darkColor: string;
  items: { name: GlyphName; label: string }[];
};

const SECTIONS: Section[] = [
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

export default function Glyphs() {
  const total = SECTIONS.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="h-full overflow-y-auto p-6 bg-bg-base">
      <header className="mb-6 max-w-4xl">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim font-mono mb-2">
          Icon system · v1
        </div>
        <h1 className="text-2xl font-semibold text-ink-primary tracking-tight">
          Operator Glyph Set
        </h1>
        <p className="mt-2 text-[13px] text-ink-muted max-w-2xl leading-relaxed">
          A single-stroke geometric system replacing the legacy emoji tool
          icons. One semantic colour per glyph — passive recon reads phos,
          active offense reads danger, posture &amp; system stay ink. Each
          shown in light and dark, at display (30px) and ship (18px).
          <br /><br />
          Tool pages still pass emoji strings to <code>EmptyState</code>; the
          component swaps them for the matching glyph automatically.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] font-mono text-ink-muted">
          <LegendDot color="#2c7a52" label="recon & intel" />
          <LegendDot color="#b8513a" label="offense & exploit" />
          <LegendDot color="#33373e" label="posture & system" />
          <span className="flex-1" />
          <span className="text-ink-dim">
            24-grid · 1.6 stroke · round caps · {total} glyphs
          </span>
        </div>
      </header>

      <div className="space-y-8 max-w-6xl">
        {SECTIONS.map((sec) => (
          <Section key={sec.group} section={sec} />
        ))}
      </div>

      <footer className="mt-8 max-w-6xl text-[11px] font-mono text-ink-dim flex justify-between flex-wrap gap-2">
        <span>{total} glyphs · light + dark · 30px display / 18px ship</span>
        <span>currentColor-driven · swap one value per theme</span>
      </footer>
    </div>
  );
}

function Section({ section }: { section: Section }) {
  return (
    <section className="border-t border-divider pt-6">
      <div className="flex items-baseline gap-3 mb-4">
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: section.lightColor }}
        />
        <h2 className="text-base font-semibold text-ink-primary">{section.title}</h2>
        <span className="text-[12px] text-ink-muted">{section.subtitle}</span>
        <span className="flex-1" />
        <span className="text-[11px] font-mono text-ink-dim">
          {String(section.items.length).padStart(2, "0")} glyphs
        </span>
      </div>

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
      >
        {section.items.map((it) => (
          <div key={it.name} className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              {/* Light card */}
              <div
                className="flex-1 flex items-center justify-center gap-3 h-[78px]
                           rounded-md border"
                style={{
                  background: "#f7f5ef",
                  borderColor: "#eae7dd",
                  color: section.lightColor,
                }}
              >
                <Glyph name={it.name} size={30} className="" />
                <Glyph name={it.name} size={18} className="" />
              </div>
              {/* Dark card */}
              <div
                className="flex-1 flex items-center justify-center gap-3 h-[78px]
                           rounded-md border"
                style={{
                  background: "#16181b",
                  borderColor: "#16181b",
                  color: section.darkColor,
                }}
              >
                <Glyph name={it.name} size={30} className="" />
                <Glyph name={it.name} size={18} className="" />
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

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full"
        style={{ background: color }}
      />
      <span>{label}</span>
    </span>
  );
}
