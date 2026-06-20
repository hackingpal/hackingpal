# Roadmap

This file is the source of truth for project direction. The repo's
README has a short summary; this document has the rationale.

## The pivot

HackingPal is pivoting from a **cybersecurity tool dashboard** to an
**AI-assisted security testing workspace for authorized engagements**.

The old framing:

> "Click a tool. Run it. Look at the output."

The new framing:

> "Run a real security assessment from start to finish — scope it,
> work through a playbook, save evidence, generate a report."

The engagement becomes the center of the app. Tools still exist and
still work standalone (in Lab mode), but the product is the workflow
around them, not the tools themselves.

## The flow

```
Engagement → Targets → Playbook → Tools → Evidence → Reports
```

Every active check happens inside one of those engagements. The AI is
a copilot inside the flow — it suggests next steps, summarizes results,
drafts reports — but never executes attacks on its own. Every active
check waits for human approval.

## Safety controls (v1.0 critical path)

The pivot only works if the safety controls are real. The v1.0 plan
treats this list as load-bearing, not a wishlist:

- **Scope allowlist** — engagement scope is enforced by every
  target-accepting tool, not just stored as metadata
- **Authorization confirmation** — every active check requires an
  explicit "I have authorization to test this target" before sending
- **Command preview** — show the exact argv / HTTP request before
  shelling out; user approves
- **AI suggestion → human approval** — the chat assistant proposes
  next checks as approval cards, not as commands
- **Rate limits** — per-tool throttling, defaults chosen to not
  trigger WAFs / IDSes accidentally
- **Stop / kill button** — every long-running scan is interruptible
- **Audit log** — append-only record of every action (tool, target,
  argv, approver, timestamp, result) feeds the report
- **Evidence tracking** — every result auto-attaches to the active
  engagement; screenshots, scan output, command transcripts, chat
  turns all on a unified timeline
- **Lab mode vs Engagement mode** — explicit toggle. Lab mode skips
  scope checks and approval gates so you can experiment freely against
  your own targets. Engagement mode is real-work mode.

The plan is one binary with both modes — not two forks. Lab is the
default; Engagement mode is opted into for authorized work.

## AI: copilot, not autopilot

What the AI **should** do:

- Explain results in plain English
- Suggest the next reasonable check given what's been seen
- Summarize a long scan output into a one-line finding
- Help follow playbook steps
- Draft report sections
- Queue actions for human approval

What the AI **must not** do:

- Run hidden commands
- Attack targets automatically
- Expand scope on its own
- Bypass approval gates
- Execute arbitrary shell commands without user review

The flow is always: AI suggests → user approves → app runs the action
→ output is logged to the audit log + engagement evidence → AI
summarizes.

## Platform strategy

v1.0 is intentionally **macOS + Linux + Docker first**. Windows is not deleted, but it is no longer a release blocker. Treat native Windows as experimental/deferred until the engagement workflow, safety controls, and Docker/server mode are stable.

- **macOS** — primary polished desktop baseline
- **Linux** — security-lab and power-user desktop baseline
- **Docker** — lab/server/remote backend mode for trusted networks
- **Windows** — experimental; keep guards/501 responses clean, but do not spend v1.0 time chasing parity

The codebase should still keep platform-specific logic behind adapters/helpers so Windows can be added later without rewriting the product.

## Release strategy

The plan is staged, not "1.0 to the world day one":

1. **Private** — daily-driver for the maintainer
2. **Trusted testers** — friends doing real engagements
3. **Public lab version** — same binary, Lab mode default-on,
   conservative defaults, no auto-update to riskier modes
4. **Verified / pro version** — same binary, Engagement mode enabled,
   signed builds, real-engagement defaults
5. **Organization / team** — multi-user engagements, shared scope,
   centralized audit log

The public lab version should focus on the safer features:

- Local security checks (posture audits, persistence enumeration)
- Home lab inventory
- DNS / TLS / header / CT-log checks
- Passive recon
- Evidence tracking
- Report generation
- AI explanations

Active checks (web exploit, AD attacks, cloud enumeration) stay
behind the Engagement mode toggle.

