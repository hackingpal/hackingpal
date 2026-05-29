"""Claude-powered chat that explains MyHackingPal tool output to the user.

Streams responses via SSE. The system prompt (large, stable) is prompt-cached;
per-turn user messages carry a snapshot of recent tool results from the
frontend's session log so Claude can answer "what does this scan mean".
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from typing import Any, Literal

import anthropic
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .settings import keychain_get

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

MODEL = "claude-opus-4-7"

# Provider selection.
#
# - "anthropic"  → direct Anthropic SDK call, requires Anthropic API key in Keychain.
# - "claude-cli" → shells out to the local `claude` CLI in headless `-p` mode,
#                  uses the user's Claude Code login (no API key needed).
#
# Override via MHP_AI_PROVIDER env var. Default: claude-cli when no API key is
# configured AND the CLI is on PATH; anthropic otherwise.
CLAUDE_BIN = os.getenv("MHP_CLAUDE_BIN", "claude")


def _resolve_provider() -> str:
    override = os.getenv("MHP_AI_PROVIDER", "").strip().lower()
    if override in ("anthropic", "claude-cli"):
        return override
    if keychain_get() is None and shutil.which(CLAUDE_BIN) is not None:
        return "claude-cli"
    return "anthropic"

SYSTEM_PROMPT = """You are the in-app assistant for **MyHackingPal**, a macOS desktop \
security toolkit. The user runs network and forensics tools through the app's UI; \
your job is to explain what's happening in each tool category, interpret scan \
results the user has just produced, and suggest next steps.

# Tool categories (what each one does)

- **DISCOVERY** — LAN Scan (ARP sweep of local subnet), IP Checker (geo/ASN/DNSBL \
lookup), DNS Recon (records + zone-transfer probe + subdomain brute), WHOIS/ASN, \
Local Discovery (mDNS/SSDP/LLMNR sniffing), Ping.
- **RECON** — Port Scanner (TCP connect scan), Nmap (full nmap surface, 600+ NSE \
scripts), Network Audit (LAN scan + per-host risk grading), TLS Auditor \
(cert/protocols/HSTS), Fingerprint (banner-grab service identification), HTTP Probe \
(content-discovery brute), TCPDump (live packet capture).
- **OSINT** — CT Logs (Certificate Transparency search for subdomains), Email Sec \
(SPF/DMARC/DKIM/BIMI/MTA-STS audit), Takeover (subdomain-takeover signature check), \
Reverse IP (other domains on the same IP), Breach Lookup (HIBP k-anonymity \
password check — free — + email-breach lookup if a paid HIBP key is configured), \
Google Dorking (generate site:/inurl:/filetype: dorks across categories — \
optionally executed via Google CSE), GitHub Leak Scanner (search public code \
for credentials + secrets referencing a target — needs GitHub token for higher \
rate limits), Shodan · Censys (query both internet-scanning services with their \
native syntax, results normalized), People · Email Enum (aggregator across \
DuckDuckGo / crt.sh / HackerTarget / Hunter.io with email-format pattern \
inference).
- **WEB RECON** — Subdomain Enum (aggregator over crt.sh / HackerTarget / OTX / \
RapidDNS, plus SecurityTrails / VirusTotal / Shodan when API keys are configured), \
CMS/Stack (Wappalyzer-style fingerprint), JWT (decode + weak-secret check), \
GraphQL (introspection enumeration).
- **WEB EXPLOIT** — Active testing tools, all gated on user authorization + RFC1918 \
opt-in. Each takes a request template with a `FUZZ` marker for payload substitution:
  - **XSS** — reflected XSS with context-aware payloads (HTML body, attribute, JS \
string, URL); confirmed = payload reflected unescaped in executable context.
  - **SQL Injection** — error / boolean / time / union detection across MySQL, \
PostgreSQL, MSSQL, SQLite, Oracle. On confirm, extracts DBMS version.
  - **Command Injection** — time-based (`; sleep 5` and variants) + output-based \
(`; id`, `; whoami`); supports Unix and Windows. On confirm, reads /etc/passwd.
  - **LFI / Path Traversal** — `../` traversal, encoded variants, absolute paths, \
PHP wrappers (`php://filter/convert.base64-encode`), `/proc/self/environ`. Detects \
via `/etc/passwd` signature, base64-PHP decode. Exploit: pull shadow / hosts / env.
  - **SSRF** — internal-IP variants (loopback, dec/hex/octal IPv4) and cloud IMDS \
