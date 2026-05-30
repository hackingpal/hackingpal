# CLAUDE.md

Guide for Claude Code (and humans) working in this repo. Read this
once before changing anything substantial.

## What this project is

**MyHackingPal is pivoting from a "tool dashboard" to an
"AI-assisted security testing workspace for authorized engagements".**

If you take only one thing from this file: **the engagement is the
center of the app, not the individual tool**. When you're about to add
a feature or fix a bug, ask "does this fit inside Engagement →
Targets → Playbook → Tools → Evidence → Reports?" If not, raise the
question with the maintainer before building.

Full direction: [ROADMAP.md](ROADMAP.md).

## Architecture

Hybrid Electron + FastAPI:

```
network_tools/
├── backend/                     FastAPI sidecar — owns all the network /
│   ├── routers/                 forensics / exploitation logic. ~75 routers.
│   ├── lib/                     Shared modules: auth, errors, validators,
│   │                            target_policy, engagements, web_fuzz, etc.
│   ├── main.py                  App entry — registers routers, installs
│   │                            error handlers, runs the startup loopback guard.
│   ├── network-tools-backend.spec   PyInstaller spec (sidecar binary)
│   └── Dockerfile               Headless backend image for non-GUI use
├── frontend/
│   ├── electron/                Electron host: main.cjs spawns the sidecar
│   │                            on prod, waits for /health, opens window.
│   │                            preload.cjs exposes `nt.platform` only.
│   ├── src/
│   │   ├── pages/               One .tsx per sidebar entry (79 pages).
│   │   ├── components/          Sidebar, ChatBubble, ToolCatalog,
│   │   │                        EngagementPill, ErrorBoundary, ...
│   │   ├── components/webattack/   Shared form + WS hook for web-exploit pages
│   │   ├── lib/                 engagement (active eng + CRUD), sessionLog,
│   │   │                        theme, nav, plannedTools, sanitizeHtml, cvss
│   │   ├── api.ts               Single source of truth for HTTP + WS calls
│   │   ├── App.tsx              Routing, top bar, palette, chat bubble
│   │   └── main.tsx             React entry
│   ├── package.json             electron-builder config lives here
│   └── tailwind.config.js
├── mobile/                      Flutter Android companion (read-only tools + chat)
├── docs/                        Per-platform install guides + SIGNING.md
├── docker-compose.yml           Headless backend deployment
└── .github/workflows/build.yml  Cross-platform CI + tag-driven releases
```

Backend listens on **127.0.0.1:8765** by default (override with
`NT_BACKEND_PORT`). The startup guard in `backend/main.py` refuses to
start if `NT_BACKEND_HOST` or `HOST` is wildcarded — opt out with
`MYHACKINGPAL_ALLOW_PUBLIC_HOST=1` for Docker deployments only.

## Conventions

### Backend

- **Routers live in `backend/routers/<name>.py`**, register in
  `backend/main.py`'s `app.include_router(...)` block.
- **Use `MhpError` (from `lib.errors`) for application errors**, not
  raw `HTTPException`. The global handler turns it into a structured
  envelope (`{"error", "code", "extra"}`) and logs at WARNING.
- **Validate user input with Pydantic models on POST bodies**, not raw
  dicts. For string fields that get shelled out, add `Field(min_length=,
  max_length=, pattern=)` constraints. Use the helpers in `lib/validators.py`
  for hostnames / IPs / URLs / domains / ports.
- **Privileged endpoints add `Depends(require_local_auth)`** from
  `lib/auth.py`. Loopback-only routers can use `require_localhost`.
- **Subprocess shell-outs go through `asyncio.create_subprocess_exec`**
  with an argv list (never `shell=True`). Validate target tokens with
  `lib.validators` or a local regex before passing.
- **WS handlers follow a stop-signal convention** — accept
  `{"action": "stop"}` mid-stream, terminate the child process,
  emit a final `{"type": "done", "stopped": true}`. See
  `routers/port_scanner.py` as the canonical example.
