import { useMemo } from "react";

export type NavId =
  | "home" | "targets" | "tools" | "evidence" | "reports" | "report" | "assistant"
  | "workspace" | "playbook-builder"
  | "playbooks" | "labs" | "selfassess"
  | "dashboard" | "engagements" | "findings"
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
  | "wifi" | "term" | "brew" | "settings" | "effects-debug";

import { topNav, type Platform } from "../lib/nav";

type Props = {
  active: NavId | string;
  onSelect: (id: NavId | string) => void;
  platform: Platform | null;
};

// Single-glyph icons per nav id. Drawn inline for crispness and theme
// inheritance — they pick up `currentColor` from the surrounding state.
function NavIcon({ id, className = "" }: { id: string; className?: string }) {
  const common = {
    width: 14, height: 14, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: 1.8,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    className: "shrink-0 " + className,
    "aria-hidden": true,
  };
  switch (id) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 12 12 4l9 8" />
          <path d="M5 10v9h14v-9" />
        </svg>
      );
    case "engagements":
      return (
        <svg {...common}>
          <path d="M5 4h14v6H5z" />
          <path d="M5 14h14v6H5z" />
        </svg>
      );
    case "targets":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="1" />
        </svg>
      );
    case "playbooks":
      return (
        <svg {...common}>
          <path d="M4 6h13a2 2 0 0 1 2 2v11" />
          <path d="M4 6v13h13" />
          <path d="M4 6a2 2 0 0 1 2-2h13" />
        </svg>
      );
    case "labs":
      return (
        <svg {...common}>
          <path d="M9 3v6L5 18a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-4-9V3" />
          <path d="M9 3h6" />
        </svg>
      );
    case "selfassess":
      return (
        <svg {...common}>
          <path d="M12 22s-8-4.5-8-12V5l8-3 8 3v5c0 7.5-8 12-8 12z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "tools":
      return (
        <svg {...common}>
          <path d="m14 6 3-3 4 4-3 3" />
          <path d="m18 10-8 8-6 1 1-6 8-8" />
        </svg>
      );
    case "workspace":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M8 21h8M12 18v3" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-.9a7 7 0 0 0 2 1.2L10 21h4l.5-2.5a7 7 0 0 0 2-1.2l2.4.9 2-3.4-2-1.6c0-.4.1-.8.1-1.2Z" />
        </svg>
      );
    case "effects-debug":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

export default function Sidebar({ active, onSelect, platform }: Props) {
  const items = useMemo(() => topNav(platform), [platform]);

  return (
    <nav
      className="w-60 shrink-0 flex flex-col app-no-drag"
      style={{
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border)",
      }}
    >
      {/* Brand header — text only now (the brand mark moved off this header
          because it kept colliding with the macOS hiddenInset traffic lights
          even at pl-[92px]; the dock icon already carries the brand image).
          - macOS hiddenInset overlays top-left ~80px (traffic lights), so
            we still pt-12 to drop the title clear of them. No left inset
            needed once the icon is gone — the title sits naturally below
            the traffic-light row.
          - Windows reserves the top-right for titleBarOverlay (handled in
            App.tsx top strip).
          - Linux uses the native title bar above us — pt-3 is enough. */}
      <header
        className={
          "app-drag pb-3 px-4 " +
          (platform === "linux" ? "pt-3" : "pt-12")
        }
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <h1
          className="text-[14px] leading-tight"
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
          }}
        >
          HackingPal
        </h1>
        <p
          className="mt-1 text-[10px]"
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            letterSpacing: "0.08em",
          }}
        >
          v0.1 · hybrid build
        </p>
      </header>

      <div className="flex-1 overflow-y-auto py-3 app-no-drag">
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className="w-full text-left flex items-center gap-2.5 relative"
              style={{
                height: 32,
                margin: "1px 8px",
                width: "calc(100% - 16px)",
                padding: "0 12px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "var(--font-sans)",
                background: isActive ? "var(--accent-dim)" : "transparent",
                color: isActive ? "var(--text-accent)" : "var(--text-secondary)",
                borderLeft: isActive
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                transition: "background 150ms ease, color 150ms ease, border-color 150ms ease",
              }}
              onMouseEnter={(e) => {
                if (isActive) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                if (isActive) return;
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <NavIcon
                id={item.id as string}
                className=""
                /* color matches the text via currentColor */
              />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      <footer
        className="px-4 py-2 text-[10px] flex items-center gap-2"
        style={{
          borderTop: "1px solid var(--border)",
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
        }}
      >
        <span>Python · React</span>
        <span className="ml-auto flex items-center gap-2">
          {/* Opens in the system browser via Electron's
              window.open-handoff (electron/main.cjs intercepts http(s)
              targets and shells out to the OS default browser). */}
          <a
            href="https://github.com/hackingpal/hackingpal/issues/new"
            target="_blank"
            rel="noreferrer"
            title="Report a bug on GitHub"
            style={{ color: "var(--text-muted)" }}
            className="hover:!text-[color:var(--text-primary)] transition"
          >
            Report bug ↗
          </a>
        </span>
      </footer>
    </nav>
  );
}
