#!/usr/bin/env python3
"""network_audit.py — Automated network risk assessment with risk-rated findings."""

import argparse
import ipaddress
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import datetime

from rich.console import Console
from rich.table import Table
from rich import box

# Import core scanning logic from sibling modules (same dir, picked up via sys.path[0])
import port_scanner as _ps
import lan_scanner as _ls

console = Console()

# ── Risk database ─────────────────────────────────────────────────────────────

@dataclass
class RiskEntry:
    level: str          # CRITICAL / HIGH / MEDIUM / LOW / INFO
    reason: str
    recommendation: str


RISK_DB: dict[int, RiskEntry] = {
    21:    RiskEntry("HIGH",     "FTP transmits credentials and data in plaintext",
                                 "Disable FTP; use SFTP or SCP instead"),
    23:    RiskEntry("CRITICAL", "Telnet sends all traffic including credentials in cleartext",
                                 "Disable immediately; replace with SSH"),
    25:    RiskEntry("MEDIUM",   "SMTP may allow open relay or plaintext auth",
                                 "Restrict relay rules; enforce STARTTLS and authentication"),
    80:    RiskEntry("LOW",      "Unencrypted HTTP exposes traffic to interception",
                                 "Redirect to HTTPS (port 443)"),
    110:   RiskEntry("MEDIUM",   "POP3 transmits credentials in plaintext",
                                 "Use POP3S (port 995) with TLS"),
    111:   RiskEntry("MEDIUM",   "RPC portmapper can expose internal services",
                                 "Block externally; restrict with firewall rules"),
    143:   RiskEntry("MEDIUM",   "IMAP transmits credentials in plaintext",
                                 "Use IMAPS (port 993) with TLS"),
    445:   RiskEntry("CRITICAL", "SMB is a primary vector for ransomware and lateral movement",
                                 "Block externally; disable SMBv1; apply all patches"),
    1433:  RiskEntry("HIGH",     "MSSQL exposed to network — brute-force and injection risk",
                                 "Restrict to localhost or VPN; use strong auth"),
    1521:  RiskEntry("HIGH",     "Oracle DB exposed to network — brute-force risk",
                                 "Restrict to localhost or VPN; audit accounts"),
    3306:  RiskEntry("HIGH",     "MySQL exposed to network — credential brute-force risk",
                                 "Bind to 127.0.0.1; use SSH tunnels for remote access"),
    3389:  RiskEntry("CRITICAL", "RDP is a primary target for ransomware and brute-force",
                                 "Restrict to VPN; enable NLA; use strong passwords and MFA"),
    5432:  RiskEntry("MEDIUM",   "PostgreSQL exposed to network",
                                 "Bind to localhost; tighten pg_hba.conf rules"),
    5900:  RiskEntry("HIGH",     "VNC is commonly unencrypted and brute-forced",
                                 "Disable or tunnel over SSH; require a strong password"),
    6379:  RiskEntry("CRITICAL", "Redis has no authentication by default — full data access",
                                 "Set requirepass; bind to localhost or VPN only"),
    8080:  RiskEntry("LOW",      "Alternate HTTP port — unencrypted",
                                 "Evaluate necessity; enforce HTTPS if serving content"),
    9200:  RiskEntry("HIGH",     "Elasticsearch may lack authentication — full index access",
                                 "Enable X-Pack security; restrict network access"),
    27017: RiskEntry("CRITICAL", "MongoDB had no auth by default — full DB access risk",
                                 "Enable authentication; bind to localhost or VPN"),
}

# Ordered by severity for sorting
_LEVEL_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}

_LEVEL_STYLE = {
    "CRITICAL": "bold red",
    "HIGH":     "red",
    "MEDIUM":   "yellow",
    "LOW":      "blue",
    "INFO":     "dim",
}

# Default ports audited — all risky ports plus common services
AUDIT_PORTS: list[int] = sorted(RISK_DB.keys()) + [22, 53, 443, 587, 993, 995, 8443]
AUDIT_PORTS = sorted(set(AUDIT_PORTS))


# ── Audit logic ───────────────────────────────────────────────────────────────

@dataclass
class Finding:
    port: int
    service: str
    banner: str
    level: str
    reason: str
    recommendation: str


def audit_host(
    ip: str,
    ports: list[int],
    timeout: float,
    num_threads: int,
) -> list[Finding]:
    """
    Port-scan the host and evaluate each open port against RISK_DB.
    Returns a list of Findings sorted by severity.
    """
    open_ports = _ps.scan_all(ip, ports, timeout, num_threads)

    findings: list[Finding] = []
    for port, service, banner in open_ports:
        if port in RISK_DB:
            entry = RISK_DB[port]
            findings.append(Finding(
                port=port,
                service=service or _ps.SERVICES.get(port, ""),
                banner=banner,
                level=entry.level,
                reason=entry.reason,
                recommendation=entry.recommendation,
            ))
        else:
            findings.append(Finding(
                port=port,
                service=service or _ps.SERVICES.get(port, ""),
                banner=banner,
                level="INFO",
                reason="Open port — not in risk database",
                recommendation="Verify this service is intentional",
            ))

    findings.sort(key=lambda f: (_LEVEL_ORDER.get(f.level, 99), f.port))
    return findings


