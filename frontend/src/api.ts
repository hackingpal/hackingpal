/**
 * Tiny fetch wrapper for the Python backend.
 *
 * In dev (Vite or Electron-dev) the backend runs on a fixed loopback port.
 * Electron in production will spawn the sidecar on the same port — see
 * electron/main.cjs.
 */

import { record } from "./lib/sessionLog";

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL ?? "http://127.0.0.1:8765";

export { BACKEND_URL };

/**
 * Normalize a FastAPI `detail` field into a human-readable string.
 *
 * - Strings pass through.
 * - Arrays are validation errors (HTTP 422) — each entry is
 *   `{type, loc, msg, input}`; we join the locs and msgs.
 * - Objects expose `reason`/`message`/`error` for our 409 confirm flows;
 *   anything else falls back to a JSON dump so the user at least sees something.
 */
export function formatDetail(d: unknown): string {
  if (d == null || d === "") return "";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((e: any) => {
        if (typeof e === "string") return e;
        if (e && typeof e === "object" && typeof e.msg === "string") {
          const loc = Array.isArray(e.loc) ? e.loc.slice(1).join(".") : "";
          return loc ? `${loc}: ${e.msg}` : e.msg;
        }
        return JSON.stringify(e);
      })
      .join("; ");
  }
  if (typeof d === "object") {
    const o = d as Record<string, unknown>;
    if (typeof o.reason  === "string") return o.reason;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error   === "string") return o.error;
    return JSON.stringify(d);
  }
  return String(d);
}

/** Pull a useful error message from a non-ok Response. Never throws. */
export async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const msg = formatDetail((body as any)?.detail);
    return msg || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// Paths that should NOT enter the chat's session log — noisy or self-referential.
const LOG_SKIP = [
  /^\/health/, /^\/chat\//, /^\/settings\//, /^\/system\//,
  /^\/engagements/,
];

// Per-launch auth token. The backend issues this on GET /auth/token (loopback
// only, no header required). We fetch it lazily on first api() call and reuse
// the same promise so concurrent calls don't trigger duplicate fetches.
// Privileged endpoints (terminal/exec, *_install, vpn/{start,stop}) require it
// via the X-MHP-Token header; harmless endpoints just ignore it.
let authTokenPromise: Promise<string | null> | null = null;

function fetchAuthToken(): Promise<string | null> {
  if (authTokenPromise) return authTokenPromise;
  authTokenPromise = fetch(`${BACKEND_URL}/auth/token`)
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => (b && typeof b.token === "string" ? b.token : null))
    .catch(() => null);
  return authTokenPromise;
}

/** Clears the cached token. Call if the backend is restarted mid-session. */
export function resetAuthToken(): void {
  authTokenPromise = null;
}

async function withAuthHeader(init?: RequestInit): Promise<RequestInit> {
  const token = await fetchAuthToken();
  if (!token) return init ?? {};
  const headers = new Headers(init?.headers);
  if (!headers.has("X-MHP-Token")) headers.set("X-MHP-Token", token);
  return { ...(init ?? {}), headers };
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Skip the auth fetch when we're already fetching /auth/token, otherwise
  // we'd recurse forever.
  const finalInit = path === "/auth/token" ? init : await withAuthHeader(init);
  const res = await fetch(`${BACKEND_URL}${path}`, finalInit);
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const body = (await res.json()) as T;
  if (!LOG_SKIP.some((re) => re.test(path))) {
    record(path, body);
    // Best-effort: also pin the result to the active engagement, if any.
    // Imported lazily to avoid a circular dep with lib/engagement.ts.
    import("./lib/engagement").then(({ recordResultIfActive }) => {
      void recordResultIfActive(path, "", path, body);
    }).catch(() => {});
  }
  return body;
}

// ── Chat / Settings ──────────────────────────────────────────────────────────

export type ApiKeyStatus = { present: boolean; last4?: string };

export const fetchApiKeyStatus = () =>
  api<ApiKeyStatus>("/settings/api-key/status");

export const setApiKey = (api_key: string) =>
  api<ApiKeyStatus>("/settings/api-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key }),
  });

export const deleteApiKey = () =>
  api<ApiKeyStatus>("/settings/api-key", { method: "DELETE" });

export const fetchChatConfig = () =>
  api<{ key_present: boolean; model: string }>("/chat/config");

export type DnsblEntry = { name: string; status: string; listed: boolean };

export type IpReport = {
  input: string;
  ip: string;
  ip_class: string;
  is_internal: boolean;
  reverse_dns: string;
  country: string | null;
  org: string | null;
  hosting: string | null;
  geo_error: string | null;
  dnsbl: DnsblEntry[];
  abuse_contact: string[];
  verdict_severity: "clean" | "info" | "warn" | "high";
  verdict_text: string;
};

export const fetchIpReport = (target: string) =>
  api<IpReport>(`/ip/${encodeURIComponent(target)}`);

export type IpBulkResult = {
  target: string;
  ok: boolean;
  report: IpReport | null;
  error: string | null;
};

export type IpBulkResponse = { results: IpBulkResult[] };

