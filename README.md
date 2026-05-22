# MyHackingPal

A macOS desktop security toolkit. Hybrid **Electron + React + TypeScript**
frontend with a bundled **FastAPI + Python** sidecar that owns all the
network/forensics/exploitation logic. ~40 tools organized into nine sidebar
categories, plus a Claude-powered chat assistant that watches your session
log and explains what your scans found.

```
~/network_tools/
├── backend/        FastAPI server — one router per tool
│   ├── lib/        shared libs: target_policy, web_fuzz, hids_notify, …
│   ├── routers/    ~40 routers, one per page
│   ├── main.py
│   └── network-tools-backend.spec   PyInstaller spec (sidecar)
└── frontend/
    ├── electron/   main + preload (Electron host)
    ├── src/
    │   ├── pages/        one .tsx per sidebar entry
    │   ├── components/   Sidebar, ChatBubble, CommandPalette, …
    │   └── lib/          theme, nav, sessionLog
    ├── package.json
    └── tailwind.config.js
```

Internal sidecar binary is still named `network-tools-backend` (unchanged for
build-pipeline simplicity) — only the user-facing branding is **MyHackingPal**.

---

## Quick start

```sh
open ~/Desktop/MyHackingPal.app
```

First run will prompt for a fresh Keychain entry the first time it touches a
privileged tool (tcpdump, nmap SYN/UDP/OS). For the chat assistant, open the
floating "AI" bubble → ⚙ → paste an `sk-ant-…` Anthropic API key.

---

## Tool catalogue

Sections match the sidebar.

### DISCOVERY

| Tool             | Endpoint(s)                        | What it does                                            |
| ---------------- | ---------------------------------- | ------------------------------------------------------- |
| LAN Scan         | `WS /ws/lan-scan` + `/lan/info`    | ARP sweep of the local /24                              |
| IP Checker       | `GET /ip/{addr}`, `POST /ip/bulk`  | Geo/ASN/DNSBL lookup + abuse contacts                   |
| DNS Recon        | `GET /dns/recon/{domain}` + WS     | A/AAAA/MX/NS/TXT, zone-transfer probe, subdomain brute  |
| WHOIS · ASN      | `GET /whois/{target}`              | Domain & IP WHOIS, ASN allocation                       |
| Local Discovery  | `WS /ws/local-disco`               | mDNS / SSDP / LLMNR passive sniff                       |
| Ping             | `WS /ws/ping`                      | Streaming ping                                          |

### RECON

| Tool             | Endpoint(s)                        | What it does                                            |
| ---------------- | ---------------------------------- | ------------------------------------------------------- |
| Port Scanner     | `WS /ws/port-scan`                 | TCP connect scan with banner grab                       |
| Nmap             | `/nmap/*` + WS                     | Full nmap surface (600+ NSE scripts), multi-target      |
| Network Audit    | `WS /ws/audit`                     | LAN scan + per-host risk grading                        |
| TLS Auditor      | `GET /tls/audit/{host}`            | Cert, protocols, HSTS, cipher                           |
| Fingerprint      | `GET /fingerprint/{host}/{port}`   | Banner-grab service identification                      |
| HTTP Probe       | `WS /ws/http-probe`                | Content-discovery brute + header analysis               |
| TCPDump          | `WS /ws/tcpdump`                   | Live packet capture (passwordless via sudoers drop-in)  |

### OSINT

| Tool        | Endpoint(s)                       | What it does                                             |
| ----------- | --------------------------------- | -------------------------------------------------------- |
| CT Logs     | `GET /ct/search/{domain}`         | Certificate-transparency subdomain enumeration           |
| Email Sec   | `GET /email/audit/{domain}`       | SPF / DMARC / DKIM / BIMI / MTA-STS                      |
| Takeover    | `GET /takeover/check/{fqdn}` + WS | Subdomain-takeover signature check                       |
| Reverse IP  | `GET /reverse-ip/{target}`        | Other domains hosted on the same IP                      |

### WEB RECON

| Tool             | Endpoint(s)                | What it does                                            |
| ---------------- | -------------------------- | ------------------------------------------------------- |
| Subdomain Enum   | `WS /ws/subdom-enum`       | Aggregator: crt.sh / HackerTarget / OTX / RapidDNS free; SecurityTrails / VirusTotal / Shodan via Keychain key |
| CMS / Stack      | `GET /cms/fingerprint`     | Wappalyzer-style tech fingerprint                        |
| JWT              | `POST /jwt/decode`         | Header/payload decode + weak-secret check                |
| GraphQL          | `GET /graphql/introspect`  | Introspection enumeration                                |

### WEB EXPLOIT  *— authorization-gated, active*

All take a request template with a `FUZZ` marker (URL, body, header value, or
cookie value). Each enforces an "I have authorization" checkbox and blocks
RFC1918 / loopback / metadata IPs unless you also tick "Allow internal".

