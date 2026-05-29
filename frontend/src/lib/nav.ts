// Single source of truth for the sidebar / command-palette nav structure.
// Both `components/Sidebar.tsx` and `components/CommandPalette.tsx` import
// from here so they can't drift out of sync when tools are added.

import type { NavId } from "../components/Sidebar";
import type { PlannedTool } from "./plannedTools";

export type Platform = "darwin" | "linux" | "win32";

// `id` is `NavId` for built-in tools and `planned:<slug>` for user-added stubs.
// We type as `string` here so the static GROUPS below stay type-checked against
// NavId (they're assignment-compatible) while runtime planned ids slot in.
export type NavItem = { id: NavId | string; label: string; platforms?: Platform[] };
export type NavGroup = { section: string; items: NavItem[] };

export const MAC_ONLY:     Platform[] = ["darwin"];
export const LINUX_ONLY:   Platform[] = ["linux"];
export const WINDOWS_ONLY: Platform[] = ["win32"];
// For routers that work on Mac+Linux but the Windows port hasn't landed yet.
export const NOT_WINDOWS:  Platform[] = ["darwin", "linux"];

export const GROUPS: NavGroup[] = [
  {
    section: "ENGAGEMENT",
    items: [
      { id: "engagements", label: "Engagements" },
      { id: "findings",    label: "Findings"    },
    ],
  },
  {
    section: "PLAYBOOKS",
    items: [
      { id: "playbooks", label: "Presets" },
    ],
  },
  {
    section: "DISCOVERY",
    items: [
      { id: "lan",        label: "LAN Scan"        },
      { id: "ip",         label: "IP Checker"      },
      { id: "dns",        label: "DNS Recon"       },
      { id: "whois",      label: "WHOIS · ASN"     },
      { id: "localdisco", label: "Local Discovery" },
      { id: "ping",       label: "Ping"            },
    ],
  },
  {
    section: "RECON",
    items: [
      { id: "ports",       label: "Port Scanner"  },
      { id: "nmap",        label: "Nmap"          },
      { id: "audit",       label: "Network Audit" },
      { id: "tls",         label: "TLS Auditor"   },
      { id: "fingerprint", label: "Fingerprint"   },
      { id: "http",        label: "HTTP Probe"    },
      // Windows needs npcap + windump (separate install) — port pending.
      { id: "tcpdump",     label: "TCPDump",        platforms: NOT_WINDOWS },
    ],
  },
  {
    section: "OSINT",
    items: [
      { id: "ct",       label: "CT Logs"           },
      { id: "email",    label: "Email Sec"         },
      { id: "takeover", label: "Takeover"          },
      { id: "revip",    label: "Reverse IP"        },
      { id: "breach",   label: "Breach Lookup"     },
      { id: "dorking",  label: "Google Dorking"    },
      { id: "ghleak",   label: "GitHub Leak Scan"  },
      { id: "shodanc",  label: "Shodan · Censys"   },
      { id: "people",   label: "People · Email Enum"},
      { id: "profiles", label: "Profile Finder"   },
      { id: "emailharvest", label: "Email Harvest" },
      { id: "wayback",      label: "Wayback URLs"  },
      { id: "urlscan",      label: "URLScan"       },
      { id: "dorksgen",     label: "Dork Generator"},
    ],
  },
  {
    section: "WEB RECON",
    items: [
      { id: "subdom",  label: "Subdomain Enum" },
      { id: "cms",     label: "CMS / Stack"    },
      { id: "jwt",     label: "JWT"            },
      { id: "graphql", label: "GraphQL"        },
    ],
  },
  {
    section: "WEB EXPLOIT",
    items: [
      { id: "xss",  label: "XSS"               },
      { id: "sqli", label: "SQL Injection"     },
      { id: "cmdi", label: "Command Injection" },
      { id: "lfi",  label: "LFI / Path Traversal" },
      { id: "ssrf", label: "SSRF"              },
      { id: "idor", label: "IDOR"              },
    ],
  },
  {
    section: "CLOUD",
    items: [
      { id: "aws",   label: "AWS Recon"        },
      { id: "azure", label: "Azure Recon"      },
      { id: "gcp",   label: "GCP Recon"        },
      { id: "imds",  label: "IMDS Tester"      },
      { id: "s3",    label: "S3 Bucket Scanner"},
    ],
  },
  {
    section: "ACTIVE DIRECTORY",
    items: [
      { id: "ldap",        label: "LDAP Enumerator"        },
      { id: "smb",         label: "SMB Enumerator"         },
      { id: "adspray",     label: "Password Sprayer"       },
      { id: "kerberoast",  label: "Kerberos Roasting"      },
      { id: "bloodhound",  label: "BloodHound Ingestor"    },
      { id: "lateral",     label: "Lateral Movement"       },
    ],
  },
  {
    section: "RED TEAM",
    items: [
      { id: "revshell",   label: "Reverse Shell"     },
      { id: "obfuscator", label: "Payload Obfuscator"},
      { id: "pivot",      label: "Pivoting Helper"   },
      { id: "credhrv",    label: "Credential Harvest"},
      { id: "c2",         label: "C2 Beacon Sim"     },
      { id: "exploits",   label: "Exploits · SearchSploit" },
    ],
  },
  {
    section: "CRYPTO",
    items: [
      { id: "hash", label: "Hash Cracker"  },
      { id: "cvss", label: "CVSS Calculator"},
    ],
  },
  {
    section: "MONITORING",
    items: [
      { id: "ids",           label: "IDS"                                       },
      { id: "audit-log",     label: "Audit Log"                                 },
      { id: "systemd",       label: "Systemd Units",     platforms: LINUX_ONLY },
      { id: "firewallrules", label: "Firewall Rules",    platforms: LINUX_ONLY },
    ],
  },
  {
    section: "FORENSICS",
    items: [
      { id: "persistence",    label: "Persistence"                                },
      { id: "processes",      label: "Processes"                                  },
      { id: "stego",          label: "Steganography"                              },
      { id: "macos",          label: "macOS Posture",    platforms: MAC_ONLY     },
      { id: "linuxposture",   label: "Linux Posture",    platforms: LINUX_ONLY   },
      { id: "windowsposture", label: "Windows Posture",  platforms: WINDOWS_ONLY },
      { id: "usersaudit",     label: "Users Audit",      platforms: LINUX_ONLY   },
    ],
  },
  {
    section: "WIRELESS",
    items: [
      // wifi_scan + evil_twin now have native Windows support (netsh wlan).
      { id: "wifiscan", label: "WiFi Scan"        },
      { id: "eviltwin", label: "Evil Twin Detect" },
      { id: "bt",       label: "Bluetooth Recon",       platforms: NOT_WINDOWS },
      { id: "wpacap",   label: "WPA Handshake / PMKID", platforms: MAC_ONLY    },
    ],
  },
  {
    section: "UTILITIES",
    items: [
      // wifi (Integrity), vpn (WireGuard wg-quick), and tcpdump (libpcap)
      // need OS-specific ports before Windows can use them. Hidden on win32
      // so users don't click into a 501 error toast.
      { id: "wifi", label: "WiFi Integrity", platforms: NOT_WINDOWS },
      { id: "vpn",  label: "VPN Manager",    platforms: NOT_WINDOWS },
      { id: "term", label: "Terminal" },
      { id: "brew", label: "Packages" },
    ],
  },
];

/**
 * Drop items unsupported on the running OS, and tack on a "PLANNED" section at
 * the end built from the user's planned-tools list (from localStorage).
 * `platform === null` means show everything (backend hasn't reported yet).
 */
export function filterGroups(
  platform: Platform | null,
  planned: PlannedTool[] = [],
): NavGroup[] {
  const groups: NavGroup[] = GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (it) => !platform || !it.platforms || it.platforms.includes(platform),
      ),
    }))
    .filter((g) => g.items.length > 0);

  if (planned.length > 0) {
    groups.push({
      section: "PLANNED",
      items: planned.map((t) => ({ id: t.id, label: t.label })),
    });
  }
  return groups;
}