export const fetchIpBulk = (targets: string[]) =>
  api<IpBulkResponse>("/ip/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targets }),
  });

// ── DNS Recon ─────────────────────────────────────────────────────────────────

export type DnsFinding = {
  severity: "info" | "warn" | "high";
  label: string;
  detail: string;
};

export type DnsAxfr = {
  ns: string;
  succeeded: boolean;
  record_count: number;
  sample: string;
};

export type DnsReport = {
  domain: string;
  records: {
    A: string[]; AAAA: string[]; MX: string[]; NS: string[];
    TXT: string[]; CAA: string[]; SOA: string[];
  };
  reverse_dns: { ip: string; ptr: string }[];
  dnssec: { signed: boolean; dnskey_count: number; ds_count: number };
  zone_transfer: DnsAxfr[];
  findings: DnsFinding[];
};

export type DnsPolicy = {
  target: string;
  verdict: "allow" | "warn" | "deny";
  reason: string;
};

export async function fetchDnsRecon(
  domain: string,
  confirm: boolean,
): Promise<DnsReport | { needConfirm: true; reason: string }> {
  const url = `/dns/recon/${encodeURIComponent(domain)}${confirm ? "?confirm=true" : ""}`;
  const res = await fetch(`${BACKEND_URL}${url}`);
  if (res.status === 409) {
    const body = await res.json();
    const d = body.detail ?? {};
    return { needConfirm: true, reason: d.reason ?? "confirmation required" };
  }
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json() as Promise<DnsReport>;
}

export const fetchDnsPolicy = (target: string) =>
  api<DnsPolicy>(`/dns/policy/${encodeURIComponent(target)}`);

export type DnsReconInit = {
  domain: string;
  wordlist?: "small" | "medium";
  confirm?: boolean;
};

export type DnsReconEvent =
  | { type: "started";  domain: string; ns: string[]; wordlist_size: number }
  | { type: "hit";      subdomain: string; ip: string }
  | { type: "progress"; done: number; total: number; found: number }
  | { type: "done";     elapsed: number; found: number; stopped: boolean }
  | { type: "error";    detail: string; need_confirm?: boolean };

// ── WHOIS / ASN ───────────────────────────────────────────────────────────────

export type WhoisFinding = {
  severity: "info" | "warn" | "high";
  label: string;
  detail: string;
};

export type WhoisAsn = {
  number?: string;
  prefix?: string;
  country?: string;
  registry?: string;
  allocated?: string;
  name?: string;
};

export type WhoisDomain = {
  registrar?: string;
  registrant?: string;
  created?: string;
  updated?: string;
  expires?: string;
  nameservers?: string[];
  status?: string[];
};

export type WhoisNetwork = {
  netrange?: string;
  cidr?: string;
  org?: string;
  country?: string;
};

export type WhoisReport = {
  target: string;
  target_type: "ip" | "cidr" | "domain";
  resolved_ip: string | null;
  asn: WhoisAsn;
  domain: WhoisDomain;
  network: WhoisNetwork;
  findings: WhoisFinding[];
  policy: { verdict: "allow" | "warn" | "deny"; reason: string };
  raw: string;
};

export const fetchWhois = (target: string) =>
  api<WhoisReport>(`/whois/${encodeURIComponent(target)}`);

// ── TLS Auditor ───────────────────────────────────────────────────────────────

export type TlsFinding = {
  severity: "info" | "warn" | "high";
  label: string;
  detail: string;
};

export type TlsCert = {
  subject?: string;
  issuer?: string;
  sans?: string[];
  not_before?: string;
  not_after?: string;
  days_until_expiry?: number;
  sha256?: string;
  key_type?: string;
  key_bits?: number;
  signature_algorithm?: string;
  self_signed?: boolean;
  hostname_matches?: boolean;
};

export type TlsProtocolState = "supported" | "unsupported" | "not_tested";

export type TlsReport = {
  host: string;
  port: number;
  ip: string;
  cert: TlsCert;
  chain: { subject: string; issuer: string }[];
  protocols: Record<string, TlsProtocolState>;
  negotiated_cipher: { name: string; protocol: string; bits: number } | null;
  hsts: {
    present: boolean; max_age: number;
    include_subdomains: boolean; preload: boolean;
  };
  http_redirect_to_https: boolean | null;
  findings: TlsFinding[];
  policy: { verdict: "allow" | "warn" | "deny"; reason: string };
};

export const fetchTlsAudit = (host: string, port = 443) =>
  api<TlsReport>(`/tls/audit/${encodeURIComponent(host)}?port=${port}`);

// ── Service Fingerprinter ─────────────────────────────────────────────────────

export type FingerprintResult = {
  host: string;
  port: number;
  ip: string;
  open: boolean;
  service_guess: string;
  version: string;
  banner_lines: string[];
  extras: Record<string, unknown>;
  elapsed_ms: number;
  error: string | null;
};

export const fetchFingerprint = (host: string, port: number) =>
  api<FingerprintResult & { policy: { verdict: string; reason: string } }>(
    `/fingerprint/${encodeURIComponent(host)}/${port}`,
  );

