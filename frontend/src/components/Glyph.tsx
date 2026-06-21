// Operator Glyph Set — single-stroke geometric icons replacing the per-tool
// emoji marks across the app. Each glyph is a 24-grid SVG, 1.6 stroke width,
// round caps, and currentColor-driven so a single declaration handles both
// themes (just swap the wrapping `text-*` Tailwind token).
//
// Three semantic groups carry one colour each:
//   recon   — passive discovery, enumeration, OSINT     → text-phos
//   offense — active attack, payloads, credential abuse → text-danger
//   system  — defense, hardening, host & service state  → text-ink-primary
//
// Usage:
//   <Glyph name="ping" />
//   <Glyph name="nmap" size={18} />
//   <Glyph name="reverse-shell" className="text-danger" />
//
// Also exposes `glyphForEmoji(emoji)` so EmptyState can opportunistically
// swap legacy emoji icons (icon="📡") for the matching glyph without each
// tool page being edited individually.

import type { ReactNode, SVGProps } from "react";

export type GlyphGroup = "recon" | "offense" | "system";

export type GlyphName =
  // recon
  | "ping" | "wifi-scan" | "local-discovery" | "dns-recon" | "whois"
  | "subdomain-enum" | "http-probe" | "shodan" | "dorking" | "dorks-gen"
  | "ct-logs" | "wayback" | "cms-detect" | "github-leak" | "profile-finder"
  | "people-enum" | "email-harvest" | "reverse-ip" | "ip-checker" | "aws-recon"
  | "fingerprint" | "url-scan" | "port-scanner" | "nmap" | "lan-scan"
  | "s3-scanner" | "ldap-enum" | "smb-enum" | "bluetooth" | "wifi-integrity"
  | "graphql" | "stego"
  // offense
  | "c2-beacon" | "kerberos-roast" | "attack-results" | "wpa-capture"
  | "persistence" | "hash-cracker" | "reverse-shell" | "exploits" | "ad-spray"
  | "lateral-movement" | "evil-twin" | "breach-lookup" | "subdomain-takeover"
  | "stego-embed"
  // system
  | "linux-posture" | "macos-posture" | "windows-posture" | "network-audit"
  | "ids" | "tls-auditor" | "email-security" | "firewall-rules"
  | "systemd-units" | "processes" | "tcpdump" | "ai-assistant" | "report";

const GROUP_BY_NAME: Record<GlyphName, GlyphGroup> = {
  ping: "recon", "wifi-scan": "recon", "local-discovery": "recon",
  "dns-recon": "recon", whois: "recon", "subdomain-enum": "recon",
  "http-probe": "recon", shodan: "recon", dorking: "recon",
  "dorks-gen": "recon", "ct-logs": "recon", wayback: "recon",
  "cms-detect": "recon", "github-leak": "recon", "profile-finder": "recon",
  "people-enum": "recon", "email-harvest": "recon", "reverse-ip": "recon",
  "ip-checker": "recon", "aws-recon": "recon", fingerprint: "recon",
  "url-scan": "recon", "port-scanner": "recon", nmap: "recon",
  "lan-scan": "recon", "s3-scanner": "recon", "ldap-enum": "recon",
  "smb-enum": "recon", bluetooth: "recon", "wifi-integrity": "recon",
  graphql: "recon", stego: "recon",

  "c2-beacon": "offense", "kerberos-roast": "offense",
  "attack-results": "offense", "wpa-capture": "offense",
  persistence: "offense", "hash-cracker": "offense",
  "reverse-shell": "offense", exploits: "offense", "ad-spray": "offense",
  "lateral-movement": "offense", "evil-twin": "offense",
  "breach-lookup": "offense", "subdomain-takeover": "offense",
  "stego-embed": "offense",

  "linux-posture": "system", "macos-posture": "system",
  "windows-posture": "system", "network-audit": "system", ids: "system",
  "tls-auditor": "system", "email-security": "system",
  "firewall-rules": "system", "systemd-units": "system",
  processes: "system", tcpdump: "system", "ai-assistant": "system",
  report: "system",
};

// Tailwind class used as the default tint when the caller doesn't override
// with their own `className`. Matches the design spec's per-group colour.
const GROUP_TINT: Record<GlyphGroup, string> = {
  recon:   "text-phos",
  offense: "text-danger",
  system:  "text-ink-primary",
};