def worst_level(findings: list[Finding]) -> str:
    """Return the highest severity level across all findings."""
    if not findings:
        return "CLEAN"
    return min((f.level for f in findings), key=lambda l: _LEVEL_ORDER.get(l, 99))


# ── Output ────────────────────────────────────────────────────────────────────

def build_host_table(ip: str, findings: list[Finding]) -> Table:
    """Render findings for a single host as a rich Table."""
    wl = worst_level(findings)
    wl_style = _LEVEL_STYLE.get(wl, "white")

    table = Table(
        title=f"[bold]{ip}[/bold]  overall: [{wl_style}]{wl}[/{wl_style}]",
        show_lines=True,
        header_style="bold magenta",
        border_style="dim",
        box=box.SIMPLE_HEAVY,
    )
    table.add_column("Port", style="cyan", justify="right", min_width=5)
    table.add_column("Service", style="yellow", min_width=12)
    table.add_column("Risk", min_width=9)
    table.add_column("Reason", no_wrap=False)
    table.add_column("Fix", style="green", no_wrap=False)
    table.add_column("Banner", style="dim", min_width=16, no_wrap=True)

    for f in findings:
        style = _LEVEL_STYLE.get(f.level, "white")
        table.add_row(
            str(f.port),
            f.service,
            f"[{style}]{f.level}[/{style}]",
            f.reason,
            f.recommendation,
            f.banner,
        )
    return table


def build_summary_table(host_results: list[dict]) -> Table:
    """Render a per-host summary table for multi-host (CIDR) scans."""
    table = Table(
        title="[bold]Network Audit Summary[/bold]",
        show_lines=False,
        header_style="bold magenta",
        border_style="dim",
        min_width=80,
    )
    table.add_column("IP Address", style="cyan", width=18)
    table.add_column("Hostname", width=25)
    table.add_column("Open/Risky", justify="right", width=12)
    table.add_column("Highest Risk", width=12)
    table.add_column("Critical Ports", style="dim", no_wrap=False)

    for hr in host_results:
        findings: list[Finding] = hr["findings"]
        wl = worst_level(findings)
        style = _LEVEL_STYLE.get(wl, "white")
        risky = [f for f in findings if f.level not in ("INFO", "CLEAN")]
        critical_ports = ", ".join(
            str(f.port) for f in findings if f.level in ("CRITICAL", "HIGH")
        )
        table.add_row(
            hr["ip"],
            hr.get("hostname") or "—",
            f"{len(findings)} / {len(risky)}",
            f"[{style}]{wl}[/{style}]",
            critical_ports or "—",
        )
    return table


def save_results(
    host_results: list[dict],
    target: str,
    elapsed: float,
    started: datetime,
    output_format: str = "text",
    save_dir: str | None = None,
) -> None:
    """Write audit results to a timestamped file as text or JSON."""
    out_dir = os.path.expanduser(save_dir) if save_dir else os.path.expanduser("~/network_tools/scans/network_audits")
    os.makedirs(out_dir, exist_ok=True)

    stamp = started.strftime("%Y-%m-%d_%H-%M-%S")
    safe_target = target.replace("/", "-").replace(".", "_").replace(":", "_")

    if output_format == "json":
        filename = os.path.join(out_dir, f"audit_{safe_target}_{stamp}.json")
        payload = {
            "target": target,
            "started": started.strftime("%Y-%m-%d %H:%M:%S"),
            "elapsed_seconds": round(elapsed, 2),
            "host_count": len(host_results),
            "hosts": [
                {
                    "ip": hr["ip"],
                    "hostname": hr.get("hostname", ""),
                    "overall_risk": worst_level(hr["findings"]),
                    "findings": [asdict(f) for f in hr["findings"]],
                }
                for hr in host_results
            ],
        }
        with open(filename, "w") as f:
            json.dump(payload, f, indent=2)
    else:
        filename = os.path.join(out_dir, f"audit_{safe_target}_{stamp}.txt")
        lines = [
            "Network Audit Report",
            f"Target  : {target}",
            f"Started : {started.strftime('%Y-%m-%d %H:%M:%S')}",
            f"Elapsed : {elapsed:.2f}s",
            f"Hosts   : {len(host_results)}",
            "",
        ]
        for hr in host_results:
            findings: list[Finding] = hr["findings"]
            lines += [
                f"Host: {hr['ip']}  ({hr.get('hostname', '—')})  "
                f"Overall: {worst_level(findings)}",
                f"  {'Port':<8} {'Service':<14} {'Risk':<10} Reason",
                "  " + "-" * 70,
            ]
            for f in findings:
                lines.append(f"  {f.port:<8} {f.service:<14} {f.level:<10} {f.reason}")
            lines.append("")
        with open(filename, "w") as f:
            f.write("\n".join(lines) + "\n")

    console.print(f"[dim]Results saved → {filename}[/dim]")


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Automated network risk audit — flags risky open services with rated findings.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python3 network_audit.py 192.168.1.1
  python3 network_audit.py 192.168.1.0/24        # discover + audit all live hosts
  python3 network_audit.py 10.0.0.1 --full-scan  # scan all 1-1024 ports
  python3 network_audit.py 192.168.1.1 --output json