export const fetchFingerprintBulk = (host: string, ports: number[]) =>
  api<{
    host: string;
    results: FingerprintResult[];
    policy: { verdict: string; reason: string };
  }>("/fingerprint/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, ports }),
  });

// ── HTTP Probe ────────────────────────────────────────────────────────────────

export type HttpProbeInit = {
  url: string;
  wordlist?: "small" | "medium";
  max_concurrency?: number;
  confirm?: boolean;
};

export type HttpProbeFinding = {
  severity: "info" | "warn" | "high";
  label: string;
  detail: string;
};

export type HttpProbeEvent =
  | {
      type: "started"; base: string; host: string; scheme: string;
      methods_allowed: string[]; wordlist_size: number;
      headers: Record<string, string>;
    }
  | { type: "finding";  severity: "info" | "warn" | "high"; label: string; detail: string }
  | { type: "hit";      path: string; status: number; length: number; location: string }
  | { type: "progress"; done: number; total: number; hits: number }
  | { type: "done";     elapsed: number; hits: number; stopped: boolean }
  | { type: "error";    detail: string; need_confirm?: boolean };

// ── CT log search ─────────────────────────────────────────────────────────────

export type CtFinding = { severity: "info" | "warn" | "high"; label: string; detail: string };
export type CtRecentCert = { name: string; issuer: string; not_before: string; not_after: string };
export type CtReport = {
  domain: string;
  total_records: number;
  subdomains: string[];
  wildcard_subdomains: string[];
  recent_certs: CtRecentCert[];
  recent_7d_count: number;
  elapsed_seconds: number;
  throttled?: boolean;
  findings: CtFinding[];
  policy: { verdict: string; reason: string };
};

export async function fetchCtSearch(
  domain: string,
  confirm: boolean,
): Promise<CtReport | { needConfirm: true; reason: string }> {
  const url = `/ct/search/${encodeURIComponent(domain)}${confirm ? "?confirm=true" : ""}`;
  const res = await fetch(`${BACKEND_URL}${url}`);
  if (res.status === 409) {
    const body = await res.json();
    return { needConfirm: true, reason: body.detail?.reason ?? "confirmation required" };
  }
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json() as Promise<CtReport>;
}

// ── Email security ────────────────────────────────────────────────────────────

export type EmailFinding = { severity: "info" | "warn" | "high"; label: string; detail: string };
export type EmailReport = {
  domain: string;
  spf:     { present: boolean; raw: string; mechanisms: string[]; all_qualifier: string };
  dmarc:   { present: boolean; raw: string; tags: Record<string, string> };
  mta_sts: { present: boolean; raw: string; tags?: Record<string, string> };
  bimi:    { present: boolean; raw: string; tags?: Record<string, string> };
  dkim:    {
    selectors_found: string[]; raw: Record<string, string>;
    wildcard?: boolean; wildcard_record?: string;
  };
  findings: EmailFinding[];
  elapsed_seconds: number;
  policy: { verdict: string; reason: string };
};

export async function fetchEmailAudit(
  domain: string, confirm: boolean,
): Promise<EmailReport | { needConfirm: true; reason: string }> {
  const url = `/email/audit/${encodeURIComponent(domain)}${confirm ? "?confirm=true" : ""}`;
  const res = await fetch(`${BACKEND_URL}${url}`);
  if (res.status === 409) {
    const body = await res.json();
    return { needConfirm: true, reason: body.detail?.reason ?? "confirmation required" };
  }
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json() as Promise<EmailReport>;
}

// ── Subdomain takeover ────────────────────────────────────────────────────────

export type TakeoverVerdict =
  | "vulnerable" | "dangling" | "matched" | "no_cname" | "clean";

export type TakeoverResult = {
  fqdn: string;
  cname_chain: string[];
  service: string;
  signature_matched: boolean;
  verdict: TakeoverVerdict;
  evidence: string;
};

export async function fetchTakeoverCheck(
  fqdn: string, confirm: boolean,
): Promise<TakeoverResult | { needConfirm: true; reason: string }> {
  const url = `/takeover/check/${encodeURIComponent(fqdn)}${confirm ? "?confirm=true" : ""}`;
  const res = await fetch(`${BACKEND_URL}${url}`);
  if (res.status === 409) {
    const body = await res.json();
    return { needConfirm: true, reason: body.detail?.reason ?? "confirmation required" };
  }
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json() as Promise<TakeoverResult>;
}

export type TakeoverScanInit = { subdomains: string[]; confirm?: boolean };
export type TakeoverEvent =
  | { type: "started";  count: number }
  | ({ type: "result" } & TakeoverResult)
  | { type: "progress"; done: number; total: number; hits: number }
  | { type: "done";     elapsed: number; hits: number; stopped: boolean }
  | { type: "error";    detail: string; need_confirm?: boolean };

// ── Reverse IP ────────────────────────────────────────────────────────────────