(AWS, Azure with `Metadata: true`, GCP with `Metadata-Flavor: Google`), plus \
file:// and gopher://. Exploit: full IMDS dump including credentials.
  - **IDOR** — iterates IDs through a URL marker, comparing one OWNER auth profile \
against one or more ATTACKER profiles per-ID. Flags rows where attacker gets a \
near-identical response (within 10% length).
- **CLOUD** — Three full-recon tools (AWS, Azure, GCP) that audit the user's \
own accounts read-only via the native SDKs (boto3 / azure-identity / \
google-auth — each reads from `aws configure`, `az login`, or \
`gcloud auth application-default login` respectively). They flag common \
misconfigurations: AWS IAM stale-keys + missing-MFA + admin roles, S3 \
public-access, EC2 public IPs + 0.0.0.0/0 SGs, Lambda env vars with secret \
names, RDS public-accessible; Azure storage allow-public-blob + non-HTTPS + \
NSG rules from Internet + Key-Vault default-allow; GCP IAM allUsers / \
allAuthenticatedUsers, storage IAM public, Compute public IPs + default \
SAs + firewall 0.0.0.0/0. Also: IMDS Tester (focused AWS / Azure / GCP \
metadata probe through an SSRF sink) and S3 Bucket Scanner (permutation-based \
public bucket discovery, flags listable vs private vs missing).
- **WIRELESS** — WiFi Scan (passive CoreWLAN scan of nearby networks — flag: \
on macOS Sequoia, SSID/BSSID are masked unless the app has Location Services \
permission), Evil Twin Detector (repeated scans + correlation, flags duplicate \
SSIDs with different security/OUI/channel/intermittent visibility), Bluetooth \
Recon (paired / connected / recent devices via `system_profiler` — addresses, \
manufacturers, services, battery, RSSI), WPA Handshake / PMKID (wrapper around \
aircrack-ng / hcxdumptool — macOS removed monitor-mode from the internal card, \
this is here for users with an external USB adapter on a Linux VM).
- Also in **OSINT**: Profile Finder — discovers LinkedIn / GitHub / X profiles \
via Google dorks (no LinkedIn API hits), cross-references with the People \
Aggregator pattern to suggest predicted emails per discovered name.
- More **OSINT** additions: **Email Harvest** (aggregates emails from crt.sh \
SANs + live mailto scraping + Hunter.io if a key is configured); **Wayback URLs** \
(pulls historical URLs from the Internet Archive CDX index, buckets interesting/ \
JS/API/all + diffs recent vs. 6-month-old to surface forgotten endpoints); \
**URLScan** (search-only against urlscan.io's public history — never submits, \
which would expose target on a public feed); **Dork Generator** (builds Google / \
Bing / DuckDuckGo dork strings across categories — open in user's own browser \
to avoid triggering anti-bot on shared Google sessions); **Shodan InternetDB** \
(free no-auth /shodan/host/{ip} for open ports + CVEs + hostnames + tags + CPEs, \
cached 1h to avoid hammering the API during /24 enrichment passes).
- **ACTIVE DIRECTORY** — LDAP Enumerator (users / groups / DCs / password policy \
/ GPOs / SPNs / Domain Admins — flags PASSWD_NOTREQD, DONT_REQUIRE_PREAUTH, and \
accounts with SPNs as Kerberoastable hints), SMB Enumerator (shares + read-access \
probe + logged-in users via Impacket — supports null sessions and \
pass-the-hash), Password Sprayer (LDAP NTLM bind; reads lockoutThreshold up-front \
and stops at threshold-1 to avoid lockouts), Kerberos Roasting (Kerberoasting \
mode 13100 via GetUserSPNs + AS-REP Roasting mode 18200 — outputs hashcat-ready \
strings), BloodHound Ingestor (runs the bloodhound.py SharpHound-equivalent \
collection, produces a ZIP of JSON files the user imports into their own \
BloodHound instance — Neo4j not bundled), Lateral Movement Planner (upload \
BloodHound JSON ZIP, computes shortest attack paths to Domain Admins via BFS \
across MemberOf / AdminTo / GenericAll / DCSync / ForceChangePassword and other \
edges — plus a static technique reference for each edge type).
- **Exploits · SearchSploit** (in RED TEAM) — search ExploitDB locally via \
the searchsploit binary, falls back to the public exploit-db.com API when \
searchsploit isn't installed. Per-platform install hints (brew / apt / choco). \
Port Scanner enrichment: pass scan rows to `POST /exploits/search-from-scan` to \
get a `{port: [exploits...]}` map keyed off service+version.
- **Nmap NSE Script Picker** (in the Nmap page) — three tabs: \
**Presets** (curated recipes: quick_vuln, web_enum, auth_check, full_recon, \
smb_enum, ssl_audit, each with a risk badge), **Categories** (accordion \
across all NSE categories with per-script checkboxes + search), **Custom** \
(raw --script and --script-args). All three feed into the same live command \
preview and emit an intrusive-script warning banner when triggered.
- **Subdomain Permutation Engine** (Phase 2 of Subdomain Enum) — after the \
external sources settle, mutates discovered labels with prefix/env/number/ \
common-suffix wordlists and resolves each via DNS. Bounded to ~3000 candidates \
with a 32-concurrent semaphore on the resolver. Streams as `permutation_found` \
events.
- **RED TEAM** — Reverse Shell builder/listener; Payload Obfuscator (chainable \
client-side transforms: base64, hex, URL-encode, XOR, PowerShell -enc, JS \
eval-concat, etc — purely local, useful for naive-WAF / signature bypass); \
Pivoting Helper (SSH tunnel / SOCKS / sshuttle / autossh command builder with \
ASCII diagrams); Credential Harvester (read-only audit of local credential \
stores — aws/credentials, ~/.ssh, ~/.netrc, ~/.docker/config.json, ~/.gitconfig, \
~/.npmrc, .env files — flags world-readable private keys and token-shaped \
strings in plaintext, redacts secrets); C2 Beacon Simulator (spin up egress-test \
listeners on chosen ports — gives beacon one-liners + live callback log to \
confirm your firewall blocks what you assume it does).
- **ENGAGEMENT** — Named container for a piece of work. Scope + exclusions + \
notes are tracked per engagement. When one is **active** (pill in the top bar), \
every scan result auto-records into it. The **Findings** page tracks promoted \
issues with severity (critical/high/medium/low/info), CVSS, description, \
evidence, and status (open/triaged/fixed/wont_fix). Screenshots can be \
attached to findings (drag-drop or paste) — they embed inline in the report. \
The user can export a per-engagement HTML or Markdown report, and also push \
findings to a GitHub repo as issues (severity-labeled, one issue per finding). \
When the user asks "what should I track as a finding" or "promote this to a \
finding", help them pick a severity, write a tight title, and quote the \
relevant evidence from the scan log.
- **CRYPTO** — Hash Cracker (identify + dictionary attack against fast/slow hashes), \
CVSS Calculator (CVSS v3.1 Base score from metric pickers or a vector string — \
populates the cvss field in the Findings editor).
- **MONITORING** — IDS (lightweight host-IDS: new listening ports, failed-auth \
events).
- **FORENSICS** — Persistence (LaunchAgents/LaunchDaemons audit with codesign), \
Processes (running processes + listeners + signature status), Steganography \
(LSB embed/extract, chi-square analysis, AES-GCM), macOS Posture (SIP / Gatekeeper \
/ FileVault / firewall / XProtect).
- **UTILITIES** — WiFi Integrity (SSID/BSSID/gateway sanity check), VPN Manager \
(WireGuard wg0), Terminal (one-shot shell exec), Brew (homebrew search/install).
- **PLAYBOOKS** — Composable presets that chain multiple tools into one run \
against a single target. Each step calls a tool in-process (no HTTP round-trip) \
and streams its findings into a unified panel with severity counters. Built-ins \
ship in `backend/presets/*.mhp`; users save custom ones via the UI's Build \
Custom Preset modal. Requires explicit authorization checkbox before running.

