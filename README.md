<p align="center">
  <img src="docs/brand/icon.png" alt="HackingPal" width="120" height="120" />
</p>

<h1 align="center">HackingPal</h1>

<p align="center"><em>The AI-assisted security workbench for authorized, accountable engagements.</em></p>
<p align="center"><em>Human-approved actions. Full audit trail. Client-ready reports. Local. Offline-first. Open source.</em></p>

<p align="center">
  <strong><a href="https://hackingpal.dev">hackingpal.dev</a></strong>
</p>

<p align="center">
  <a href="https://hackingpal.dev"><img src="https://img.shields.io/badge/website-hackingpal.dev-accent" alt="Website" /></a>
  <a href="https://github.com/hackingpal/hackingpal/releases/latest"><img src="https://img.shields.io/github/v/release/hackingpal/hackingpal?label=release" alt="Release" /></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux-blue" alt="Platforms" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License" />
  <img src="https://img.shields.io/badge/AI-bring%20your%20own%20key-lightgrey" alt="AI: bring your own key" />
</p>

<!-- DEMO GIF — drop in once recorded (see /launch/checklist).
     Suggested 30–60s flow: open app → start a playbook → promote a
     result to a finding → score CVSS → export the report. -->

<p align="center">
  <img src="docs/brand/demo.gif" alt="HackingPal — engagement → playbook → finding → CVSS → report" />
</p>

---

## Why HackingPal

**It runs a whole engagement, not just isolated tools.** Most security tooling
hands you a port scanner, a fuzzer, a hash cracker — and a stack of disconnected
output to glue together yourself. HackingPal is built around the engagement: a
named, scoped container for a single piece of work. Targets are first-class.
Playbooks chain tools. Every scan result auto-attaches to the active engagement
as evidence. The end of the workflow is a report, not a folder of CSVs.

**Every action is human-approved and logged — copilot, not autopilot,
deliberately.** A Claude-powered assistant watches the session, helps interpret
output, drafts text for findings, and suggests next steps. It does not run
tools on its own. Every active check waits for explicit human go-ahead, every
scan start/finish/error writes to an append-only audit log, and every sudoers
grant the app holds can be revoked in one click. The AI is there to make you
faster, not to take you out of the loop. That's a design choice, not a
limitation — accountable testing is the point.

**It produces a real report at the end.** Promote any result to a tracked
finding. Score it with the built-in CVSS v3.1 calculator (the band drives the
badge across the whole app). Attach evidence items with capture timestamps —
scan output, request/response pairs, analyst notes, screenshots, commands —
each marking when the proof was observed. When you're done, export a
client-ready report in Markdown or PDF: executive summary, severity counts,
every finding with its CVSS vector and full evidence timeline, methodology,
and the authorized-testing disclaimer. The executive summary is
template-rendered, so reports generate with no API key configured.

```
Engagement → Targets → Playbook → Tools → Evidence → Report
```

---

## Quick install

### macOS (Apple Silicon) — primary target