export type ReverseIpReport = {
  target: string;
  ip: string;
  domains: string[];
  count: number;
  rate_limited: boolean;
  raw_first_line: string;
  elapsed_seconds: number;
  findings: { severity: "info" | "warn" | "high"; label: string; detail: string }[];
  policy: { verdict: string; reason: string };
};

export async function fetchReverseIp(
  target: string, confirm: boolean,
): Promise<ReverseIpReport | { needConfirm: true; reason: string }> {
  const url = `/reverse-ip/${encodeURIComponent(target)}${confirm ? "?confirm=true" : ""}`;
  const res = await fetch(`${BACKEND_URL}${url}`);
  if (res.status === 409) {
    const body = await res.json();
    return { needConfirm: true, reason: body.detail?.reason ?? "confirmation required" };
  }
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json() as Promise<ReverseIpReport>;
}

// ── WebSocket URL helper ──────────────────────────────────────────────────────

const WS_URL = BACKEND_URL.replace(/^http/, "ws");

export function openWs(path: string): WebSocket {
  return new WebSocket(`${WS_URL}${path}`);
}

// ── Port scanner event types ──────────────────────────────────────────────────

export type ScanInit = {
  target: string;
  ports: string;          // "1-1024" / "80,443,8080-8090"
  timeout?: number;
  threads?: number;
};

export type ScanEvent =
  | { type: "started";  target: string; ip: string; total: number;
      threads: number; timeout: number }
  | { type: "open";     port: number; service: string; banner: string }
  | { type: "progress"; done: number; total: number }
  | { type: "done";     elapsed: number; open_count: number; stopped: boolean }
  | { type: "error";    detail: string };

// ── Nmap ──────────────────────────────────────────────────────────────────────

export type NmapStatus = {
  available: boolean;
  binary: string;
  version: string;
  scripts_dir: string;
  scripts_count: number;
  passwordless: boolean;
  sudoers_path: string;
  user: string;
};

export type NmapScriptEntry = {
  name: string;
  filename?: string;
  categories: string[];
};

export type NmapScriptsList = {
  count: number;
  scripts: NmapScriptEntry[];
  categories: [string, number][];
};

export type NmapPolicy = {
  target: string;
  verdict: "allow" | "warn" | "deny";
  reason: string;
};

export const fetchNmapStatus = () => api<NmapStatus>("/nmap/status");
export const installNmapSudo = () =>
  api<{ installed: boolean; already?: boolean }>("/nmap/install", { method: "POST" });
export const fetchNmapScripts = () => api<NmapScriptsList>("/nmap/scripts");
export const fetchNmapScriptHelp = (name: string) =>
  api<{ name: string; help: string }>(
    `/nmap/script-help?name=${encodeURIComponent(name)}`,
  );

export type NmapOptions = {
  targets: string[];
  exclude?: string[];

  skip_discovery?: boolean;       // -Pn
  ping_only?: boolean;            // -sn
  no_dns?: boolean;               // -n (default true)
  force_dns?: boolean;            // -R
  traceroute?: boolean;
  discovery_probes?: string[];    // e.g. ["PS22,80","PE"]

  scan_type?: "syn" | "connect" | "udp" | "null" | "fin" | "xmas"
            | "ack" | "window" | "maimon" | "sctp_init" | "sctp_cookie" | "ip";
  port_spec?: string;             // "22,80" / "1-1024" / "U:53,T:80"
  top_ports?: number;
  fast_mode?: boolean;            // -F
  all_ports?: boolean;            // -p-
  exclude_ports?: string;

  service_version?: boolean;
  version_intensity?: number;
  version_light?: boolean;
  version_all?: boolean;

  os_detect?: boolean;
  osscan_limit?: boolean;
  osscan_guess?: boolean;

  timing_template?: number;       // 0..5
  min_rate?: number;
  max_rate?: number;
  host_timeout?: string;
  max_retries?: number;

  nse_categories?: string[];
  nse_scripts?: string[];
  nse_args?: string;

  fragment?: boolean;
  mtu?: number;
  decoys?: string;
  spoof_ip?: string;
  source_port?: number;
  spoof_mac?: string;
  badsum?: boolean;
  data_length?: number;

  verbose?: number;
  debug?: number;
  show_reason?: boolean;
  open_only?: boolean;
  packet_trace?: boolean;
  disable_arp_ping?: boolean;

  use_sudo?: boolean;
  extra_args?: string;
};

export type NmapPortResult = {
  port: number;
  proto: string;
  state: string;
  reason: string;
  service: string;
  product: string;
  version: string;
  extra_info: string;
  tunnel: string;
  cpe: string[];
  scripts: { id: string; output: string }[];
};

export type NmapHostResult = {
  ip: string;
  mac: string;
  vendor: string;
  hostnames: string[];
  state: string;
  reason: string;
  rtt: string;
  ports: NmapPortResult[];
  os_guesses: { name: string; accuracy: number }[];
  host_scripts: { id: string; output: string }[];
};

export type NmapReport = {
  args: string;
  version: string;
  scaninfo: { type?: string; protocol?: string; numservices?: string };
  elapsed: number;
  summary: string;
  hosts_up: number;
  hosts_down: number;
  hosts_total: number;
  hosts: NmapHostResult[];
};