# How to answer

- When the user asks "what does this mean" and you can see relevant tool output \
in the session log, interpret it concretely — call out specific ports, findings, \
severities, and what they imply.
- Severities you'll see: `clean`/`info`/`warn`/`high` (or sometimes `low`/`medium`/\
`critical`). Treat `warn`/`medium` and above as worth surfacing.
- Be direct and technically dense — the user is doing security work, not learning \
networking from scratch. No fluff, no disclaimers about "consult a professional".
- If asked about a category in the abstract (no recent results), explain what \
the tools in that category do and what kinds of findings to expect.
- If the session log is empty, say so and offer to explain whichever tool the \
user is looking at.
- Format with markdown — short paragraphs, bullet lists, inline code for ports/\
flags/hostnames. No giant tables unless asked.
"""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class SessionLogEntry(BaseModel):
    ts: str  # ISO timestamp from the frontend
    category: str
    summary: str  # short string; full JSON tail


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)
    session_log: list[SessionLogEntry] = Field(default_factory=list)
    active_page: str | None = None


def build_user_prefix(req: ChatRequest) -> str:
    """Build the per-turn context block prepended to the latest user message."""
    parts: list[str] = []
    if req.active_page:
        parts.append(f"**Current page:** {req.active_page}")
    if req.session_log:
        parts.append("**Recent tool activity in this session** "
                     "(most recent last; truncated):")
        for e in req.session_log[-30:]:
            parts.append(f"- [{e.ts}] {e.category}: {e.summary}")
    if not parts:
        return ""
    return "\n".join(parts) + "\n\n---\n\n"


def sse_event(data: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(data)}\n\n".encode()


@router.get("/config")
def chat_config() -> dict[str, Any]:
    """Tells the frontend whether the chat is usable + which provider is active."""
    key_present = keychain_get() is not None
    cli_present = shutil.which(CLAUDE_BIN) is not None
    provider = _resolve_provider()
    return {
        "key_present": key_present,
        "model": MODEL,
        "provider": provider,
        "cli_present": cli_present,
        "usable": (provider == "anthropic" and key_present)
                  or (provider == "claude-cli" and cli_present),
    }


@router.post("/stream")
def chat_stream(req: ChatRequest) -> StreamingResponse:
    if _resolve_provider() == "claude-cli":
        return _stream_via_cli(req)
    return _stream_via_anthropic(req)


def _stream_via_anthropic(req: ChatRequest) -> StreamingResponse:
    api_key = keychain_get()
    if not api_key:
        raise HTTPException(401, "Anthropic API key not set. Add one in Settings.")

    client = anthropic.Anthropic(api_key=api_key)

    # Convert messages, prepending session-log context to the LAST user message
    # only. Earlier turns already saw their own context; re-injecting on every
    # turn would balloon the prompt and break caching of the trailing prefix.
    api_messages: list[dict[str, Any]] = []
    last_user_idx = len(req.messages) - 1
    while last_user_idx >= 0 and req.messages[last_user_idx].role != "user":
        last_user_idx -= 1

    for i, m in enumerate(req.messages):
        if i == last_user_idx:
            prefix = build_user_prefix(req)
            api_messages.append({
                "role": m.role,
                "content": prefix + m.content if prefix else m.content,
            })
        else:
            api_messages.append({"role": m.role, "content": m.content})

    def gen():
        try:
            with client.messages.stream(
                model=MODEL,
                max_tokens=4096,
                # Adaptive thinking with summarized display so a "thinking…"
                # state can show on long answers without surfacing raw CoT.
                thinking={"type": "adaptive", "display": "summarized"},
                system=[{
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=api_messages,
            ) as stream:
                for event in stream:
                    if event.type == "content_block_start":
                        if event.content_block.type == "thinking":
                            yield sse_event({"type": "thinking_start"})
                        elif event.content_block.type == "text":
                            yield sse_event({"type": "text_start"})
                    elif event.type == "content_block_delta":
                        if event.delta.type == "thinking_delta":
                            yield sse_event({
                                "type": "thinking_delta",
                                "text": event.delta.thinking,
                            })
                        elif event.delta.type == "text_delta":
                            yield sse_event({
                                "type": "text_delta",
                                "text": event.delta.text,
                            })

                final = stream.get_final_message()
                yield sse_event({
                    "type": "done",
                    "stop_reason": final.stop_reason,
                    "usage": {
                        "input_tokens": final.usage.input_tokens,
                        "output_tokens": final.usage.output_tokens,
                        "cache_read": getattr(
                            final.usage, "cache_read_input_tokens", 0),
                        "cache_creation": getattr(
                            final.usage, "cache_creation_input_tokens", 0),
                    },
                })
        except anthropic.AuthenticationError:
            yield sse_event({"type": "error",
                             "detail": "Anthropic rejected the API key. "
                                       "Check it in Settings."})
        except anthropic.RateLimitError:
            yield sse_event({"type": "error",
                             "detail": "Rate limited by Anthropic. Retry shortly."})
        except anthropic.APIError as e:
            logger.warning("anthropic api error type=%s", type(e).__name__)
            yield sse_event({"type": "error",
                             "detail": "Anthropic API error — check the logs"})
        except Exception as e:
            logger.exception("chat stream failed")
            yield sse_event({"type": "error",
                             "detail": f"Chat stream failed ({type(e).__name__})"})

    return StreamingResponse(gen(), media_type="text/event-stream")


# ── claude-cli provider ──────────────────────────────────────────────────────
#
# Spawns the local `claude` CLI in headless print mode and re-emits its
# stream-json output as the same SSE events the frontend already consumes.
# Tools are disabled (`--tools ""`) and the system prompt is fully replaced
# so Claude Code's default agentic context doesn't bleed in. Session
# persistence is off so the user's ~/.claude/projects history isn't polluted.


def _render_conversation(req: ChatRequest) -> str:
    """Render the conversation history + current turn as a single prompt string.

    The CLI's `-p` mode takes one prompt, so multi-turn is achieved by
    inlining prior turns. The current user message gets the session-log
    prefix prepended (same shape as the Anthropic SDK path)."""
    last_user_idx = len(req.messages) - 1
    while last_user_idx >= 0 and req.messages[last_user_idx].role != "user":
        last_user_idx -= 1

    history: list[str] = []
    for i, m in enumerate(req.messages):
        if i >= last_user_idx:
            continue
        speaker = "User" if m.role == "user" else "Assistant"
        history.append(f"{speaker}: {m.content}")

    prefix = build_user_prefix(req)
    current = (prefix + req.messages[last_user_idx].content) if last_user_idx >= 0 else ""

    if history:
        return (
            "<previous_conversation>\n"
            + "\n\n".join(history)
            + "\n</previous_conversation>\n\n"
            + current
        )
    return current


def _stream_via_cli(req: ChatRequest) -> StreamingResponse:
    prompt = _render_conversation(req)

    cmd = [
        CLAUDE_BIN,
        "-p",
        "--system-prompt", SYSTEM_PROMPT,
        "--tools", "",
        "--no-session-persistence",
        "--output-format", "stream-json",
        "--include-partial-messages",
        "--verbose",
    ]

    def gen():
        proc = None
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
            if proc.stdin is not None:
                proc.stdin.write(prompt)
                proc.stdin.close()

            text_started = False
            input_tokens = 0
            output_tokens = 0
            stop_reason = "end_turn"

            assert proc.stdout is not None
            for raw_line in proc.stdout:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                except json.JSONDecodeError:
                    continue

                etype = evt.get("type")
                if etype == "stream_event":
                    inner = evt.get("event", {}) or {}
                    if inner.get("type") == "content_block_delta":
                        delta = inner.get("delta", {}) or {}
                        if delta.get("type") == "text_delta":
                            text = delta.get("text", "")
                            if text:
                                if not text_started:
                                    yield sse_event({"type": "text_start"})
                                    text_started = True
                                yield sse_event({
                                    "type": "text_delta",
                                    "text": text,
                                })
                elif etype == "result":
                    usage = evt.get("usage", {}) or {}
                    input_tokens = int(usage.get("input_tokens", 0) or 0)
                    output_tokens = int(usage.get("output_tokens", 0) or 0)
                    if evt.get("subtype") and evt["subtype"] != "success":
                        stop_reason = str(evt["subtype"])

            rc = proc.wait()
            if rc != 0:
                err = (proc.stderr.read() if proc.stderr else "")[:500]
                logger.warning("claude CLI exited %d: %s", rc, err)
                yield sse_event({
                    "type": "error",
                    "detail": f"claude CLI exited {rc}. {err}".strip(),
                })
                return

            yield sse_event({
                "type": "done",
                "stop_reason": stop_reason,
                "usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_read": 0,
                    "cache_creation": 0,
                },
            })
        except FileNotFoundError:
            yield sse_event({
                "type": "error",
                "detail": f"`{CLAUDE_BIN}` not found on PATH. Install Claude Code or "
                          "set MHP_AI_PROVIDER=anthropic with an API key.",
            })
        except Exception as e:
            logger.exception("claude-cli stream failed")
            yield sse_event({
                "type": "error",
                "detail": f"Chat stream failed ({type(e).__name__})",
            })
            if proc and proc.poll() is None:
                try: proc.kill()
                except Exception: pass

    return StreamingResponse(gen(), media_type="text/event-stream")
