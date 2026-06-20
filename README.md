<p align="center">
  <img src="docs/brand/icon.png" alt="HackingPal" width="120" height="120" />
</p>

<h1 align="center">HackingPal</h1>

<p align="center"><em>AI-assisted security workspace for authorized engagements.</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Docker-blue" alt="Platforms" />
  <img src="https://img.shields.io/badge/Windows-experimental%20%2F%20deferred-lightgrey" alt="Windows" />
  <a href="https://github.com/hackingpal/hackingpal/releases/latest"><img src="https://img.shields.io/github/v/release/hackingpal/hackingpal?include_prereleases&label=release" alt="Release" /></a>
</p>

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
hackingpal/
├── backend/        FastAPI server — one router per tool
│   ├── lib/        shared libs: target_policy, web_fuzz, hids_notify, …
│   ├── routers/    tool routers/endpoints, one per page or capability
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
build-pipeline simplicity) — only the user-facing branding is **HackingPal**.

---

## Installation

### Option 1 — Download (recommended)

Release assets are public and download without a GitHub login. (The
links below use GitHub's `releases/latest/download/<file>` redirect, so
they always point at the newest published release.)

| Platform | Download | Notes |
|---|---|---|
| macOS (Apple Silicon) | [HackingPal-macos-arm64.dmg](https://github.com/hackingpal/hackingpal/releases/latest/download/HackingPal-macos-arm64.dmg) · [.zip](https://github.com/hackingpal/hackingpal/releases/latest/download/HackingPal-macos-arm64.zip) | Mount the DMG and drag to `/Applications`, then run the Gatekeeper bypass below. The `.zip` is a `ditto`-packed `.app` for tooling that can't mount DMGs. |
| Linux (x86_64) | [HackingPal-linux-x86_64.AppImage](https://github.com/hackingpal/hackingpal/releases/latest/download/HackingPal-linux-x86_64.AppImage) | `chmod +x` then run |

**macOS first launch (the build is unsigned).** HackingPal does not yet
have a paid Apple Developer certificate, so the OS will refuse a plain
double-click on the first run with "HackingPal can't be opened because
Apple cannot check it for malicious software." Two ways through:

1. **Right-click → Open** in Finder (then click **Open** in the dialog).
   This is the canonical Apple-blessed bypass for an unsigned app — the
   choice is recorded so subsequent launches work normally. Recommended
   if you prefer not to touch a terminal.
2. **Strip the quarantine attribute from a terminal**, then launch:
   ```sh
   xattr -cr /Applications/HackingPal.app && open /Applications/HackingPal.app
   ```
   `xattr -cr` clears the `com.apple.quarantine` flag macOS attaches to
   downloaded files; `open` launches the bundle. Use this if you
   installed the `.zip` somewhere outside `/Applications`.

Once it's launched once, subsequent launches work normally.

Native Windows builds may still appear in CI/releases, but Windows is experimental and not a v1.0 support target. Use Docker/remote backend mode if you are testing from a Windows workstation.

See per-platform guides in `docs/` for more first-launch detail, and
[docs/SIGNING.md](docs/SIGNING.md) for what code-signing would actually
take. Installed apps auto-check for updates via
[electron-updater](https://www.electron.build/auto-update) — on Windows
and Linux this also auto-installs; on Mac the OS rejects the unsigned
replacement, so updates are detected but require re-downloading the DMG.
Per-commit CI artifacts (including Linux arm64 AppImage and `.deb`)
remain available on the [Actions tab](https://github.com/hackingpal/hackingpal/actions/workflows/build.yml).

### Option 2 — Docker (backend API only)

The Docker image runs the FastAPI backend headlessly — useful for server
deployments or remote use. There's no Electron GUI in the container; you
talk to it over HTTP from a browser, curl, or another client.

```sh
git clone https://github.com/hackingpal/hackingpal.git
cd hackingpal
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

Works on macOS and Linux first. Windows may boot in development, but it is experimental/deferred for v1.0. See [Development](#development) below for
the two-terminal dev loop, and [Building a release](#building-a-release) for
producing a packaged binary.

### Per-platform install guides

- [macOS](docs/README-macos.md) — Gatekeeper, Keychain, sudoers drop-ins
- [Windows](docs/README-windows.md) — experimental/deferred; SmartScreen, Credential Manager, Npcap *(not a v1.0 target)*
- [Linux](docs/README-linux.md) — capabilities, Secret Service, AppImage notes *(in progress)*

### Platform support matrix

| Support tier | Platform | Status | Notes |
|---|---|---|---|
| Tier 1 | macOS | Primary v1.0 desktop baseline | First polished UX target; Keychain, posture, WiFi, tcpdump/nmap sudoers, and signed-build work focus here first. |
| Tier 1 | Linux | Primary v1.0 lab/power-user baseline | Best fit for security tooling, Docker hosts, systemd/firewall/users audit, and homelab usage. |
| Tier 1 | Docker | Lab/server/remote backend mode | Backend/API mode for trusted networks, VPN/Tailscale, and homelab deployment. Do not expose publicly. |
| Deferred | Windows | Experimental | Keep clean guards/501s and avoid regressions where easy, but native Windows parity is not a v1.0 blocker. |

Platform-specific routers are tagged via the `platforms` array on each NavItem
in `src/lib/nav.ts` and auto-hide on the wrong OS via `GET /system/info`.
Unsupported endpoints should return clean 501/503 responses with useful hints
instead of crashing. Windows CI smoke checks are useful if low-maintenance, but
Windows feature parity is deferred.

---

## First run

First launch will prompt for a fresh Keychain entry the first time it touches a
privileged tool (tcpdump, nmap SYN/UDP/OS). For the AI Assistant, open **Settings → API keys** and paste an Anthropic API key. Claude is the first supported provider; the roadmap should keep the provider layer flexible for cheaper or local models later.

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
- API key stored in macOS Keychain under service `HackingPal`, account
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

In-app: open **Settings → API keys** → paste `sk-ant-…` → Save. Or:

```sh
security add-generic-password -a anthropic_api_key -s HackingPal -w 'sk-ant-…' -U
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

# Terminal 3 — Android companion app (optional)
cd mobile
flutter pub get
flutter run
# Point the app at your backend IP in Settings
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
3. Metadata: declare supported platforms, mode requirements, risk level, and whether the tool accepts targets.
4. Safety: wire target-accepting tools through scope enforcement, command preview, audit logging, and authorization gates when active.
5. AI: extend the tool catalogue/prompt metadata so the assistant can interpret results and suggest the tool appropriately.

### Building a release

```sh
cd frontend
npm run dist:dir   # PyInstaller backend → Vite build → electron-builder
                   # → dist-electron/mac-arm64/HackingPal.app
```

Install to Desktop:

```sh
# Quit a running instance first or electron-builder may fail.
osascript -e 'quit app "HackingPal"' 2>/dev/null
rm -rf ~/Desktop/HackingPal.app
cp -R ~/network_tools/frontend/dist-electron/mac-arm64/HackingPal.app ~/Desktop/
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
- **Platform testing** — help verify macOS, Linux, and Docker builds. Windows testing is welcome but experimental/deferred.

Please read CONTRIBUTING.md and DISCLAIMER.md before submitting a PR.

---

## Roadmap

### v0.1.0-beta — Shipped ✅
- [x] 40+ tools across 9 categories
- [x] Claude-powered AI assistant with session context
- [x] Attack playbook / preset system
- [x] WebSocket streaming for all active tools
- [x] Authorization gates on all exploit tools
- [x] Scope guard + rate limiting
- [x] macOS Keychain for all credentials
- [x] Command palette (⌘K) + sidebar (⌘B)
- [x] Dark / light / system theme

### v0.2.0-beta — Cross-platform + Mobile ✅ (current)
- [x] Windows build (.exe NSIS installer + portable)
- [x] Linux build (.AppImage + .deb, x64 + arm64)
- [x] Docker backend image (headless API server)
- [x] Android companion app (Flutter, 7 tools + chat)
- [x] Cross-platform persistence audit
      (launchd / systemd / Registry)
- [x] Cross-platform posture
      (macOS / Linux / Windows)
- [x] Cross-platform WiFi scan
      (CoreWLAN / nmcli / netsh)
- [x] Cross-platform packages
      (Homebrew / apt / dnf / pacman)
- [x] Linux-specific tools
      (Systemd Units, Firewall Rules, Users Audit)
- [x] CI matrix builds on every push to main

### v0.3.0 — Stability + Polish
- [ ] Full error handling pass across all tools
- [ ] Input validation on every endpoint
- [ ] Test suite (pytest backend + Vitest frontend)
- [ ] First-launch wizard
- [ ] Settings page with in-app API key management
- [ ] Engagement / session management + findings tracker
- [ ] PDF/markdown report export
- [ ] Code signing + notarization (macOS + Windows)
- [ ] Auto-update via electron-updater

### v0.4.0 — Mobile Expansion
- [ ] iOS companion app (Swift)
- [ ] Android: full tool parity with desktop
- [ ] Mobile findings sync with desktop session
- [ ] Push notifications for long-running scans

### v1.0.0 — Community
- [ ] Community preset library (.mhp files)
- [ ] NGFW integration (pfSense, OPNsense, Palo Alto)
- [ ] Plugin / custom tool API
- [ ] Signed releases on GitHub Releases

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
- **Mobile:** Flutter 3.x (Dart), targets Android 7+ (minSdk 24), compileSdk 36.
  Package `dev.adamsjack.hackingpal`. Connects to the FastAPI backend over
  Tailscale.
- **Container:** Docker (`python:3.11-slim`), bundled with nmap 7.95 +
  tcpdump 4.99.5 + cloud SDKs (boto3, azure-mgmt-*, google-cloud-*) +
  AD tooling (ldap3, impacket, bloodhound). `NET_RAW` + `NET_ADMIN` caps.
- **Bundling:** PyInstaller (backend → standalone binary), electron-builder
  (Electron + sidecar + icon → `.app`).
- **Persistence:** macOS Keychain / Linux Secret Service / Windows Credential
  Manager for all API keys. Docker: `ANTHROPIC_API_KEY` env var. No on-disk
  credentials.