export function glyphGroup(name: GlyphName): GlyphGroup {
  return GROUP_BY_NAME[name];
}

// ── Reusable SVG primitives (mirrors the design-canvas helpers) ─────────────

const SVG_PROPS: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function Filled({ cx, cy, r = 1.3 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
}

// ── Glyph paths (ported verbatim from the design-canvas source) ─────────────

const GLYPHS: Record<GlyphName, ReactNode> = {
  // ── RECON & INTEL ────────────────────────────────────────────────────────
  ping: <>
    <Filled cx={12} cy={12} r={1.8} />
    <circle cx={12} cy={12} r={6} />
    <circle cx={12} cy={12} r={10} />
  </>,
  "wifi-scan": <>
    <path d="M5 11.5a10 10 0 0 1 14 0" />
    <path d="M8 14.5a6 6 0 0 1 8 0" />
    <Filled cx={12} cy={17.5} r={1.6} />
  </>,
  "local-discovery": <>
    <circle cx={12} cy={12} r={8.5} />
    <Filled cx={12} cy={12} r={1.5} />
    <line x1={12} y1={12} x2={18.5} y2={7.5} />
  </>,
  "dns-recon": <>
    <rect x={3.5} y={8.5} width={6.5} height={7} rx={1.2} />
    <line x1={4.8} y1={11} x2={9} y2={11} />
    <line x1={4.8} y1={13} x2={7.5} y2={13} />
    <path d="M11 12h7" />
    <path d="M16 9l3 3-3 3" />
  </>,
  whois: <>
    <rect x={3.5} y={6} width={17} height={12} rx={2} />
    <circle cx={8} cy={11} r={2.2} />
    <path d="M5 16a3.2 3.2 0 0 1 6 0" />
    <line x1={13.5} y1={9.5} x2={18} y2={9.5} />
    <line x1={13.5} y1={12.5} x2={18} y2={12.5} />
    <line x1={13.5} y1={15} x2={16} y2={15} />
  </>,
  "subdomain-enum": <>
    <Filled cx={5} cy={12} r={1.8} />
    <circle cx={16.5} cy={6} r={1.8} />
    <circle cx={16.5} cy={12} r={1.8} />
    <circle cx={16.5} cy={18} r={1.8} />
    <path d="M9.5 12c2.5 0 2.5-6 5.2-6" />
    <path d="M9.5 12c2.5 0 2.5 6 5.2 6" />
    <path d="M6.8 12h7.9" />
  </>,
  "http-probe": <>
    <path d="M9 7.5l-4 4.5 4 4.5" />
    <path d="M15 7.5l4 4.5-4 4.5" />
    <line x1={13} y1={6} x2={11} y2={18} />
  </>,
  shodan: <>
    <circle cx={10.5} cy={10.5} r={6} />
    <path d="M4.5 10.5h12" />
    <path d="M10.5 4.5c3 3 3 9 0 12" />
    <path d="M10.5 4.5c-3 3-3 9 0 12" />
    <line x1={15} y1={15} x2={19.5} y2={19.5} />
  </>,
  dorking: <>
    <circle cx={10} cy={10} r={6} />
    <line x1={14.4} y1={14.4} x2={19.5} y2={19.5} />
    <line x1={7.5} y1={9} x2={12.5} y2={9} />
    <line x1={7.5} y1={11.5} x2={11} y2={11.5} />
  </>,
  "dorks-gen": <>
    <circle cx={9.5} cy={10.5} r={5.5} />
    <line x1={13.4} y1={14.4} x2={18} y2={19} />
    <path d="M18 4v4" />
    <path d="M16 6h4" />
  </>,
  "ct-logs": <>
    <rect x={5} y={4} width={14} height={12} rx={1.5} />
    <line x1={8} y1={8} x2={16} y2={8} />
    <line x1={8} y1={11} x2={13} y2={11} />
    <path d="M8.5 16l-1 4 4.5-2.2 4.5 2.2-1-4" />
  </>,
  wayback: <>
    <circle cx={12} cy={12.5} r={7.5} />
    <path d="M12 8.5v4l2.8 1.8" />
    <path d="M4.6 12.5a7.4 7.4 0 0 1 2-5" />
    <path d="M5 5l1.6 2.4 2.4-1.6" />
  </>,
  "cms-detect": <>
    <rect x={4} y={4.5} width={16} height={15} rx={1.5} />
    <line x1={4} y1={9} x2={20} y2={9} />
    <line x1={11.5} y1={9} x2={11.5} y2={19.5} />
  </>,
  "github-leak": <>
    <rect x={5} y={4} width={14} height={11} rx={2} />
    <path d="M9.5 7l-2 2.5 2 2.5" />
    <path d="M14.5 7l2 2.5-2 2.5" />
    <path d="M12 16c0 1.8-2 2-2 3.8a2 2 0 0 0 4 0c0-1.8-2-2-2-3.8" />
  </>,
  "profile-finder": <>
    <circle cx={10} cy={10} r={6} />
    <line x1={14.4} y1={14.4} x2={19.5} y2={19.5} />
    <circle cx={10} cy={8.5} r={1.7} />
    <path d="M7 12.5a3.2 3.2 0 0 1 6 0" />
  </>,
  "people-enum": <>
    <circle cx={8.5} cy={9} r={2.4} />
    <path d="M4.5 17a4 4 0 0 1 8 0" />
    <circle cx={15} cy={8} r={2} />
    <path d="M14 14.6a3.6 3.6 0 0 1 5.5 3.1" />
  </>,
  "email-harvest": <>
    <rect x={4} y={7} width={16} height={10} rx={2} />
    <path d="M4 8.5l8 5 8-5" />
    <path d="M12 18.5v3" />
    <path d="M10 20l2 2 2-2" />
  </>,
  "reverse-ip": <>
    <path d="M6 9.5h11" />
    <path d="M14 6.5l3 3-3 3" />
    <path d="M18 14.5H7" />
    <path d="M10 11.5l-3 3 3 3" />
  </>,
  "ip-checker": <>
    <circle cx={12} cy={12} r={3} />
    <line x1={12} y1={2.5} x2={12} y2={6.5} />
    <line x1={12} y1={17.5} x2={12} y2={21.5} />
    <line x1={2.5} y1={12} x2={6.5} y2={12} />
    <line x1={17.5} y1={12} x2={21.5} y2={12} />
    <Filled cx={12} cy={12} r={1} />
  </>,
  "aws-recon": <>
    <path d="M6.5 14.5h8.5a3 3 0 0 0 .2-6 4 4 0 0 0-7.6-1.2A3.2 3.2 0 0 0 6.5 14.5z" />
    <circle cx={15.5} cy={15.5} r={3} />
    <line x1={17.6} y1={17.6} x2={20} y2={20} />
  </>,
  fingerprint: <>
    <path d="M8 8.5a5 5 0 0 1 8 1.5" />
    <path d="M9 12a3.2 3.2 0 0 1 6 0v2.5" />
    <path d="M12 11.5v4" />
    <path d="M6.5 12a6 6 0 0 1 1.5-4" />
    <path d="M15.6 14.5a8 8 0 0 0 .2-5" />
  </>,
  "url-scan": <>
    <path d="M10 14l4-4" />
    <path d="M9 11l-2 2a2.8 2.8 0 0 0 4 4l2-2" />
    <path d="M15 13l2-2a2.8 2.8 0 0 0-4-4l-2 2" />
  </>,
  "port-scanner": <>
    <rect x={4.5} y={9} width={4} height={6} rx={1} />
    <rect x={10} y={9} width={4} height={6} rx={1} />
    <rect x={15.5} y={9} width={4} height={6} rx={1} />
    <line x1={4.5} y1={6.5} x2={19.5} y2={6.5} />
    <path d="M19.5 6.5l-2-1.5" />
    <path d="M19.5 6.5l-2 1.5" />
  </>,
  nmap: <>
    <rect x={4.5} y={4.5} width={15} height={15} rx={1.5} />
    <line x1={4.5} y1={12} x2={19.5} y2={12} />
    <line x1={12} y1={4.5} x2={12} y2={19.5} />
    <Filled cx={15.5} cy={8.5} r={1.5} />
    <circle cx={15.5} cy={8.5} r={3.2} />
  </>,
  "lan-scan": <>
    <path d="M4.5 11l7.5-6 7.5 6" />
    <path d="M6.5 10v9h11v-9" />
    <Filled cx={9.5} cy={15} r={1.4} />
    <Filled cx={14.5} cy={15} r={1.4} />
    <line x1={9.5} y1={15} x2={14.5} y2={15} />
  </>,
  "s3-scanner": <>
    <path d="M5.5 7.5h13l-1.6 12h-9.8z" />
    <path d="M5.5 7.5c0-1.3 2.9-2.2 6.5-2.2s6.5 .9 6.5 2.2" />
  </>,
  "ldap-enum": <>
    <rect x={4} y={4.5} width={16} height={15} rx={2} />
    <line x1={7.5} y1={4.5} x2={7.5} y2={19.5} />
    <line x1={10.5} y1={8.5} x2={17} y2={8.5} />
    <line x1={10.5} y1={12} x2={17} y2={12} />
    <line x1={10.5} y1={15.5} x2={15} y2={15.5} />
  </>,
  "smb-enum": <>
    <path d="M4 7.5h6l2 2h8v9.5H4z" />
    <Filled cx={8} cy={14} r={1.3} />
    <Filled cx={15} cy={14} r={1.3} />
    <line x1={8} y1={14} x2={15} y2={14} />
  </>,
  bluetooth: <>
    <path d="M9 8l6 8-3 2V4l3 2-6 8" />
  </>,
  "wifi-integrity": <>
    <path d="M5 11.5a10 10 0 0 1 14 0" />
    <path d="M8 14.5a6 6 0 0 1 8 0" />
    <path d="M9.5 17.5l1.8 1.8 3.2-3.2" />
  </>,
  graphql: <>
    <circle cx={12} cy={4.5} r={1.6} />
    <circle cx={18.5} cy={16} r={1.6} />
    <circle cx={5.5} cy={16} r={1.6} />
    <path d="M12 6.1l5.7 8.7" />
    <path d="M12 6.1L6.3 14.8" />
    <path d="M7.1 16h9.8" />
  </>,
  stego: <>
    <rect x={4} y={5} width={16} height={14} rx={2} />
    <path d="M5 16l4.5-4.5 3 3 4-4 3.5 3.5" />
    <circle cx={8.5} cy={9.5} r={1.6} />
    <Filled cx={15} cy={15} r={1} />
  </>,

  // ── OFFENSE & EXPLOIT ────────────────────────────────────────────────────
  "c2-beacon": <>
    <line x1={12} y1={3} x2={12} y2={8} />
    <Filled cx={12} cy={9.5} r={1.6} />
    <path d="M7 13a6 6 0 0 1 10 0" />
    <path d="M4.5 15.5a9.5 9.5 0 0 1 15 0" />
  </>,
  "kerberos-roast": <>
    <circle cx={7.5} cy={13} r={3} />
    <line x1={10.3} y1={12} x2={18} y2={12} />
    <line x1={15.5} y1={12} x2={15.5} y2={15} />
    <line x1={18} y1={12} x2={18} y2={15.5} />
    <path d="M18.6 8.4c1.2 1 1.2 2.6 0 3.6" />
  </>,
  "attack-results": <>
    <circle cx={12} cy={13} r={4} />
    <line x1={12} y1={5} x2={12} y2={9} />
    <line x1={8.5} y1={10.5} x2={6} y2={8.5} />
    <line x1={15.5} y1={10.5} x2={18} y2={8.5} />
    <line x1={8} y1={15.5} x2={5.5} y2={17.5} />
    <line x1={16} y1={15.5} x2={18.5} y2={17.5} />
    <line x1={12} y1={17} x2={12} y2={20} />
  </>,
  "wpa-capture": <>
    <path d="M5 11a10 10 0 0 1 14 0" />
    <path d="M8 14a6 6 0 0 1 8 0" />
    <path d="M12 16.5v4" />
    <path d="M10 18.5l2 2 2-2" />
  </>,
  persistence: <>
    <circle cx={12} cy={5.5} r={2} />
    <line x1={12} y1={7.5} x2={12} y2={19} />
    <line x1={8.5} y1={12} x2={15.5} y2={12} />
    <path d="M5.5 13.5a6.5 6.5 0 0 0 13 0" />
    <line x1={5.5} y1={12} x2={5.5} y2={14} />
    <line x1={18.5} y1={12} x2={18.5} y2={14} />
  </>,
  "hash-cracker": <>
    <line x1={9.5} y1={4.5} x2={7.5} y2={19.5} />
    <line x1={15} y1={4.5} x2={13} y2={19.5} />
    <line x1={5} y1={9.5} x2={18.5} y2={9.5} />
    <line x1={4.5} y1={14.5} x2={18} y2={14.5} />
  </>,
  "reverse-shell": <>
    <rect x={4} y={5} width={16} height={14} rx={2} />
    <line x1={4} y1={9} x2={20} y2={9} />
    <Filled cx={6.6} cy={7} />
    <Filled cx={8.9} cy={7} />
    <path d="M7.5 13l3 2-3 2" />
    <line x1={12.5} y1={15} x2={16} y2={15} />
  </>,
  exploits: <>
    <path d="M12 3.5l1.8 4.5 4.5-1.2-2.6 3.9 2.6 3.9-4.5-1.2L12 17.5l-1.8-4.1-4.5 1.2 2.6-3.9-2.6-3.9 4.5 1.2z" />
  </>,
  "ad-spray": <>
    <path d="M7 5.5c0 1.5-1.6 1.8-1.6 3.3a1.6 1.6 0 0 0 3.2 0c0-1.5-1.6-1.8-1.6-3.3" />
    <path d="M12 4.5c0 1.5-1.6 1.8-1.6 3.3a1.6 1.6 0 0 0 3.2 0c0-1.5-1.6-1.8-1.6-3.3" />
    <path d="M17 5.5c0 1.5-1.6 1.8-1.6 3.3a1.6 1.6 0 0 0 3.2 0c0-1.5-1.6-1.8-1.6-3.3" />
    <line x1={5} y1={17.8} x2={19} y2={17.8} />
    <path d="M9 20.5l3-2.7 3 2.7" />
  </>,
  "lateral-movement": <>
    <Filled cx={5} cy={16} r={1.8} />
    <Filled cx={19} cy={16} r={1.8} />
    <path d="M5.5 16c1.5-9 12.5-9 13 0" />
    <path d="M16 13.5l3.2 2.5-3.2 2.5" />
  </>,
  "evil-twin": <>
    <path d="M3.5 11a9 9 0 0 1 11 0" />
    <path d="M6 14a5.5 5.5 0 0 1 6.5-.8" />
    <Filled cx={9.5} cy={16.5} r={1.4} />
    <path d="M11 12a9 9 0 0 1 9.5-1" />
    <path d="M13.5 14.6a5.5 5.5 0 0 1 5-.6" />
    <Filled cx={16.5} cy={16.5} r={1.4} />
  </>,
  "breach-lookup": <>
    <path d="M12 3.5l7 2.8v5.5c0 4.2-3 7-7 8.2-4-1.2-7-4-7-8.2V6.3z" />
    <path d="M12 7.5l-2 4 3 .8-2 4" />
  </>,
  "subdomain-takeover": <>
    <Filled cx={7} cy={19} r={1.8} />
    <line x1={7} y1={19} x2={7} y2={5} />
    <path d="M7 5.5h8.5l-2 2.8 2 2.8H7" />
  </>,
  "stego-embed": <>
    <rect x={4} y={8} width={16} height={11} rx={2} />
    <path d="M5 17l4-4 3 3 3.5-3.5 3.5 3.5" />
    <path d="M12 2.5v6" />
    <path d="M9.5 6l2.5 2.5 2.5-2.5" />
  </>,

  // ── POSTURE & SYSTEM ─────────────────────────────────────────────────────
  "linux-posture": <>
    <rect x={4} y={5} width={16} height={14} rx={2} />
    <line x1={4} y1={9} x2={20} y2={9} />
    <path d="M7.5 13l3 2-3 2" />
    <line x1={12.5} y1={15} x2={16} y2={15} />
  </>,
  "macos-posture": <>
    <rect x={4} y={5} width={16} height={14} rx={2} />
    <line x1={4} y1={9.5} x2={20} y2={9.5} />
    <Filled cx={7} cy={7.2} r={1} />
    <Filled cx={9.5} cy={7.2} r={1} />
    <Filled cx={12} cy={7.2} r={1} />
  </>,
  "windows-posture": <>
    <rect x={4} y={4.5} width={16} height={15} rx={1.5} />
    <line x1={12} y1={4.5} x2={12} y2={19.5} />
    <line x1={4} y1={12} x2={20} y2={12} />
  </>,
  "network-audit": <>
    <Filled cx={6} cy={6.5} r={1.7} />
    <Filled cx={15} cy={6.5} r={1.7} />
    <Filled cx={6} cy={16} r={1.7} />
    <line x1={7.4} y1={6.5} x2={13.6} y2={6.5} />
    <line x1={6} y1={8.2} x2={6} y2={14.3} />
    <path d="M11 16l2 2 4.5-4.5" />
  </>,
  ids: <>
    <path d="M12 3.5l7 2.8v5.5c0 4.2-3 7-7 8.2-4-1.2-7-4-7-8.2V6.3z" />
    <circle cx={12} cy={11} r={2} />
    <path d="M8.5 11a4 3 0 0 1 7 0" />
  </>,
  "tls-auditor": <>
    <rect x={6} y={11} width={12} height={8.5} rx={2} />
    <path d="M8.5 11V9a3.5 3.5 0 0 1 7 0v2" />
    <path d="M9.5 15l1.6 1.6 3-3" />
  </>,
  "email-security": <>
    <rect x={4} y={6.5} width={13} height={10} rx={1.5} />
    <path d="M4 7.5l6.5 4.5 6.5-4.5" />
    <rect x={14.5} y={13} width={6} height={5.5} rx={1} />
    <path d="M15.8 13v-1.5a1.7 1.7 0 0 1 3.4 0V13" />
  </>,
  "firewall-rules": <>
    <line x1={4.5} y1={9.5} x2={19.5} y2={9.5} />
    <line x1={4.5} y1={14} x2={19.5} y2={14} />
    <line x1={4.5} y1={18.5} x2={19.5} y2={18.5} />
    <line x1={9.5} y1={9.5} x2={9.5} y2={14} />
    <line x1={15} y1={9.5} x2={15} y2={14} />
    <line x1={7} y1={14} x2={7} y2={18.5} />
    <line x1={12.5} y1={14} x2={12.5} y2={18.5} />
    <line x1={17.5} y1={14} x2={17.5} y2={18.5} />
    <path d="M11 8.5c0-2 2-2 1-4 2 1.2 2.4 3.4.4 5" />
  </>,
  "systemd-units": <>
    <rect x={5} y={4.5} width={14} height={4} rx={1} />
    <rect x={5} y={10} width={14} height={4} rx={1} />
    <rect x={5} y={15.5} width={14} height={4} rx={1} />
    <Filled cx={8} cy={6.5} />
    <Filled cx={8} cy={12} />
    <Filled cx={8} cy={17.5} />
  </>,
  processes: <>
    <line x1={4.5} y1={19} x2={19.5} y2={19} />
    <line x1={7} y1={19} x2={7} y2={13} />
    <line x1={11} y1={19} x2={11} y2={7.5} />
    <line x1={15} y1={19} x2={15} y2={11} />
    <line x1={18.5} y1={19} x2={18.5} y2={9} />
  </>,
  tcpdump: <>
    <rect x={5} y={4.5} width={14} height={3.5} rx={1} />
    <rect x={5} y={10} width={14} height={3.5} rx={1} />
    <path d="M12 15v4.5" />
    <path d="M9.5 17.5l2.5 2.5 2.5-2.5" />
  </>,
  "ai-assistant": <>
    <path d="M11 4c.8 3.6 1.6 4.4 5.2 5.2-3.6.8-4.4 1.6-5.2 5.2-.8-3.6-1.6-4.4-5.2-5.2C9.4 8.4 10.2 7.6 11 4z" />
    <path d="M17.5 14.5c.3 1.4.6 1.7 2 2-1.4.3-1.7.6-2 2-.3-1.4-.6-1.7-2-2 1.4-.3 1.7-.6 2-2z" />
  </>,
  // Engagement report — page with a small severity-count bar chart inside.
  // Two short text lines up top stand in for the exec summary; the three
  // ascending bars carry the "findings by severity" idea without crowding
  // the 24-grid.
  report: <>
    <rect x={4} y={4.5} width={16} height={15} rx={1.5} />
    <line x1={7} y1={8} x2={14} y2={8} />
    <line x1={7} y1={10.5} x2={12} y2={10.5} />
    <line x1={7} y1={16} x2={17} y2={16} />
    <line x1={8.5} y1={16} x2={8.5} y2={13.5} />
    <line x1={11.5} y1={16} x2={11.5} y2={12} />
    <line x1={14.5} y1={16} x2={14.5} y2={10.5} />
  </>,
};

// ── Component ───────────────────────────────────────────────────────────────

export type Props = {
  name: GlyphName;
  /** Pixel size — defaults to the design-canvas "ship" size of 18px. */
  size?: number;
  /** Override the per-group default tint. Pass any Tailwind text-* class. */
  className?: string;
  /** Optional aria-label. Defaults to a hyphen-replaced version of `name`. */
  title?: string;
};

export default function Glyph({ name, size = 18, className, title }: Props) {
  const tint = className ?? GROUP_TINT[GROUP_BY_NAME[name]];
  return (
    <svg
      {...SVG_PROPS}
      width={size}
      height={size}
      className={tint}
      role="img"
      aria-label={title ?? name.replace(/-/g, " ")}
    >
      {GLYPHS[name]}
    </svg>
  );
}

// ── Emoji → Glyph mapping (used by EmptyState for opportunistic upgrade) ────
//
// Keys are the emoji strings the tool pages currently pass as `icon` props.
// Where multiple emojis pointed at one concept (e.g. cloud) the glyph chosen
// is the one closest to the dominant call site. Pages keep working unchanged
// — EmptyState detects the emoji and renders the glyph in its place.

export const EMOJI_TO_GLYPH: Partial<Record<string, GlyphName>> = {
  "📡":      "ping",            // also: Ping, WifiScan, LocalDiscovery, C2Beacon
  "🌐":      "whois",           // whois / subdomain / http / shodan
  "🕵":      "stego",
  "🕵️":     "stego",
  "📜":      "ct-logs",         // also wayback
  "🔍":      "dorks-gen",       // also DnsRecon
  "🧩":      "cms-detect",      // also systemd
  "📧":      "email-harvest",
  "🐙":      "github-leak",
  "🐶":      "ldap-enum",       // BloodHound — closest semantic
  "🐧":      "linux-posture",
  "🍏":      "macos-posture",
  "🪟":      "windows-posture",
  "🏠":      "lan-scan",
  "🔌":      "port-scanner",
  "🔎":      "fingerprint",
  "🔭":      "url-scan",
  "🔒":      "tls-auditor",
  "🔐":      "breach-lookup",
  "🔑":      "kerberos-roast",
  "🪲":      "attack-results",
  "🛡":      "network-audit",
  "🛡️":     "network-audit",
  "🛜":      "wpa-capture",
  "🛰":      "nmap",
  "🛰️":     "nmap",
  "🛎":      "ids",
  "🛎️":     "ids",
  "🌙":      "ai-assistant",     // not a perfect fit — overridden where needed
  "🪣":      "s3-scanner",
  "🪤":      "persistence",
  "🪧":      "subdomain-takeover",
  "📤":      "stego-embed",
  "📦":      "tcpdump",
  "📇":      "ldap-enum",
  "🆔":      "hash-cracker",
  "🧬":      "graphql",
  "🧱":      "firewall-rules",
  "👯":      "evil-twin",
  "👥":      "people-enum",
  "🫥":      "stego",
  "☁︎":      "aws-recon",
  "☁":      "aws-recon",
  "⌖":      "ip-checker",
  "🔁":      "reverse-ip",
  "💣":      "reverse-shell",
  "💥":      "exploits",
  "💧":      "ad-spray",
  "🎣":      "reverse-shell",
  "🎯":      "reverse-shell",
  "🐾":      "lateral-movement",
  "🔵":      "bluetooth",
  "🗂":      "smb-enum",
  "🗂️":     "smb-enum",
  "📶":      "wifi-integrity",
  "✉":      "email-harvest",
  "✉️":     "email-harvest",
  "🧑‍💼":   "profile-finder",
};

/**
 * Return the matching Glyph name for a legacy emoji icon, or null if there's
 * no mapping. EmptyState calls this; tool pages keep passing `icon="📡"` and
 * automatically render the glyph instead.
 */
export function glyphForEmoji(s: string): GlyphName | null {
  // Some pages pass with variation selector ("🛡️"), others without ("🛡"). We
  // try the literal first, then strip U+FE0F and retry.
  const direct = EMOJI_TO_GLYPH[s];
  if (direct) return direct;
  const stripped = s.replace(/️/g, "");
  return EMOJI_TO_GLYPH[stripped] ?? null;
}
