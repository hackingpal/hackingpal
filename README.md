# MyHackingPal

![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Docker-blue)
![Windows](https://img.shields.io/badge/Windows-experimental%20%2F%20deferred-lightgrey)
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
build-pipeline simplicity) — only the user-facing branding is **MyHackingPal**.

---

## Latest update — 2026-05-29

**Engagement-first pivot in motion.** MyHackingPal is mid-rewrite from
"click-a-tool dashboard" to "AI-assisted engagement workspace". The work
landing in 0.3.0 is the scaffold for that flow:

- **Lab vs Engagement mode toggle** — persisted per-window flag in the top
  bar. Lab skips scope checks and auto-record; Engagement enforces scope
  and writes evidence to the active engagement timeline. `X-MHP-Mode`
  header on HTTP / `?mode=` query on WS plumbs it through to the backend.
- **Engagement scope enforcement** — `lib/scope.py` is the new layer
  on top of `target_policy`. Five routers wired so far (port_scanner,
  ping, s3_scanner, smb_enum, subdomain_enum); ~70 more to go. The
  helpers `enforce_ws` / `enforce_rest` fold the boilerplate into one
  call per router.
- **Audit log** — append-only `lib/audit_log.py` records every action
  (tool, target, argv, approver, result) — 13 attack tools already
  emit. Surfaced on the new `/audit` page and into engagement reports.
- **Sidebar restructure** — flat 10-item engagement-first nav: Home,
  Engagements, Targets, Playbooks, Tool Library, Evidence, Findings,
  Reports, AI Assistant, Settings. ChatBubble removed; replaced by the
  full-page AI Assistant. Default landing is the engagement dashboard.
- **Auth gate on every active attack tool** — AdSpray, S3Scanner,
  SubdomainEnum, Takeover, KerberosRoast, BloodHound, LateralMove,
  WpaCapture. Pairs with the existing checkbox on the six web-exploit
  pages.
- **Playbook schema, guided** — bundles can now declare `category`,
  `mode_required`, plus per-step `rationale` / `success` / `approval`.
  Five built-ins ship: Passive Recon (domain footprint), Local Posture
  (mac + linux), Surface Inventory, Web App First Look. Seven new tool
  adapters wired (dns_recon, ct_log, email_audit, cms_fingerprint,
  macos_posture, linux_posture, persistence_audit).
- **Platform focus clarified** — v1.0 is macOS + Linux + Docker first. Native
  Windows remains experimental/deferred and should not block the engagement,
  safety, evidence, or reporting work.
- **Central Settings page** — API keys, system info, mode toggle,
  appearance, engagement quick-links. Replaces the floating bubble's
  `⚙` panel.

See the [Roadmap](#roadmap) section below for what's done vs in flight.

---

## Installation

### Option 1 — Download (recommended)

| Platform | Download | Notes |
|---|---|---|
| macOS (Apple Silicon) | [MyHackingPal-macos-arm64.dmg](https://github.com/myhackingpal/myhackingpal/releases/latest) | Mount, drag to /Applications. Right-click → Open on first launch. Or grab the `.zip` if your tooling can't mount DMGs. |
| Linux (x86_64) | [MyHackingPal-linux-x86_64.AppImage](https://github.com/myhackingpal/myhackingpal/releases/latest) | `chmod +x` then run |

Native Windows builds may still appear in CI/releases, but Windows is experimental and not a v1.0 support target. Use Docker/remote backend mode if you are testing from a Windows workstation.

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

In-app: open **Settings → API keys** → paste `sk-ant-…` → Save. Or:

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
3. Metadata: declare supported platforms, mode requirements, risk level, and whether the tool accepts targets.
4. Safety: wire target-accepting tools through scope enforcement, command preview, audit logging, and authorization gates when active.
5. AI: extend the tool catalogue/prompt metadata so the assistant can interpret results and suggest the tool appropriately.

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
- **Platform testing** — help verify macOS, Linux, and Docker builds. Windows testing is welcome but experimental/deferred.

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
- [ ] Platform focus: macOS + Linux + Docker first; Windows experimental/deferred
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
- [ ] Docker/server-mode hardening docs: VPN/Tailscale-only guidance, reverse-proxy auth examples, and clear warning banners
- [ ] Test suite — pytest + Vitest, starting with engagement / scope / audit

**v1.x — Copilot, not autopilot**
- [ ] AI suggestion → approval card UX (suggest the next check, user
      approves before it runs)
- [ ] Playbook redesign: guided multi-step flows with AI commentary at
      each step + per-step approval
- [ ] Command preview / dry-run for every subprocess shell-out
- [ ] AI provider abstraction for Claude first, with Gemini/OpenAI-compatible/local options later
- [ ] Assessment coverage matrix for each engagement
- [ ] Formalized evidence model — unified timeline of scan output,
      screenshots, chat turns
- [ ] Code-signed Mac (Developer ID + notarization); Windows signing deferred

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