## What this is not

This isn't trying to replace a human red teamer. The automation
handles repetitive checks (port scans, posture audits, OSINT
enumeration, evidence collection) — but judgment, scope decisions,
strategy, false-positive triage, finding-chaining, business-impact
reasoning, and stakeholder communication remain with the human
operator. The product is "make the human faster and more thorough",
not "replace the human".

## v1.0 critical path

In order:

0. **Platform focus** — ship v1.0 as macOS + Linux + Docker. Keep Windows experimental/deferred and clearly marked in README/docs.
1. **Scope enforcement** — helper in `backend/lib/`, wire into every
   target-accepting tool. Without this, "Engagement mode" is decoration.
2. **Lab mode vs Engagement mode toggle** — context provider in the
   frontend, persisted flag, plumbed to scope-check helper.
3. **Authorization checkbox** on the remaining attack tools
   (AdSpray, S3Scanner, SubdomainEnum, Takeover, KerberosRoast,
   BloodHound, LateralMove). The web-exploit pages already gate via
   RequestForm.confirmAuth; these don't.
4. **Engagement-centric default page** — App.tsx currently lands on
   IP Checker. Should land on the Engagements list (or an Engagement
   Dashboard if one is active).
5. **Docker/server-mode hardening** — document Tailscale/VPN-only deployment, reverse-proxy auth, API-token expectations, and warning banners before promoting Docker beyond lab use.
6. **Audit log table** — `audit_log` in the engagements SQLite, helper
   in `lib/`, surfaced in a new `/audit` page and in the report.
7. **Settings page** — in-app key management, mode toggle, sudoers
   cleanup, health check.
8. **Test suite seed** — pytest + Vitest, starting with the
   engagement / scope / audit machinery (the newest, most
   consequential code is also the least-tested).
9. **CLAUDE.md** — codifies all of the above so future contributors
   (and AI agents) start aligned. *(Done — see [CLAUDE.md](CLAUDE.md).)*

Roughly 10-12 days of focused work to clear the critical path.

## v1.x — copilot, not autopilot

Once the engagement workflow is solid:

- **AI suggestion → approval card UX** — chat suggests "run nmap
  --top-ports 100 on 10.0.0.5", appears in UI as an approval card with
  [Approve] / [Skip] / [Modify] buttons; only runs on Approve.
- **Playbook redesign** — current Presets system runs a fixed
  sequence. Real playbooks: guided multi-step flows where the AI
  explains why each step matters, the user approves each, evidence
  auto-attaches, the report writes itself.
- **Command preview / dry-run** — before any subprocess, the UI shows
  the exact argv + target list; user clicks Approve.
- **Formalized evidence model** — unified "evidence" type (scan
  output, screenshots, command transcripts, chat turns) all on the
  engagement timeline.
- **Code-signed Mac (Developer ID + notarization)** — needed for auto-updates to actually work on Mac. Linux signing/package trust can follow. Windows signing is deferred with native Windows support. See [docs/SIGNING.md](docs/SIGNING.md) for cost + setup.
- **AI provider abstraction** — keep Claude as the first provider, but design the app so Gemini, OpenAI-compatible endpoints, or local models can be added without rewriting the assistant.
- **Coverage matrix** — show what has and has not been checked for the active engagement: DNS, TLS, headers, services, auth/session, evidence, findings, report sections.

## Beyond v1.x

- Community playbook library — share `.mhp` playbooks as a git repo
- iOS companion app (Swift) — quick-lookup tools + chat, mirroring
  the existing Flutter Android companion
- Plugin / custom tool API — let users add their own tools without
  modifying the app
- NGFW integrations (pfSense, OPNsense, Palo Alto) — pull rule sets
  + connection logs into the audit timeline

## What's deliberately out of scope

- **Automated attack chaining** — the AI never decides "the next
  step is to exploit this, so I'll go do that". Always human-approved.
- **Cloud telemetry / crash reporting** — security-tool audience.
  If we ever add it, opt-in only.
- **Auto-scope expansion** — the AI cannot add targets to the
  engagement. Only the human can.