export type NmapEvent =
  | { type: "policy";   verdicts: NmapPolicy[] }
  | { type: "started";  cmd: string; argv: string[]; xml_path: string }
  | { type: "line";     text: string }
  | { type: "progress"; pct?: number; hosts_done?: number; hosts_up?: number }
  | { type: "stderr";   text: string }
  | { type: "done";     rc: number; stopped: boolean; report: NmapReport | null }
  | { type: "error";    detail: string; need_confirm?: boolean };

// ── LAN scan event types ──────────────────────────────────────────────────────

export type LanInfo = {
  local_ip: string;
  network_base: string;
  prefix: number;
  network: string;
  total_hosts: number;
};

export const fetchLanInfo = () => api<LanInfo>("/lan/info");

export type LanInit = { network?: string };

export type LanEvent =
  | { type: "started";  local_ip: string; network: string; total_hosts: number }
  | { type: "host";     ip: string; hostname: string; mac: string; is_self: boolean }
  | { type: "mac_update"; ip: string; mac: string }
  | { type: "progress"; done: number; total: number; found: number }
  | { type: "done";     elapsed: number; found: number; stopped: boolean }
  | { type: "error";    detail: string };

// ── Network Audit event types ─────────────────────────────────────────────────

export type RiskTier = "clean" | "low" | "medium" | "high" | "critical";

export type AuditOpenPort = { port: number; service: string; risk: RiskTier };

export type AuditEvent =
  | { type: "started";  local_ip: string; network: string; total_hosts: number }
  | { type: "phase";    phase: "discovery" | "audit" }
  | { type: "progress"; pct: number; label: string }
  | { type: "host";     ip: string; hostname: string; is_self: boolean;
      open_risky: AuditOpenPort[]; risk_level: RiskTier }
  | { type: "done";     elapsed: number; hosts_audited: number; stopped: boolean }
  | { type: "error";    detail: string };

// ── IDS event types ───────────────────────────────────────────────────────────

export type IdsSeverity = "info" | "warn" | "high";
export type IdsSource   = "ports" | "auth";

export type IdsRecord = {
  ts: string; iso: string;
  source: IdsSource;
  severity: IdsSeverity;
  title: string; detail: string;
};

export type IdsEvent =
  | { type: "started"; baseline: number; unknown: number }
  | ({ type: "event" } & IdsRecord)
  | { type: "stopped" }
  | { type: "error"; detail: string };

// ── Ping ──────────────────────────────────────────────────────────────────────

export type PingEvent =
  | { type: "started"; target: string; cmd: string }
  | { type: "line";    text: string }
  | { type: "done";    stopped: boolean }
  | { type: "error";   detail: string };

// ── TCPDump ───────────────────────────────────────────────────────────────────

export type TcpdumpStatus = {
  passwordless: boolean;
  sudoers_path: string;
  user: string;
};

export const fetchTcpdumpStatus     = () => api<TcpdumpStatus>("/tcpdump/status");
export const fetchTcpdumpInterfaces = () => api<{ interfaces: string[] }>("/tcpdump/interfaces");

export const installTcpdumpSudoers = () =>
  api<{ installed: boolean; already?: boolean }>("/tcpdump/install", { method: "POST" });

export type TcpdumpEvent =
  | { type: "started"; iface: string; cmd: string }
  | { type: "line";    text: string }
  | { type: "stopped"; captured: number }
  | { type: "error";   detail: string };

// ── Reverse Shell ─────────────────────────────────────────────────────────────

export type BindInterface = { name: string; addr: string };
export type RevListener = {
  id: string;
  host: string;
  port: number;
  auto_upgrade: boolean;
  created_at: number;
  sessions: number;
};
export type RevSession = {
  id: string;
  listener_id: string;
  remote: string;
  connected_at: number;
  bytes_in: number;
  bytes_out: number;
  upgraded: boolean;
  transcript: string;
  closed: boolean;
};
export type PayloadKind = { id: string; label: string; platform: string; note: string };

export const fetchRevInterfaces = () =>
  api<{ interfaces: BindInterface[] }>("/reverse-shell/interfaces");
export const fetchRevListeners = () =>
  api<{ listeners: RevListener[] }>("/reverse-shell/listeners");
export const fetchRevSessions = () =>
  api<{ sessions: RevSession[] }>("/reverse-shell/sessions");
export const fetchPayloadKinds = () =>
  api<{ kinds: PayloadKind[] }>("/reverse-shell/payload-kinds");

export const createRevListener = (host: string, port: number, auto_upgrade: boolean) =>
  api<RevListener>("/reverse-shell/listeners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, port, auto_upgrade }),
  });
export const stopRevListener = (id: string) =>
  api<{ status: string }>(`/reverse-shell/listeners/${id}`, { method: "DELETE" });
export const killRevSession = (id: string) =>
  api<{ status: string }>(`/reverse-shell/sessions/${id}`, { method: "DELETE" });
export const generatePayload = (kind: string, lhost: string, lport: number) =>
  api<{ cmd: string }>("/reverse-shell/payload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, lhost, lport }),
  });

