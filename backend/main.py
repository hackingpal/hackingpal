"""FastAPI app entrypoint for the Network Tools backend.

In dev:   uvicorn main:app --reload --port 8765
In prod:  Electron spawns this as a sidecar process on app start.
"""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import (
    ad_spray, audit, aws_recon, azure_recon, bloodhound_ingest, breach, brew,
    bt_recon, c2_beacon, chat, cmdi, cms, cred_harvest, ct_log, dns_recon,
    dorking, email_security, engagements, evil_twin, fingerprint, gcp_recon,
    github_leak, graphql, hash_cracker, http_probe, ids, idor, imds, ip_checker,
    jwt_analyzer, kerberos_roast, lan_scan, lateral, ldap_enum, lfi,
    local_discovery, macos_posture, nmap, people_enum, persistence, ping,
    port_scanner, presets, processes, profile_finder, reverse_ip, reverse_shell,
    s3_scanner, settings, shodan_censys, smb_enum, sqli, ssrf, stego,
    subdomain_enum, system_info, takeover, tcpdump, terminal, tls_audit, vpn,
    whois, wifi, wifi_scan, wpa_capture, xss,
)

app = FastAPI(title="MyHackingPal", version="0.1.0")

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
app.include_router(vpn.router)
app.include_router(terminal.router)
app.include_router(brew.router)
app.include_router(persistence.router)
app.include_router(processes.router)
app.include_router(stego.router)
app.include_router(reverse_shell.router)
app.include_router(system_info.router)
app.include_router(settings.router)
app.include_router(chat.router)
app.include_router(engagements.router)
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": app.version, "pid": str(os.getpid())}


# ── Sidecar entrypoint ────────────────────────────────────────────────────────
# Lets the PyInstaller-bundled binary launch uvicorn directly without needing
# `python -m uvicorn`. The dev workflow still uses uvicorn's CLI for --reload.
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("NT_BACKEND_PORT", "8765"))
    host = os.environ.get("NT_BACKEND_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port, log_level="warning",
                # asyncio + h11 + wsproto are explicit so PyInstaller can find them
                loop="asyncio", http="h11", ws="wsproto")