| Tool                  | Detection                                                              | Exploit option            |
| --------------------- | ---------------------------------------------------------------------- | ------------------------- |
| XSS                   | 15 polyglot + context-aware payloads; context = body / attr / JS / URL | n/a (reflection only)     |
| SQL Injection         | error / boolean / time / union, across MySQL/PG/MSSQL/SQLite/Oracle    | pull DBMS version         |
| Command Injection     | time-based (Unix `; sleep 5` + Windows `& timeout 5`) + output (`id`)  | read /etc/passwd          |
| LFI / Path Traversal  | `../`, encoded, double-encoded, absolute, PHP wrappers, /proc/self/    | dump /etc/shadow & friends |
| SSRF                  | loopback + dec/hex/octal IPv4 + AWS/Azure/GCP IMDS + file:/gopher:     | full IMDS / creds dump    |
| IDOR                  | iterate IDs, compare OWNER auth profile vs N attacker profiles         | flags 200 + close length  |

### RED TEAM

| Tool          | Endpoint(s)            | What it does                       |
| ------------- | ---------------------- | ---------------------------------- |
| Reverse Shell | `/revshell/*` + WS     | Payload builder + listener         |

### CRYPTO

| Tool          | Endpoint(s)            | What it does                                           |
| ------------- | ---------------------- | ------------------------------------------------------ |
| Hash Cracker  | `/hash/*` + WS         | Identify + dictionary attack; bundles rockyou via PyInstaller spec |

### MONITORING

| Tool | Endpoint(s)         | What it does                                                     |
| ---- | ------------------- | ---------------------------------------------------------------- |
| IDS  | `WS /ws/ids`        | Lightweight host-IDS — new listening ports, failed-auth events   |

### FORENSICS

| Tool           | Endpoint(s)                       | What it does                                              |
| -------------- | --------------------------------- | --------------------------------------------------------- |
| Persistence    | `GET /persistence/audit` *(mac)*  | LaunchAgents / LaunchDaemons audit with codesign          |
| Processes      | `GET /processes/list` + kill      | Running processes + listeners + signature status          |
| Steganography  | `/stego/*`                        | LSB embed/extract (PNG/BMP/WAV), JPEG analyze, AES-GCM    |
| macOS Posture  | `GET /macos/posture` *(mac)*      | SIP / Gatekeeper / FileVault / firewall / XProtect        |

### UTILITIES

| Tool             | Endpoint(s)             | What it does                                          |
| ---------------- | ----------------------- | ----------------------------------------------------- |
| WiFi Integrity *(mac)* | `GET /wifi/report` | SSID/BSSID/gateway/DNS sanity                         |
| VPN Manager *(mac)*    | `/vpn/*`           | WireGuard `wg0` start/stop/status                     |
| Terminal              | `POST /terminal/exec` | One-shot shell exec (no PTY)                          |
| Brew *(mac)*          | `/brew/*` + WS         | Homebrew search / install streaming                   |

---

## Cross-cutting features

### AI chat assistant

Floating bubble in the bottom-right (`components/ChatBubble.tsx`). Uses
`claude-opus-4-7` with adaptive thinking + summarized display. Streams via
SSE from `POST /chat/stream`.

- The frontend's session log (`lib/sessionLog.ts`) records every successful
  `api()` response (last ~50 entries, truncated to ~1.2KB each).
- Each chat turn ships the last 30 session-log entries plus the active page
  as context, so the assistant can interpret your latest scan results.
- API key stored in macOS Keychain under service `MyHackingPal`, account
  `anthropic_api_key`.
- Prompt caching is enabled on the (large, stable) system prompt that
  explains every tool category to Claude.

### Theme

Dark / light / system, persisted to localStorage. Top-bar button cycles.
Colors are CSS variables under `:root` and `:root.light` (see
`src/index.css`); Tailwind classes use `rgb(var(--xxx) / <alpha-value>)`
so opacity modifiers keep working.

### Command palette — ⌘K

Fuzzy-search across every page. Subsequence match scored by adjacency +
word-boundary + position-0 bonuses; ties prefer shorter labels. Section
names ("WEB EXPLOIT") match too. Sidebar nav is shared with the palette via
`src/lib/nav.ts`.

### Sidebar — ⌘B

Toggle to hide. State persisted to localStorage. macOS traffic lights are
preserved when hidden via `pl-[88px]` inset.

---

## Configuration

### Anthropic key (required for chat)

In-app: open the AI bubble → ⚙ → paste `sk-ant-…` → Save. Or:

```sh
security add-generic-password -a anthropic_api_key -s MyHackingPal -w 'sk-ant-…' -U
```

### Paid subdomain-enum APIs (optional)

No in-app UI yet — set via curl after launch:

```sh
curl -X POST http://127.0.0.1:8765/settings/keys/securitytrails_api_key \
  -H 'Content-Type: application/json' -d '{"value":"<key>"}'
curl -X POST http://127.0.0.1:8765/settings/keys/virustotal_api_key \
  -H 'Content-Type: application/json' -d '{"value":"<key>"}'
curl -X POST http://127.0.0.1:8765/settings/keys/shodan_api_key \
  -H 'Content-Type: application/json' -d '{"value":"<key>"}'
```

The Subdomain Enum page re-fetches source status on open and lights up the
relevant checkbox once a key is configured.

### Target policy

`backend/config.json` → `target_policy` controls what counts as a soft
"warn" vs hard "deny" for any tool that gates on `target_policy.check_target`.
Defaults allow private / loopback / Tailscale and warn-only on external
targets. See `backend/lib/target_policy.py` for the schema.

### Sudoers drop-ins

`tcpdump` and `nmap` install one-shot sudoers entries via `osascript`-prompted
admin privileges. Endpoints: `POST /tcpdump/install`, `POST /nmap/install`.
Each tool writes to `/etc/sudoers.d/network-tools-<tool>` owned by `root:wheel`.

---

## Safety / authorization

The WEB EXPLOIT tools are dual-use. Defaults built in:

- **Authorization checkbox** — every page refuses to start until you've
  ticked "I have authorization to test this target".
- **Scope guard** — RFC1918 / loopback / link-local / cloud-metadata IPs
  refused by default. Tick "Allow internal targets" to override.
- **Rate limit** — slider on every page, default 8 req/s, max 30.
- **Stop button** — every scan is interruptible mid-flight.
- **Audit trail** — every successful HTTP request is recorded in the
  session log and surfaced to the chat assistant.

The intent is to make the *easy* path the *safe* path. None of these stop a
determined misuse — they're there to prevent foot-guns (e.g. accidentally
fuzzing your own LAN gateway).

---

## Development

Two processes, one per terminal.

```sh
# Terminal 1 — backend (FastAPI on 8765, auto-reload)
cd ~/network_tools/backend
python3 -m uvicorn main:app --reload --port 8765

# Terminal 2 — frontend (Vite on 5173, then Electron)
cd ~/network_tools/frontend
npm install            # one-time
npm run dev:all        # vite + electron
# or just vite:
npm run dev            # open http://localhost:5173
```

When `app.isPackaged` is true, Electron spawns the bundled sidecar from
`Contents/Resources/backend/network-tools-backend` and waits for `/health`.
In dev it expects you to be running uvicorn yourself.

### Adding a new tool

1. Backend: drop `routers/<name>.py` exposing a router; register in
   `backend/main.py`.
2. Frontend: drop `src/pages/<Name>.tsx`; import + add to the ternary in
   `App.tsx`; add an entry to the right section in `src/lib/nav.ts` (the
   sidebar and command palette read from this).
3. Chat assistant: extend `SYSTEM_PROMPT` in `backend/routers/chat.py` with
   a one-line description so it can interpret the tool's results.

### Building a release

```sh
cd frontend
npm run dist:dir   # PyInstaller backend → Vite build → electron-builder
                   # → dist-electron/mac-arm64/MyHackingPal.app
```

Install to Desktop:

```sh
# Quit a running instance first or electron-builder may fail.
osascript -e 'quit app "MyHackingPal"' 2>/dev/null
rm -rf ~/Desktop/MyHackingPal.app
cp -R ~/network_tools/frontend/dist-electron/mac-arm64/MyHackingPal.app ~/Desktop/
```

Cross-platform configs exist for Windows + Linux in `package.json` but
binaries have not been produced. Mac-only routers are tagged via the
`platforms` array on each NavItem in `src/lib/nav.ts` and auto-hide on
non-Mac runs via `GET /system/info`.

---

## WebSocket protocol

Streaming routers all follow the same shape:

1. Client opens `ws://127.0.0.1:8765/ws/<name>`.
2. Client sends one JSON object as the handshake (target, options, etc.).
3. Optionally sends `{"action":"stop"}` at any time to abort.
4. Server sends a sequence of `{"type": ...}` events terminated by either
   `done` or `error`.

The web-exploit family additionally requires `confirm_auth: true` in the
init message. See `routers/port_scanner.py` for the canonical example.

---

## Stack reference

- **Backend:** Python 3.11+, FastAPI, uvicorn (asyncio loop), httpx,
  websockets/wsproto, anthropic SDK, Pillow, cryptography, python-multipart.
- **Frontend:** React 18, Vite, TypeScript, Tailwind (CSS-variable theme),
  Electron 33.
- **Bundling:** PyInstaller (backend → standalone binary), electron-builder
  (Electron + sidecar + icon → `.app`).
- **Persistence:** macOS Keychain (`security` CLI) for all API keys.
  No on-disk credentials.