export type RevWsEvent =
  | { type: "history"; data: string }
  | { type: "data";    data: string }
  | { type: "info";    text: string }
  | { type: "closed" };

// ── WiFi Integrity ────────────────────────────────────────────────────────────

export type WifiSeverity = "pass" | "info" | "warn" | "fail";

export type WifiFinding = {
  section: string; label: string; value: string;
  severity: WifiSeverity; note: string;
};

export type WifiReport = {
  ssid: string; bssid: string; security: string;
  signal_dbm: string; channel: string;
  gateway_ip: string; gateway_mac: string;
  dns_servers: string[];
  findings: WifiFinding[];
};

export const fetchWifiReport = () => api<WifiReport>("/wifi/report");

// ── VPN ───────────────────────────────────────────────────────────────────────

export type VpnClient = { name: string; address: string };
export type VpnStatus = {
  available: boolean; running: boolean;
  config_path: string; wg_show: string;
  clients: VpnClient[]; missing: string[];
};

export const fetchVpnStatus = () => api<VpnStatus>("/vpn/status");
export const startVpn       = () => api<{ ok: boolean; output: string }>("/vpn/start", { method: "POST" });
export const stopVpn        = () => api<{ ok: boolean; output: string }>("/vpn/stop",  { method: "POST" });

// ── Terminal ──────────────────────────────────────────────────────────────────

export type ExecResponse = {
  cwd: string; cmd: string; returncode: number;
  stdout: string; stderr: string; truncated: boolean;
};

export const execCommand = (command: string, cwd?: string) =>
  api<ExecResponse>("/terminal/exec", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, cwd }),
  });

export const fetchDefaultCwd = () => api<{ cwd: string }>("/terminal/cwd");

// ── Brew ──────────────────────────────────────────────────────────────────────

export type BrewSearchResult = { rc: number; formulae: string[]; casks: string[] };

export const fetchBrewStatus    = () => api<{ available: boolean; path: string }>("/brew/status");
export const fetchBrewInstalled = () => api<{ rc: number; formulae: string[]; casks: string[] }>("/brew/installed");
export const searchBrew         = (q: string) =>
  api<BrewSearchResult>(`/brew/search?q=${encodeURIComponent(q)}`);

export type BrewExecEvent =
  | { type: "started"; cmd: string }
  | { type: "line";    text: string }
  | { type: "done";    rc: number; stopped: boolean }
  | { type: "error";   detail: string };

// ── Forensics ─────────────────────────────────────────────────────────────────

export type ForensicSeverity = "info" | "warn" | "high";
export type SignStatus =
  | "apple" | "developer-id" | "ad-hoc" | "unsigned" | "invalid" | "missing" | "";

export type PersistenceEntry = {
  source: string; plist: string; label: string; program: string;
  run_at_load: boolean; keep_alive: boolean;
  start_interval: number | null;
  sign_status: SignStatus; sign_team: string; sign_authority: string;
  suspicious_path: boolean;
  severity: ForensicSeverity;
};

export const fetchPersistenceAudit = () =>
  api<{ entries: PersistenceEntry[] }>("/persistence/audit");

export type ListenerInfo = { proto: string; addr: string; port: number };
export type ProcessEntry = {
  pid: number; ppid: number;
  name: string; username: string;
  exe: string; cwd: string; cmdline: string;
  listeners: ListenerInfo[];
  sign_status: SignStatus; sign_team: string;
  suspicious_path: boolean;
  severity: ForensicSeverity;
};

export const fetchProcesses = (unsignedOnly: boolean) =>
  api<{ count: number; entries: ProcessEntry[] }>(
    `/processes/list?unsigned_only=${unsignedOnly}`,
  );

export type KillSignal = "TERM" | "KILL" | "STOP" | "CONT" | "HUP";

export type KillResult = {
  pid: number;
  ok: boolean;
  error?: string | null;
  signal?: string;
  method?: string;
  name?: string;
  need_confirm?: boolean;
  reason?: string;
  username?: string;
};

export const killProcess = (
  pid: number, signal: KillSignal,
  opts: { admin?: boolean; confirm?: boolean } = {},
) =>
  api<KillResult>("/processes/kill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pid, signal, admin: !!opts.admin, confirm: !!opts.confirm }),
  });

export const killBulk = (
  pids: number[], signal: KillSignal,
  opts: { admin?: boolean; confirm?: boolean } = {},
) =>
  api<{ results: KillResult[]; successful: number; total: number }>(
    "/processes/kill_bulk",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pids, signal, admin: !!opts.admin, confirm: !!opts.confirm }),
    },
  );

// ── CMS fingerprinter ─────────────────────────────────────────────────────────

export type CmsTech = {
  name: string;
  category: string;
  version: string;
  signals: string[];
  confidence: "low" | "med" | "high";
};

export type CmsReport = {
  url: string;
  final_url: string;
  host: string;
  status_code: number;
  elapsed_seconds: number;
  technologies: CmsTech[];
  by_category: Record<string, CmsTech[]>;
  interesting_headers: Record<string, string>;
  findings: { severity: "info" | "warn" | "high"; label: string; detail: string }[];
  policy: { verdict: string; reason: string };
};

