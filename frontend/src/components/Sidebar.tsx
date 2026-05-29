import { useEffect, useMemo, useState } from "react";

// MyHackingPal brand mark — 7 Apple-rainbow bars on a black square.
// Rendered inline so it scales crisply at any DPR.
function BrandMark() {
  const COLORS = ["#61BC47", "#FDB813", "#F58220", "#E03C31", "#963D97", "#2966C6", "#039CDE"];
  const SIZE = 28;
  const PAD_Y = SIZE * 0.16;
  const PAD_X = SIZE * 0.10;
  const usable = SIZE - 2 * PAD_Y;
  // 7 bars + 6 gaps where gap = 0.6 × bar  →  7B + 3.6B = usable
  const bar = usable / 10.6;
  const gap = bar * 0.6;
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-label="MyHackingPal"
         className="shrink-0 rounded-sm">
      <rect width={SIZE} height={SIZE} fill="black" />
      {COLORS.map((c, i) => (
        <rect key={c} x={PAD_X} y={PAD_Y + i * (bar + gap)}
              width={SIZE - 2 * PAD_X} height={bar} fill={c} />
      ))}
    </svg>
  );
}

export type NavId =
  | "playbooks"
  | "engagements" | "findings"
  | "lan" | "ip" | "ping" | "dns" | "whois" | "localdisco"
  | "ports" | "nmap" | "audit" | "tcpdump" | "tls" | "fingerprint" | "http"
  | "ct" | "email" | "takeover" | "revip" | "breach"
  | "dorking" | "ghleak" | "shodanc" | "people" | "profiles"
  | "wayback" | "urlscan" | "emailharvest" | "dorksgen"
  | "exploits"
  | "cms" | "jwt" | "graphql" | "subdom"
  | "xss" | "sqli" | "cmdi" | "lfi" | "ssrf" | "idor"
  | "imds" | "s3" | "aws" | "azure" | "gcp"
  | "ldap" | "smb" | "adspray" | "kerberoast" | "bloodhound" | "lateral"
  | "wifiscan" | "eviltwin" | "bt" | "wpacap"
  | "revshell" | "obfuscator" | "pivot" | "credhrv" | "c2"
  | "hash" | "cvss"
  | "ids" | "audit-log" | "persistence" | "processes" | "stego" | "macos" | "linuxposture" | "windowsposture"
  | "systemd" | "firewallrules" | "usersaudit"
  | "wifi" | "vpn" | "term" | "brew";

import { filterGroups, type Platform } from "../lib/nav";
import { usePlannedTools } from "../lib/plannedTools";

type Props = {
  active: NavId | string;
  onSelect: (id: NavId | string) => void;
  platform: Platform | null;   // null = backend hasn't told us yet → show everything
};

const COLLAPSED_KEY = "sidebar:collapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    /* quota — ignore */
  }
}

export default function Sidebar({ active, onSelect, platform }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());
  const planned = usePlannedTools();

  // Filter out items whose platforms list excludes the running OS. When the
  // backend hasn't reported its platform yet, show everything (Mac-default).
  // Planned-tool entries are appended as a PLANNED section.
  const groups = useMemo(
    () => filterGroups(platform, planned),
    [platform, planned],
  );

  // Figure out which section holds the active item — that one is force-expanded
  // so you never lose context after switching pages.
  const activeSection = useMemo(
    () => groups.find((g) => g.items.some((i) => i.id === active))?.section,
    [active, groups],
  );

  useEffect(() => {
    if (!activeSection) return;
    if (collapsed.has(activeSection)) {
      const next = new Set(collapsed);
      next.delete(activeSection);
      setCollapsed(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  useEffect(() => { saveCollapsed(collapsed); }, [collapsed]);

  function toggle(section: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section); else next.add(section);
      return next;
    });
  }

  return (
    <nav className="w-60 shrink-0 border-r border-divider bg-bg-sidebar flex flex-col">
      {/* Top inset — on macOS (hiddenInset) and Windows (hidden+overlay) the
          OS title bar is gone, so we need pt-10 to fully clear the overlaid
          window controls (traffic lights sit ~28px tall, so pt-7 left them
          visually touching the brand mark). On Linux the native title bar is
          still visible above us so pt-2 is enough. `platform` is null on
          first paint; default to the taller inset to avoid a layout jump. */}
      <header className={
        "app-drag pb-3 px-4 border-b border-divider bg-bg-sidebar " +
        (platform === "linux" ? "pt-2" : "pt-10")
      }>
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <h1 className="text-[13px] font-bold tracking-[0.08em] text-ink-primary leading-tight">
            MyHackingPal
          </h1>
        </div>
        <p className="text-[10px] text-ink-dim mt-1 tracking-wider">
          v0.1 · hybrid build
        </p>
      </header>

      <div className="flex-1 overflow-y-auto py-3 app-no-drag">
        {groups.map((g, i) => {
          const isCollapsed = collapsed.has(g.section);
          const activeCount = g.items.filter((it) => it.id === active).length;
          return (
            <section key={g.section} className={i > 0 ? "mt-4" : ""}>
              <button
                onClick={() => toggle(g.section)}
                aria-expanded={!isCollapsed}
                className="w-full px-4 py-1.5 flex items-center gap-2
                           text-[12px] font-bold tracking-[0.14em] text-ink-muted
                           hover:text-ink-primary transition group"
              >
                <span className={"text-[10px] inline-block w-2.5 transition-transform " +
                                 (isCollapsed ? "" : "rotate-90")}>
                  ▶
                </span>
                <span>{g.section}</span>
                {isCollapsed && activeCount > 0 && (
                  <span className="ml-1 w-1.5 h-1.5 rounded-full bg-accent" />
                )}
                <span className="flex-1 text-right opacity-0 group-hover:opacity-100
                                 text-ink-dim font-normal tracking-normal">
                  {g.items.length}
                </span>
              </button>

              {!isCollapsed && g.items.map((item) => {
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className={
                      "w-full text-left text-sm pl-5 pr-3 py-2 transition flex items-center " +
                      (isActive
                        ? "bg-bg-nav-active text-accent font-semibold border-l-2 border-accent -ml-px"
                        : "text-ink-primary font-medium hover:bg-bg-nav-hover border-l-2 border-transparent")
                    }
                  >
                    <span className={(isActive ? "text-accent" : "text-ink-dim") + " mr-2 w-2 inline-block"}>
                      {isActive ? "▸" : ""}
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>

      <footer className="px-4 py-2 text-[10px] text-ink-dim border-t border-divider flex items-center gap-2">
        <span>Python · React</span>
      </footer>
    </nav>
  );
}
