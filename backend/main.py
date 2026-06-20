"""FastAPI app entrypoint for the Network Tools backend.

In dev:   uvicorn main:app --reload --port 8765 --host 127.0.0.1
In prod:  Electron spawns this as a sidecar process on app start, pinned
          to 127.0.0.1 via NT_BACKEND_HOST (see frontend/electron/main.cjs).

Security: this backend MUST NOT be exposed to the network. It executes
shell commands, installs sudoers entries, and toggles the WireGuard
tunnel — all gated by loopback-only binding plus a per-launch token
(see backend/lib/auth.py). The startup guard below refuses to run if
NT_BACKEND_HOST or HOST is set to a wildcard address.
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from lib import errors as mhp_errors
from lib import logging_setup
from lib.auth import AUTH_TOKEN, require_localhost

from routers import (
    ad_spray, audit, audit_log, aws_recon, azure_recon, basic_check,
    bloodhound_ingest, breach, brew, bt_recon, c2_beacon, chat, cmdi, cms,
    cred_harvest, ct_log, cvss, dns_recon, dorking, email_harvest, email_security,
    engagements, evil_twin, exploits, findings, fingerprint, gcp_recon, github_leak,
    graphql, hash_cracker, http_probe, ids, idor, imds, ip_checker,
    jwt_analyzer, kerberos_roast, labs, lan_scan, lateral, ldap_enum, lfi,
    local_discovery, linux_posture, macos_posture, nmap, people_enum,
    persistence, ping, playbook_suggest, port_scanner, presets, processes,
    profile_finder, reports, reverse_ip, reverse_shell, s3_scanner, scope, settings,
    shodan_censys, smb_enum, sqli, ssrf, stego, subdomain_enum, summarize,
    system_info, takeover, targets, tcpdump, terminal, tls_audit,
    tool_requirements, triage, urlscan, wayback, whois, wifi, wifi_scan,
    windows_posture,
    wpa_capture, xss, systemd_units, firewall_rules, users_audit,
)

logging_setup.configure()
logger = logging.getLogger("hackingpal")

# ── PATH augmentation for GUI-launched sidecars ─────────────────────────────
# macOS launchd hands GUI apps a minimal PATH like ``/usr/bin:/bin:/usr/sbin:
# /sbin``. That's missing Homebrew (`/opt/homebrew/bin`) and Docker Desktop's
# /usr/local symlinks — so `shutil.which("docker")` returns None and Labs
# fails with "Docker daemon is not running" even when colima is up. Electron's
# main.cjs already prepends these, but we belt-and-suspenders here so direct
# sidecar launches (or alternative GUI launchers) also work.
if sys.platform == "darwin":
    _TOOL_PATHS = ["/opt/homebrew/bin", "/opt/homebrew/sbin",
                   "/usr/local/bin", "/usr/local/sbin"]
    _existing = (os.environ.get("PATH") or "").split(":")
    _need = [p for p in _TOOL_PATHS if p not in _existing]
    if _need:
        os.environ["PATH"] = ":".join(_need + _existing)

# ── Startup guard: refuse to expose the backend to the network ───────────────
# We check both NT_BACKEND_HOST (used by the sidecar entrypoint below) and
# HOST (commonly read by container orchestration). If either is a wildcard,
# bail out hard before FastAPI ever binds a socket.
#
# Escape hatch for the Docker deployment (see SECURITY.md "Threat Model"):
# set HACKINGPAL_ALLOW_PUBLIC_HOST=1 to acknowledge that you are lifting
# the loopback restriction deliberately. Required because the container's
# `ports: 8765:8765` mapping in docker-compose.yml needs the app to bind
# the container's external interface.
# Legacy name MYHACKINGPAL_ALLOW_PUBLIC_HOST is still honored as a
# pre-rebrand fallback.
_FORBIDDEN_HOSTS = {"0.0.0.0", "::", "*"}
_ALLOW_PUBLIC = (
    os.environ.get("HACKINGPAL_ALLOW_PUBLIC_HOST", "").strip() == "1"
    or os.environ.get("MYHACKINGPAL_ALLOW_PUBLIC_HOST", "").strip() == "1"
)
for _var in ("NT_BACKEND_HOST", "HOST"):
    _val = os.environ.get(_var, "").strip()
    if _val in _FORBIDDEN_HOSTS and not _ALLOW_PUBLIC:
        sys.stderr.write(
            f"[hackingpal] {_var}={_val!r}: "
            "HackingPal backend must not be exposed to the network. "
            "Refusing to start.\n"
            "(Docker deployments: set HACKINGPAL_ALLOW_PUBLIC_HOST=1 to opt in.)\n"
        )
        raise SystemExit(2)
if _ALLOW_PUBLIC:
    sys.stderr.write(
        "[hackingpal] HACKINGPAL_ALLOW_PUBLIC_HOST=1 — startup guard bypassed. "
        "Backend will accept non-loopback connections. The per-launch auth token "
        "is now the only thing protecting privileged endpoints.\n"
    )

app = FastAPI(title="HackingPal", version="1.0.0")

# Global error envelope + handlers. Every uncaught exception becomes
# {"error": "...", "code": "..."} with the stack trace logged server-side
# instead of leaked to the client.
mhp_errors.install_handlers(app)

# Loopback-only CORS: the only thing that ever calls us is the local
# Electron renderer (or the Vite dev server during development).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev
        "http://127.0.0.1:5173",
        "app://-",                 # Electron production scheme
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ip_checker.router)
app.include_router(ip_checker.shodan_router)
app.include_router(dns_recon.router)
app.include_router(whois.router)
app.include_router(tls_audit.router)
app.include_router(fingerprint.router)
app.include_router(http_probe.router)
app.include_router(ct_log.router)
app.include_router(email_security.router)
app.include_router(takeover.router)
app.include_router(reverse_ip.router)
app.include_router(cms.router)
app.include_router(macos_posture.router)
app.include_router(linux_posture.router)
app.include_router(windows_posture.router)
app.include_router(systemd_units.router)
app.include_router(firewall_rules.router)
app.include_router(users_audit.router)
app.include_router(local_discovery.router)
app.include_router(jwt_analyzer.router)
app.include_router(graphql.router)
app.include_router(hash_cracker.router)
app.include_router(port_scanner.router)
app.include_router(nmap.router)
app.include_router(lan_scan.router)
app.include_router(audit.router)
app.include_router(ids.router)
app.include_router(ping.router)
app.include_router(tcpdump.router)
app.include_router(wifi.router)
app.include_router(terminal.router)
app.include_router(brew.router)
app.include_router(labs.router)
app.include_router(targets.router)
app.include_router(persistence.router)
app.include_router(processes.router)
app.include_router(stego.router)
app.include_router(reverse_shell.router)
app.include_router(system_info.router)
app.include_router(settings.router)
app.include_router(chat.router)
app.include_router(engagements.router)
app.include_router(findings.router)
app.include_router(cvss.router)
app.include_router(reports.router)
app.include_router(summarize.router)
app.include_router(imds.router)
app.include_router(s3_scanner.router)
app.include_router(breach.router)
app.include_router(dorking.router)
app.include_router(github_leak.router)
app.include_router(shodan_censys.router)
app.include_router(people_enum.router)
app.include_router(aws_recon.router)
app.include_router(azure_recon.router)
app.include_router(gcp_recon.router)
app.include_router(ldap_enum.router)
app.include_router(smb_enum.router)
app.include_router(ad_spray.router)
app.include_router(kerberos_roast.router)
app.include_router(wifi_scan.router)
app.include_router(evil_twin.router)
app.include_router(bt_recon.router)
app.include_router(wpa_capture.router)
app.include_router(c2_beacon.router)
app.include_router(cred_harvest.router)
app.include_router(profile_finder.router)
app.include_router(bloodhound_ingest.router)
app.include_router(lateral.router)
app.include_router(subdomain_enum.router)
app.include_router(xss.router)
app.include_router(sqli.router)
app.include_router(cmdi.router)
app.include_router(lfi.router)
app.include_router(ssrf.router)
app.include_router(idor.router)
app.include_router(presets.router)
app.include_router(exploits.router)
app.include_router(wayback.router)
app.include_router(urlscan.router)
app.include_router(email_harvest.router)
app.include_router(dorking.osint_router)
app.include_router(audit_log.router)
app.include_router(scope.router)
app.include_router(triage.router)
app.include_router(playbook_suggest.router)
app.include_router(basic_check.router)
app.include_router(tool_requirements.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": app.version, "pid": str(os.getpid())}


@app.get("/version")
def version() -> dict[str, str]:
    return {"version": app.version}


@app.get("/auth/token", dependencies=[Depends(require_localhost)])
def auth_token() -> dict[str, str]:
    """Return the per-launch auth token. Loopback-only (no header required).

    The Electron renderer fetches this on first api() call and attaches it
    via X-MHP-Token on every subsequent privileged request. The token is
    regenerated each process start, so anything cached from a previous run
    is automatically invalidated.
    """
    return {"token": AUTH_TOKEN}


# ── Optional browser UI mount ────────────────────────────────────────────────
# The Docker image bundles the built React app under /app/frontend_dist and
# serves it at "/". The Electron PyInstaller sidecar has no such directory,
# so the mount is conditional and that build path remains unaffected.
# Registered after every explicit route so it only catches unmatched paths.
_FRONTEND_DIST = Path(__file__).parent / "frontend_dist"
if _FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")


# ── Sidecar entrypoint ────────────────────────────────────────────────────────
# Lets the PyInstaller-bundled binary launch uvicorn directly without needing
# `python -m uvicorn`. The dev workflow still uses uvicorn's CLI for --reload.
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("NT_BACKEND_PORT", "8765"))
    # Loopback-only by default. The startup guard above already rejects
    # wildcard hosts before we get here, so anything that survives to this
    # point is at worst a typo'd hostname that uvicorn itself will refuse.
    host = os.environ.get("NT_BACKEND_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port, log_level="warning",
                # asyncio + h11 + wsproto are explicit so PyInstaller can find them
                loop="asyncio", http="h11", ws="wsproto")
