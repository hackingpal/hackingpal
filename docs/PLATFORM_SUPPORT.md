# Platform Support

HackingPal v1.0 is **macOS + Linux + Docker first**. Windows is not removed from the codebase, but native Windows parity is deferred until the engagement workflow, safety controls, evidence system, and reporting loop are stable.

## Support tiers

| Tier | Platform | Status | v1.0 expectation |
|---|---|---|---|
| Tier 1 | macOS | Primary desktop baseline | Polished desktop UX, Keychain, posture, WiFi, tcpdump/nmap integration, signed-build work first |
| Tier 1 | Linux | Primary lab/power-user baseline | Security tooling, Docker hosts, systemd/firewall/users audit, homelab workflows |
| Tier 1 | Docker | Lab/server/remote backend mode | Trusted-network backend/API mode; VPN/Tailscale/reverse-proxy auth guidance required |
| Deferred | Windows | Experimental | Keep clean 501/503 guards and smoke checks when low-maintenance; no v1.0 parity commitment |

## Rule of thumb

Core workflow code should be platform-neutral:

```
Engagements → Targets → Playbooks → Tools → Evidence → Findings → Reports
```

Platform-specific code should live behind helpers/adapters:

```
platform_util.py
macOS posture / Linux posture / Windows future adapters
platform-gated NavItems
clean 501/503 unsupported responses
```

## Docker warning

Docker mode is useful for lab and remote backend deployment, but it should not be exposed to the public internet. Until server-mode authentication is mandatory, use it only on loopback, a trusted LAN, a VPN/Tailscale network, or behind an authenticating reverse proxy.