[**Download HackingPal-macos-arm64.dmg →**](https://github.com/hackingpal/hackingpal/releases/latest/download/HackingPal-macos-arm64.dmg)

Mount the DMG, drag the app to `/Applications`, then first-launch via right-click
→ **Open** (the build is unsigned — no paid Apple Developer cert yet).
Subsequent launches work normally.

### Linux (x86_64)

[**Download HackingPal-linux-x86_64.AppImage →**](https://github.com/hackingpal/hackingpal/releases/latest/download/HackingPal-linux-x86_64.AppImage)

`chmod +x` and run.

### Docker (backend API only)

```sh
git clone https://github.com/hackingpal/hackingpal.git
cd hackingpal && docker compose up -d
curl http://127.0.0.1:8765/health
```

Per-platform install guides: [macOS](docs/README-macos.md) ·
[Linux](docs/README-linux.md) · [Windows (experimental)](docs/README-windows.md).
See [docs/SIGNING.md](docs/SIGNING.md) for the current code-signing status.

> macOS and Linux are the actively maintained targets. Windows builds appear
> in CI but parity is not a v1.0 commitment. Use Docker or the macOS/Linux
> builds for serious work.

---

## The AI assistant is optional

HackingPal works without an Anthropic key. Open **Settings → API keys** to
add one and unlock the copilot — it'll watch the session, interpret tool
output, draft finding summaries, and help with the report. Without a key:

- Every tool still runs.
- Findings still track, CVSS still scores, evidence still timelines.
- The report exporter still works — the executive summary is template-based,
  not LLM-generated.

The roadmap keeps the provider layer flexible. Local-model and cheaper-provider
support are on the list.

---

## Safety & authorization

This is testing software. It bundles port scanners, vulnerability probes,
web-application attack modules, credential testers, network capture, cloud and
Active Directory enumeration — useful in legitimate engagements, illegal to
point at infrastructure you don't own or have written permission to test.

By installing or running HackingPal you agree to use it only for authorized
work: your own systems, CTFs, training labs, or engagements with explicit
written authorization. The full disclaimer is at [DISCLAIMER.md](DISCLAIMER.md).

Active checks (XSS, SQLi, command injection, SSRF, IDOR, LFI, password
spraying, Kerberos roasting, exploit launches) are gated behind a per-tool
authorization checkbox and scope-policy guard. The engagement's scope is the
fence; targets outside it are rejected with a clear refusal, not a runtime
error.

The audit log is the trust anchor — every action is recorded, durably, with
the engagement it belonged to.

---

## What's inside

The tool library lives _inside_ engagements; it is the resource the workflow
calls into, not the product itself. ~75 tools across:

- **Discovery** — LAN Scan, IP Checker, DNS Recon, WHOIS/ASN, Local Discovery
  (mDNS/SSDP/LLMNR), Ping.
- **Recon** — Port Scanner, Nmap (full 612-NSE-script surface, multi-target,
  SYN/UDP/OS), Network Audit, TLS Auditor, Fingerprint, HTTP Probe, TCPDump.
- **OSINT** — CT Logs, Email Sec (SPF/DMARC/DKIM), Subdomain Takeover, Reverse
  IP, Breach Lookup, Dorking, GitHub Leak Scanner, Shodan/Censys, People/Email
  Enum, Profile Finder, Wayback URLs, URLScan.
- **Web exploit** — XSS, SQLi, Command Injection, LFI, SSRF, IDOR — each
  gated by authorization checkbox + scope guard.
- **Cloud** — AWS / Azure / GCP read-only recon (boto3 / azure-identity /
  google-auth), IMDS tester, S3 bucket scanner.
- **Active Directory** — LDAP enumerator, SMB enumerator, password sprayer,
  Kerberos roasting, BloodHound ingestor, lateral movement planner.
- **Wireless** — WiFi Scan, Evil Twin detector, Bluetooth recon, WPA / PMKID
  handshake capture.
- **Red Team** — Reverse Shell builder/listener, payload obfuscator, pivoting
  helper, credential harvester, C2 beacon simulator, SearchSploit.
- **Forensics & posture** — Persistence audit, process inspector, steganography
  (LSB embed/extract, chi-square detector, AES-GCM), macOS / Linux / Windows
  posture, firewall rules, systemd units, users audit.
- **Engagement layer** — Findings Tracker, CVSS v3.1 Calculator, multi-item
  evidence timeline with capture timestamps, audit log, report exporter.
- **Playbooks** — composable presets that chain tools across phases. Built-ins
  include external red team, internal network, web app assessment, AD kill
  chain, AWS assessment, WiFi/physical, container/k8s escape, bug-bounty
  stealth, and a compromise assessment.

A more detailed catalogue with endpoints + acceptance criteria lives in
[ROADMAP.md](ROADMAP.md) and the per-page docs.

---

## Architecture

Hybrid **Electron + React + TypeScript** frontend with a bundled
**FastAPI + Python** sidecar that owns all the network / forensics /
exploitation logic.

```
hackingpal/
├── backend/        FastAPI server — ~75 routers
│   ├── lib/        engagement, audit_log, cvss, report, target_policy, ...
│   ├── routers/    one router per tool surface
│   └── main.py     loopback-only startup guard + per-launch auth token
└── frontend/
    ├── electron/   main + preload (Electron host)
    └── src/
        ├── pages/         one .tsx per sidebar entry
        ├── components/    Sidebar, ChatBubble, EngagementPill, ...
        └── lib/           engagement state, sessionLog, theme, nav
```

Backend listens on **127.0.0.1:8765** only. The startup guard refuses to bind
a wildcard host. Every privileged endpoint is gated by `Depends(require_local_auth)`
plus a per-launch token. Streaming routers follow a uniform WS protocol with a
`{"action":"stop"}` abort message. Credentials live in the OS keystore
(Keychain / Secret Service / Credential Manager) — nothing else writes
credentials to disk. The audit log is append-only and is the trust anchor for
every report.

Full developer guide: [CLAUDE.md](CLAUDE.md). Security model:
[SECURITY.md](SECURITY.md).

---

## Development

Two terminals:

```sh
# Terminal 1 — backend (FastAPI on 8765, auto-reload)
cd backend && python3 -m uvicorn main:app --reload --port 8765

# Terminal 2 — frontend (Vite + Electron)
cd frontend && npm install && npm run dev:all
```

Run only the browser frontend with `npm run dev` and open
`http://localhost:5173`. Build a release with `npm run dist:mac` (or
`dist:linux`); CI matrix builds + tagged releases live in
[`.github/workflows/build.yml`](.github/workflows/build.yml).

Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE). HackingPal is open source, free to use for authorized work,
and offered without warranty. Please read [DISCLAIMER.md](DISCLAIMER.md) and
[SECURITY.md](SECURITY.md) before pointing it at anything.

---

<p align="center">
  <code>>;)</code> &nbsp; HackingPal
</p>
