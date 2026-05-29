# MyHackingPal

![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Docker-blue)
[![Release](https://img.shields.io/github/v/release/myhackingpal/myhackingpal?include_prereleases&label=release)](https://github.com/myhackingpal/myhackingpal/releases/latest)

> 📸 **Demo coming soon** — screenshot and walkthrough GIF will be added with the v0.1.0-beta release.

**An AI-assisted security testing workspace for authorized engagements.**

The center of the app is the **engagement**: a scoped, named container for a
single piece of work. You create one (with explicit targets and exclusions),
pick a playbook or pick tools one-by-one, and every result — scan output,
finding, screenshot — is auto-attached to that engagement and turned into a
report at the end. A Claude-powered copilot watches the session and helps
you interpret results, suggest next checks, and draft the report — but it
**suggests, it doesn't act**. Every active check waits for a human to approve.

```
Engagement → Targets → Playbook → Tools → Evidence → Report
```

The product is built around that flow. The 75+ individual tools — discovery,
recon, web exploit, AD, cloud, forensics — are the **library** that lives
inside engagements, not the product itself. You can still launch any tool
directly (the sidebar / ⌘K palette work the same way), but the engagement
context is what turns a tool-launcher into a security workspace.

Hybrid **Electron + React + TypeScript** frontend with a bundled
**FastAPI + Python** sidecar that owns all the network / forensics /
exploitation logic. See [ROADMAP.md](ROADMAP.md) for the direction and
[CLAUDE.md](CLAUDE.md) for the architecture + contributor guide.

```
myhackingpal/
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

## Latest update — 2026-05-22

**Docker backend now ships.** A headless API-server image for running
MyHackingPal's backend on Linux without the Electron GUI. Useful as a
"server mode" you can hit from a browser or another client, or as a
reproducible sandbox for the scanning tools.

- **`backend/Dockerfile`** — `python:3.11-slim` + bundled tools (nmap 7.95,
  tcpdump 4.99.5, dig, whois, openssl, wireguard-tools). Installs all cloud
  recon SDKs (boto3, azure-mgmt-*, google-cloud-*) and AD tooling (ldap3,
  impacket, bloodhound). Skips macOS-only `pyobjc-*` bindings.
- **`docker-compose.yml`** — exposes `8765:8765`, grants `NET_RAW` +
  `NET_ADMIN` for tcpdump and nmap SYN/UDP/OS raw-socket scans. Persistent
  volume mounted at `/app/data`.
- **3 cross-platform fixes** that surfaced from the Docker smoke tests:
  - `azure_recon`: `SubscriptionClient` import moved to its split-out
    `azure-mgmt-resource-subscriptions` package in v23+.
  - `forensics.codesign_check`: short-circuits when the `codesign` binary
    isn't present, so `/processes/list` works on Linux instead of 500ing.
  - `gcp_recon /status`: pre-flight ADC check avoids a 15s GCE metadata
    probe inside containers that aren't on GCE — now fast-fails in 20ms.

Verified: **45/52** parameterless GET endpoints return 200 on Linux; the
remaining 4 are macOS-only routers (`brew`, `wifi-scan`, `bt/*`) returning
helpful 503s. Live `nmap -sS` against `scanme.nmap.org` from inside the
container completes in 0.11s, confirming NET_RAW is applied.

**Android companion app shipped (`mobile/`)** — a Flutter app that points
at the backend over Tailscale (default `http://100.75.23.96:8765`, editable
in Settings). v1 ships 7 quick-lookup tools (IP, DNS Recon, WHOIS, TLS
Audit, Fingerprint, CT Logs, Email Security) plus a streaming chat tab
against `/chat/stream`. Package `dev.adamsjack.myhackingpal`,
compileSdk=36, minSdk=24. Cleartext is permitted because the only network
in play is your tailnet (which is already encrypted).

For the chat tab to work against the Linux container, set
`ANTHROPIC_API_KEY` in `docker-compose.yml` (the env-var path falls back
to the macOS Keychain when running the desktop app natively).

---

## Installation

### Option 1 — Download (recommended)

| Platform | Download | Notes |
|---|---|---|
| macOS (Apple Silicon) | [MyHackingPal-macos-arm64.dmg](https://github.com/myhackingpal/myhackingpal/releases/latest) | Mount, drag to /Applications. Right-click → Open on first launch. Or grab the `.zip` if your tooling can't mount DMGs. |
| Windows (x64) | [MyHackingPal-windows-x64.exe](https://github.com/myhackingpal/myhackingpal/releases/latest) | Click "More info" → "Run anyway" |
| Linux (x86_64) | [MyHackingPal-linux-x86_64.AppImage](https://github.com/myhackingpal/myhackingpal/releases/latest) | `chmod +x` then run |

All builds are unsigned. See per-platform guides in `docs/` for first-launch
instructions, and [docs/SIGNING.md](docs/SIGNING.md) for what code-signing
would actually take. Installed apps auto-check for updates via
[electron-updater](https://www.electron.build/auto-update) — on Windows
and Linux this also auto-installs; on Mac the OS rejects the unsigned
replacement, so updates are detected but require re-downloading the DMG.
Per-commit CI artifacts (including Linux arm64 AppImage and `.deb`)
remain available on the [Actions tab](https://github.com/myhackingpal/myhackingpal/actions/workflows/build.yml).

### Option 2 — Docker (backend API only)

The Docker image runs the FastAPI backend headlessly — useful for server
deployments or remote use. There's no Electron GUI in the container; you
talk to it over HTTP from a browser, curl, or another client.

```sh
git clone https://github.com/myhackingpal/myhackingpal.git
cd myhackingpal
docker compose up -d
curl http://127.0.0.1:8765/health
# {"status":"ok","version":"0.1.0","pid":"1"}
```

The compose file grants `NET_RAW` + `NET_ADMIN` so tcpdump and nmap
SYN/UDP/OS scans work. For LAN scanning from the host's network on a Linux
host, switch to `network_mode: host` (see the comment inline in
`docker-compose.yml`). Endpoints that need OS-specific APIs return a clean
501/503 with a hint message — e.g. `/macos/posture` is macOS-only,
`/linux/posture` is Linux-only, `/windows/posture` is Windows-only.

Interactive API docs are at `http://127.0.0.1:8765/docs`.

### Option 3 — Build from source

Works on macOS, Windows, and Linux. See [Development](#development) below for
the two-terminal dev loop, and [Building a release](#building-a-release) for
producing a packaged binary.

### Per-platform install guides

- [macOS](docs/README-macos.md) — Gatekeeper, Keychain, sudoers drop-ins
- [Windows](docs/README-windows.md) — SmartScreen, Credential Manager, Npcap *(in progress)*
- [Linux](docs/README-linux.md) — capabilities, Secret Service, AppImage notes *(in progress)*

### Platform support matrix

|                                | macOS | Linux | Windows |
| ------------------------------ | :---: | :---: | :-----: |
| Cross-platform tools (~60)     |   ✅  |   ✅  |   ✅    |
| Persistence audit              |   ✅ launchd | ✅ systemd + cron + autostart | ✅ Registry Run + Startup + Scheduled Tasks |
| Security posture               |   ✅ SIP/GK/FV/XP | ✅ SELinux/UFW/sshd | ✅ BitLocker/Defender/UAC/Firewall |
| WiFi scan                      |   ✅ CoreWLAN | ✅ nmcli/iw | ✅ netsh wlan |
| WiFi integrity / VPN / TCPDump |   ✅   |   ✅  | ⏳ planned |
| Bluetooth recon                |   ✅ system_profiler | ✅ bluetoothctl | ⏳ planned |
| WPA capture                    |   ✅ (forward to Kali VM) | ⏳ | ⏳ |
| Systemd / Firewall rules / Users audit | n/a |  ✅  |   n/a   |

Endpoints flagged ⏳ return HTTP 501 with an explanatory hint on that OS;
the sidebar hides them automatically via `GET /system/info`. The CI smoke
step on `windows-latest` verifies that the sidecar boots, probes 14
endpoints, and asserts the 501-guards stay clean rather than 500-crash.

---

## First run

First launch will prompt for a fresh Keychain entry the first time it touches a
privileged tool (tcpdump, nmap SYN/UDP/OS). For the chat assistant, open the
floating "AI" bubble → ⚙ → paste an `sk-ant-…` Anthropic API key.

---

## Tool library

The library is a **resource called into engagements**, not the product
itself. You can launch any tool from the sidebar / ⌘K palette and run it
standalone (Lab mode), but the same tools become "the next check in an
engagement" once you have one active — their results auto-attach as
evidence and the AI can pull from them when drafting the report.

Sections below mirror the sidebar.

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

| Tool           | Endpoint(s)                  | What it does                                                     |
| -------------- | ---------------------------- | ---------------------------------------------------------------- |
| IDS            | `WS /ws/ids`                 | Lightweight host-IDS — new listening ports, failed-auth events   |
| Systemd Units *(linux)* | `/systemd/*`         | List + inspect units, tail journal                               |
| Firewall Rules *(linux)*| `GET /firewall/rules`| nft / iptables-save parsed into chains + rules                   |

### FORENSICS

| Tool             | Endpoint(s)                  | What it does                                                                       |
| ---------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| Persistence      | `GET /persistence/audit`     | Mac: launchd. Linux: systemd + cron + autostart + rc.local. Windows: Registry Run + Startup + Scheduled Tasks. |
| Processes        | `GET /processes/list` + kill | Running processes + listeners + signature status                                   |
| Steganography    | `/stego/*`                   | LSB embed/extract (PNG/BMP/WAV), JPEG analyze, AES-GCM                             |
| macOS Posture *(mac)*     | `GET /macos/posture`    | SIP / Gatekeeper / FileVault / firewall / XProtect                            |
| Linux Posture *(linux)*   | `GET /linux/posture`    | SELinux / AppArmor / firewall / sshd / sysctl / sudoers / LUKS                |
| Windows Posture *(windows)* | `GET /windows/posture` | BitLocker / Defender / UAC / firewall / SmartScreen / Secure Boot / updates  |
| Users Audit *(linux)*     | `GET /users/audit`      | passwd / sudoers / lastlog / authorized_keys fingerprint scan                 |

### UTILITIES

| Tool             | Endpoint(s)             | What it does                                                                  |
| ---------------- | ----------------------- | ----------------------------------------------------------------------------- |
| WiFi Integrity   | `GET /wifi/report`      | SSID/BSSID/gateway/DNS sanity *(mac + linux; Windows port pending)*           |
| VPN Manager      | `/vpn/*`                | WireGuard `wg0` start/stop/status *(mac + linux; Windows uses different svc)* |
| Terminal         | `POST /terminal/exec`   | One-shot shell exec (no PTY)                                                  |
| Packages         | `/brew/*` + WS          | Homebrew (mac) / apt (Debian) / dnf (Fedora) / pacman (Arch) search + install |

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

A settings UI is coming in v0.2.0. Until then, configure via curl after launch:

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
cd backend
python3 -m uvicorn main:app --reload --port 8765

# Terminal 2 — frontend (Vite on 5173, then Electron)
cd frontend
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

Cross-platform builds are produced by CI on every push (see [Roadmap](#roadmap)):
Windows `.exe` (NSIS + portable), Linux `.AppImage` + `.deb`, macOS `.app` —
all via the `windows-latest` / `ubuntu-latest` / `ubuntu-24.04-arm` /
`macos-latest` matrix in `.github/workflows/build.yml`. PyInstaller can't
cross-compile, which is why the matrix runs natively on each OS.

Platform-specific routers are tagged via the `platforms` array on each
NavItem in `src/lib/nav.ts` and auto-hide on the wrong OS via
`GET /system/info`. The central platform helper lives at
`backend/lib/platform_util.py` (`IS_DARWIN` / `IS_LINUX` / `IS_WINDOWS`,
`app_data_dir()`, `require_darwin()` / `require_linux()` / `require_windows()`
helpers).

---

## Contributing

Contributions are welcome. The easiest way to contribute right now is:

- **Bug reports** — open an issue with steps to reproduce
- **Preset files** — submit a .mhp playbook for a new attack scenario (see CONTRIBUTING.md)
- **New tools** — follow the 3-step pattern in Adding a new tool above
- **Platform testing** — help verify Windows and Linux builds

Please read CONTRIBUTING.md and DISCLAIMER.md before submitting a PR.

---

## Roadmap

Full plan lives in [ROADMAP.md](ROADMAP.md). Short version:

**Shipped:**
- v0.1.x — 75+ tools across 15 sidebar categories, AI chat with session context,
  WebSocket streaming, authorization gates on web-exploit tools, macOS Keychain,
  command palette, themes, Docker backend, Android quick-lookup companion.
- v0.2.0 — Cross-platform builds (macOS / Windows / Linux), DMG + auto-updates
  via electron-updater, engagement + findings system, screenshot evidence,
  markdown + HTML + GitHub-issue report export.

**Pivot underway:** from "tool dashboard" to **AI-assisted engagement workspace**.

**v1.0 — Engagement-first workspace**
- [ ] Scope enforcement: every target-accepting tool consults the active
      engagement's scope/exclusions before running
- [ ] Lab mode vs Engagement mode toggle (default: Lab; opt into engagement
      gating when doing authorized work)
- [ ] Audit log: append-only record of every action (tool, target, argv,
      approver, result) — feeds the report
- [ ] Authorization checkbox on the remaining attack tools (AD spray,
      BloodHound, Kerberoasting, S3 enum, etc.)
- [ ] Settings page (in-app key management, mode toggle, sudoers cleanup)
- [ ] Engagement-centric default page on launch
- [ ] Test suite — pytest + Vitest, starting with engagement / scope / audit

**v1.x — Copilot, not autopilot**
- [ ] AI suggestion → approval card UX (suggest the next check, user
      approves before it runs)
- [ ] Playbook redesign: guided multi-step flows with AI commentary at
      each step + per-step approval
- [ ] Command preview / dry-run for every subprocess shell-out
- [ ] Formalized evidence model — unified timeline of scan output,
      screenshots, chat turns
- [ ] Code-signed Mac (Developer ID + notarization) + Windows (OV/EV)

**Beyond:**
- [ ] Community playbook library
- [ ] iOS companion (Swift)
- [ ] Plugin / custom tool API
- [ ] NGFW integrations

The safety controls list (scope allowlist, command preview, approval gates,
audit log, rate limits, lab vs real mode) is the v1.0 critical path — see
ROADMAP.md for the full rationale.

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