""",
    )
    parser.add_argument(
        "target",
        metavar="IP/CIDR",
        help="Single IP, hostname, or CIDR range to audit",
    )
    parser.add_argument(
        "--full-scan",
        action="store_true",
        help=f"Scan ports 1-1024 instead of the default {len(AUDIT_PORTS)} audit ports",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=1.0,
        metavar="SEC",
        help="Connection timeout per port [default: 1.0]",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=100,
        metavar="N",
        help="Concurrent threads per host [default: 100]",
    )
    parser.add_argument(
        "--output",
        choices=["text", "json"],
        default="text",
        help="Output format: text (default) or json",
    )
    parser.add_argument(
        "--save-dir",
        metavar="DIR",
        default=None,
        help="Directory to save results (default: ~/network_tools/scans/network_audits)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    ports = list(range(1, 1025)) if args.full_scan else AUDIT_PORTS
    port_desc = "1-1024" if args.full_scan else f"{len(ports)} audit ports"

    # Determine if target is a network range or single host
    is_network = False
    try:
        net = ipaddress.IPv4Network(args.target, strict=False)
        if net.num_addresses > 1:
            is_network = True
    except ValueError:
        pass

    started = datetime.now()
    console.print(
        f"\n[bold]Target:[/bold] {args.target}  "
        f"[bold]Ports:[/bold] {port_desc}  "
        f"[bold]Threads:[/bold] {args.threads}  "
        f"[bold]Timeout:[/bold] {args.timeout}s"
    )
    console.print(f"[dim]Started {started.strftime('%Y-%m-%d %H:%M:%S')}[/dim]\n")

    host_results: list[dict] = []

    if is_network:
        # Step 1: discover live hosts
        console.rule("[bold cyan]Step 1 — Host Discovery[/bold cyan]")
        live_hosts = _ls.scan_network(args.target, args.timeout, args.threads)
        if not live_hosts:
            console.print("[yellow]No live hosts found.[/yellow]")
            sys.exit(0)
        console.print(f"[green]{len(live_hosts)} host(s) found[/green]\n")

        # Step 2: audit each live host
        console.rule("[bold cyan]Step 2 — Port Audit[/bold cyan]")
        for host in live_hosts:
            ip = host["ip"]
            console.print(f"[dim]Auditing {ip}…[/dim]")
            findings = audit_host(ip, ports, args.timeout, args.threads)
            host_results.append({
                "ip": ip,
                "hostname": host.get("hostname", ""),
                "findings": findings,
            })

        console.print()
        console.print(build_summary_table(host_results))
        console.print()

        # Print detailed findings for any host with MEDIUM or above
        for hr in host_results:
            risky = [f for f in hr["findings"] if _LEVEL_ORDER.get(f.level, 99) <= 2]
            if risky:
                console.print(build_host_table(hr["ip"], hr["findings"]))
                console.print()

    else:
        # Single host audit
        try:
            ip = _ps.resolve_host(args.target)
        except SystemExit:
            sys.exit(1)

        findings = audit_host(ip, ports, args.timeout, args.threads)
        host_results.append({"ip": ip, "hostname": args.target if args.target != ip else "", "findings": findings})

        if not findings:
            console.print(f"[green]No open ports found[/green] on {ip} ({port_desc} scanned)")
        else:
            console.print(build_host_table(ip, findings))

            # Print recommendations for risky findings
            risky = [f for f in findings if f.level not in ("INFO",)]
            if risky:
                console.print("\n[bold]Recommendations[/bold]")
                for f in risky:
                    style = _LEVEL_STYLE.get(f.level, "white")
                    console.print(
                        f"  [{style}]{f.level}[/{style}] Port {f.port} ({f.service}): "
                        f"[dim]{f.recommendation}[/dim]"
                    )

    elapsed = (datetime.now() - started).total_seconds()
    console.print(f"\n[dim]Audit completed in {elapsed:.2f}s[/dim]\n")
    save_results(host_results, args.target, elapsed, started, args.output, args.save_dir)


if __name__ == "__main__":
    main()