- **Cross-platform code** uses `IS_DARWIN` / `IS_LINUX` / `IS_WINDOWS`
  from `lib.platform_util`, plus `require_darwin()` / `require_linux()`
  / `require_windows()` helpers that raise `MhpError` with
  `code=UNSUPPORTED, status_code=501`.

### Frontend

- **Every backend call goes through `api()` or `authFetch()` from
  `api.ts`** — never raw `fetch(${BACKEND_URL}/...)`. Those wrappers
  attach the `X-MHP-Token` header for you. The only exceptions are
  `<a href>` / `<img src>` URLs (browser navigation can't carry headers)
  and the bootstrap `/auth/token` fetch itself.
- **Every WebSocket goes through `openWs()` from `api.ts`** — appends
  the auth token as `?token=` since WS upgrades can't carry custom
  headers. Pages using `useAttackWS` (web-exploit family) get this for
  free.
- **Long-running scans close their WS on unmount.** Pattern:
  ```ts
  useEffect(() => () => {
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
  }, []);
  ```
- **Use the shared `RequestForm` + `useAttackWS`** in
  `components/webattack/` when adding a new web-exploit page — it
  brings the auth checkbox, scope guard, rate slider, and Stop button
  for free.
- **Engagement-aware behavior:** every successful `api()` call passes
  through `recordResultIfActive` (in `lib/engagement.ts`) so it
  auto-attaches to the active engagement. Pages opening WS connections
  that produce significant evidence should also call
  `recordResultIfActive` on the `done` event.
- **Error boundary** in `App.tsx` wraps the page slot — uncaught render
  errors show a contained fallback, not a whitescreen.

### Naming

- The internal sidecar binary is still named `network-tools-backend`
  (unchanged for build-pipeline simplicity). Only the user-facing
  branding is **MyHackingPal**. Bundle id: `com.myhackingpal.app`.

## The pivot — what it means for you when coding here

When adding or modifying anything, default to choices that reinforce
the engagement-first model:

1. **Tools that take a target should check engagement scope.** Currently
   most don't — that's the v1.0 critical path. If you're touching a
   target-accepting tool for any reason, leave a hook for the scope
   check even if you don't wire it up.
2. **Active checks should require explicit authorization.** Web-exploit
   pages already do this via `RequestForm.confirmAuth`. The AD / cloud
   / wireless attack pages don't yet — same fix pattern applies.
3. **Results auto-attach to the active engagement.** Don't add new
   "save to file" or "download CSV" flows without considering whether
   they should also feed the engagement's evidence timeline.
4. **AI suggestions become approval cards, not commands.** If you're
   working on `routers/chat.py` or `ChatBubble.tsx`, the trajectory is
   "AI proposes → user approves → app runs → AI summarizes". Don't add
   "AI runs the tool itself" features.
5. **Audit log everything.** New tools should write to the
   `audit_log` table (planned for v1.0) when they start, when they
   finish, and when they error. The table doesn't exist yet — design
   new work to be easy to plug in once it does.

## Dev workflow

Two terminals:

```sh
# Terminal 1 — backend (FastAPI on 8765, auto-reload)
cd backend && python3 -m uvicorn main:app --reload --port 8765

# Terminal 2 — frontend (Vite on 5173, then Electron)
cd frontend && npm install && npm run dev:all
```

`npm run dev:all` runs Vite + Electron concurrently. To run just the
browser frontend, `npm run dev` and open `http://localhost:5173`.

## Build / release

```sh
cd frontend
npm run dist:dir       # fast local — .app folder only (mac-arm64)
npm run dist:mac       # full Mac build — .app + .dmg + auto-updater metadata
npm run dist:win       # NSIS + portable .exe (run on Windows)
npm run dist:linux     # AppImage + .deb (run on Linux)
```

Tagged releases (`v*` push) trigger CI matrix → smoke tests → release
publish. See `.github/workflows/build.yml`. Auto-update wired via
electron-updater against GitHub Releases — works on Win/Linux
unsigned; Mac needs signing for the OS to accept the replacement
(see `docs/SIGNING.md`).

## Tests

There aren't any in-product yet. The `scripts/tests/test_network_tools.py`
suite covers the standalone CLIs in `scripts/`, not the FastAPI app.
**Test coverage is a v1.0 critical-path item** — when you add new
engagement / scope / audit code, write tests alongside it.

## Things to avoid

- **`shell=True` in subprocess calls.** Pass argv lists. Always.
- **Raw `fetch()` from the frontend.** Use `api()` / `authFetch()` /
  `openWs()`.
- **Bare `except:` blocks** in production routers. `except Exception:`
  is fine for best-effort fallbacks (file cleanup, log writes), but
  log the exception unless it's truly noise.
- **`assert`** for runtime checks — stripped under `python -O`. Use
  `if not X: raise ...`.
- **New on-disk credential storage.** API keys go in the OS keystore
  (Keychain on Mac). Engagement state goes in the SQLite engagements
  DB. Nothing else writes credentials to disk.
- **Adding tools without considering the engagement context.** It's
  fine to have standalone tools, but think about how they'd fit into
  a playbook before shipping.

## Mobile app (`mobile/`)

Flutter project. Package `dev.adamsjack.myhackingpal`.
`compileSdk=36`, `minSdk=24`.

Connects to backend via `http://<tailscale-ip>:8765`. `ApiService`
handles all HTTP + streaming. Cleartext allowed because traffic is
over Tailscale (encrypted).

Seven tools in v1: IP Checker, DNS Recon, WHOIS, TLS Audit,
Fingerprint, CT Logs, Email Security. Chat tab streams from
`/chat/stream` via SSE.

## Docker (`backend/Dockerfile` + `docker-compose.yml`)

`python:3.11-slim` base.

Bundled: nmap 7.95, tcpdump 4.99.5, dig, whois, openssl,
wireguard-tools.

Cloud SDKs: `boto3`, `azure-mgmt-*`, `google-cloud-*`. AD tooling:
`ldap3`, `impacket`, `bloodhound`. Skips macOS-only `pyobjc-*`
bindings.

Caps: `NET_RAW` + `NET_ADMIN` for raw socket tools.

macOS-only endpoints return 503 with a hint message. Linux-only
endpoints return 503 on macOS/Windows. `ANTHROPIC_API_KEY` env var
used instead of Keychain.

## Platform routing

`backend/lib/platform_util.py` owns all platform detection:

- `IS_DARWIN` / `IS_LINUX` / `IS_WINDOWS`
- `app_data_dir()` — cross-platform data directory
- `require_darwin()` / `require_linux()` / `require_windows()` —
  dependency helpers that return 503 on the wrong OS

Use `pathlib.Path` for all file paths, never string concat.

## Cross-platform CI

`.github/workflows/build.yml` runs on:

- `macos-latest` (Apple Silicon `.app`)
- `windows-latest` (NSIS installer + portable `.exe`)
- `ubuntu-latest` (x86_64 `.AppImage` + `.deb`)
- `ubuntu-24.04-arm` (arm64 `.AppImage`)

Windows CI smoke-tests 14 endpoints and verifies 501-guards don't
crash.

## Useful references

- [ROADMAP.md](ROADMAP.md) — direction + v1.0 critical path
- [SECURITY.md](SECURITY.md) — threat model + reporting
- [docs/SIGNING.md](docs/SIGNING.md) — code signing situation
- [docs/README-macos.md](docs/README-macos.md) — Mac install + Gatekeeper
- [docs/README-windows.md](docs/README-windows.md) — Windows install
- [docs/README-linux.md](docs/README-linux.md) — Linux install