export async function fetchCms(
  url: string, confirm: boolean,
): Promise<CmsReport | { needConfirm: true; reason: string }> {
  const qs = new URLSearchParams({ url, ...(confirm ? { confirm: "true" } : {}) });
  const res = await fetch(`${BACKEND_URL}/cms/fingerprint?${qs}`);
  if (res.status === 409) {
    const b = await res.json();
    return { needConfirm: true, reason: b.detail?.reason ?? "confirmation required" };
  }
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json() as Promise<CmsReport>;
}

// ── macOS posture ─────────────────────────────────────────────────────────────

export type MacosPosture = {
  sip:        { status: string; raw: string };
  gatekeeper: { status: string; raw: string };
  filevault:  { status: string; raw: string };
  firewall:   { global_state: number; block_all: boolean; stealth: boolean;
                logging: boolean; raw: string };
  xprotect:   { version: string; path: string };
  findings:   { severity: "info" | "warn" | "high"; label: string; detail: string }[];
  elapsed_seconds: number;
};

export const fetchMacosPosture = () => api<MacosPosture>("/macos/posture");

// ── Linux posture ─────────────────────────────────────────────────────────────

export type LinuxFinding = {
  severity: "info" | "warn" | "high";
  label: string;
  detail?: string;
};

export type LinuxPosture = {
  mac: {
    selinux:  "enforcing" | "permissive" | "disabled" | "unknown" | "absent";
    apparmor: "loaded" | "enforcing" | "absent" | "unknown";
    enforcing_profiles: number;
    raw: string;
  };
  firewall: {
    backend: string;       // "ufw" | "firewalld" | "iptables" | "none" | …
    active: boolean;
    rules: number;
    raw: string;
  };
  sshd: {
    present: boolean;
    permit_root_login: string;
    password_authentication: string;
    x11_forwarding: string;
    max_auth_tries: string;
    kbdint_authentication: string;
    raw_path: string;
  };
  sysctl: { values: Record<string, string> };
  updates: { manager: string; pending: number; security: number; raw: string };
  sudoers: {
    sudoers_perms: string;
    world_writable: string[];
    non_root_owned: { path: string; uid: number }[];
  };
  disk: { luks_devices: string[]; any_encrypted: boolean };
  findings: LinuxFinding[];
  elapsed_seconds: number;
};

export const fetchLinuxPosture = () => api<LinuxPosture>("/linux/posture");

// ── Local discovery ───────────────────────────────────────────────────────────

export type LocalDiscoveryInit = {
  protocols?: ("mdns" | "ssdp" | "llmnr")[];
  duration?: number;
};

export type LocalDiscoveryEvent =
  | { type: "start";   protocols: string[]; duration: number }
  | { type: "found";   proto: "mdns" | "ssdp" | "llmnr";
                       ip?: string; port?: number;
                       st?: string; location?: string; server?: string; usn?: string;
                       service_type?: string; instance?: string;
                       bytes?: number }
  | { type: "done";    elapsed: number; counts: Record<string, number> }
  | { type: "error";   detail: string };

// ── JWT analyzer ──────────────────────────────────────────────────────────────

export type JwtFinding = { severity: "info" | "warn" | "high"; label: string; detail: string };

export type JwtReport = {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  alg: string;
  typ: string;
  kid: string;
  signature_present: boolean;
  claims_meta: { exp_iso: string; iat_iso: string; nbf_iso: string; expired: boolean };
  weak_secret_match: { secret: string; alg: string } | null;
  findings: JwtFinding[];
};

export const decodeJwt = (token: string) =>
  api<JwtReport>("/jwt/decode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, weak_secrets: true }),
  });

// ── GraphQL introspection ─────────────────────────────────────────────────────

export type GraphqlField = {
  field: string; type: string;
  args: { name: string; type: string }[];
  description: string;
};

export type GraphqlReport = {
  url: string; host: string; status_code: number;
  introspection_enabled: boolean;
  elapsed_seconds: number;
  query_type?: string; mutation_type?: string; subscription_type?: string;
  type_count?: number;
  types?: { name: string; kind: string; description: string }[];
  queries?: GraphqlField[];
  mutations?: GraphqlField[];
  deprecated?: (GraphqlField & { parent: string; reason: string })[];
  errors?: unknown[];
  raw_preview?: string;
  findings: { severity: "info" | "warn" | "high"; label: string; detail: string }[];
  policy: { verdict: string; reason: string };
};

export async function fetchGraphql(
  url: string, confirm: boolean,
): Promise<GraphqlReport | { needConfirm: true; reason: string }> {
  const qs = new URLSearchParams({ url, ...(confirm ? { confirm: "true" } : {}) });
  const res = await fetch(`${BACKEND_URL}/graphql/introspect?${qs}`);
  if (res.status === 409) {
    const b = await res.json();
    return { needConfirm: true, reason: b.detail?.reason ?? "confirmation required" };
  }
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json() as Promise<GraphqlReport>;
}

// ── Hash cracker ──────────────────────────────────────────────────────────────

export type HashAlgorithms = {
  fast: string[];
  slow: string[];
  rockyou: {
    available: boolean;
    path: string;
    size_bytes?: number;
    approx_lines?: number;
  };
};
export const fetchHashAlgorithms = () => api<HashAlgorithms>("/hash/algorithms");

export type HashIdentifyResp = { hash: string; length: number; candidates: string[] };
export const identifyHash = (hash: string) =>
  api<HashIdentifyResp>("/hash/identify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hash }),
  });

export type HashComputeResp = { algorithm: string; hash: string; input_length: number };
export const computeHash = (plaintext: string, algorithm: string) =>
  api<HashComputeResp>("/hash/compute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plaintext, algorithm }),
  });

export type HashCrackEvent =
  | { type: "started";  algorithm: string; total: number; builtin_used: boolean }
  | { type: "progress"; tried: number; total: number; elapsed: number }
  | { type: "done";     cracked: boolean; plaintext: string | null;
                        tried: number; total: number;
                        elapsed_seconds: number; stopped: boolean }
  | { type: "error";    detail: string };


// ── System info ──────────────────────────────────────────────────────────────

export type SystemInfo = {
  platform: "darwin" | "linux" | "win32" | string;
  is_mac: boolean;
  is_linux: boolean;
  is_windows: boolean;
  arch: string;
  release: string;
  system: string;
  hostname: string;
  python_version: string;
};

export const fetchSystemInfo = () => api<SystemInfo>("/system/info");


// ── Steganography ────────────────────────────────────────────────────────────

export type StegoCapacity = {
  format: string;
  capacity_bytes_raw: number;
  capacity_bytes_with_min_overhead: number;
  embeddable: boolean;
  width?: number; height?: number; mode?: string;
  channels?: number; sample_width_bytes?: number;
  frame_rate?: number; n_frames?: number;
};

export const fetchStegoCapacity = async (file: File): Promise<StegoCapacity> => {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BACKEND_URL}/stego/capacity`,
                          { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json();
};

export type StegoEmbedOptions = {
  carrier: File;
  payloadText?: string;
  payloadFile?: File;
  password?: string;
  compress: boolean;
  keepFilename: boolean;
};

export type StegoEmbedResult = {
  blob: Blob;
  filename: string;
  payloadBytes: number;
  containerBytes: number;
};

export const embedStego = async (opts: StegoEmbedOptions): Promise<StegoEmbedResult> => {
  const fd = new FormData();
  fd.append("file", opts.carrier);
  if (opts.payloadText !== undefined) fd.append("payload_text", opts.payloadText);
  if (opts.payloadFile) fd.append("payload_file", opts.payloadFile);
  if (opts.password) fd.append("password", opts.password);
  fd.append("compress", String(opts.compress));
  fd.append("keep_filename", String(opts.keepFilename));

  const res = await fetch(`${BACKEND_URL}/stego/embed`,
                          { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = cd.match(/filename="?([^"]+)"?/);
  return {
    blob,
    filename: m ? m[1] : "stego.bin",
    payloadBytes: Number(res.headers.get("X-Stego-Payload-Bytes") ?? 0),
    containerBytes: Number(res.headers.get("X-Stego-Container-Bytes") ?? 0),
  };
};

export type StegoExtractResp = {
  encrypted: boolean;
  compressed: boolean;
  filename: string | null;
  size: number;
  is_text: boolean;
  text: string;
  payload_b64: string;
};

export const extractStego = async (file: File, password?: string): Promise<StegoExtractResp> => {
  const fd = new FormData();
  fd.append("file", file);
  if (password) fd.append("password", password);
  const res = await fetch(`${BACKEND_URL}/stego/extract`,
                          { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json();
};

export type StegoChi = { chi_square: number; dof: number; p_value: number; stego_probability: number };

export type StegoAnalyzeResp = {
  format: string;
  size_bytes: number;
  width?: number; height?: number; mode?: string;
  channels?: number; sample_width?: number; frame_rate?: number; n_frames?: number;
  chi_square?: StegoChi;
  block_analysis?: ({ block: number } & StegoChi)[];
  exif?: { present: boolean; tags: Record<string, string>; count?: number };
  ntsteg_magic_detected?: boolean;
  ntsteg_expected_total?: number;
  capacity_bytes?: number;
  appended_data: {
    detected: boolean;
    offset?: number; length?: number;
    preview_hex?: string; printable?: string;
  };
  verdict: { severity: "clean" | "warn" | "high"; signals: string[] };
};

export const analyzeStego = async (file: File): Promise<StegoAnalyzeResp> => {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BACKEND_URL}/stego/analyze`,
                          { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json();
};

export const stripStegoMetadata = async (file: File): Promise<{ blob: Blob; filename: string }> => {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BACKEND_URL}/stego/strip-metadata`,
                          { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = cd.match(/filename="?([^"]+)"?/);
  return { blob, filename: m ? m[1] : "clean.bin" };
};
