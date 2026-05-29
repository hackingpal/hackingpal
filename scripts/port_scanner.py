#!/usr/bin/env python3
"""port_scanner.py — Threaded CLI port scanner with banner detection."""

import argparse
import json
import queue
import socket
import ssl
import sys
import threading
import time
from datetime import datetime

from rich.console import Console
from rich.progress import BarColumn, MofNCompleteColumn, Progress, TextColumn
from rich.table import Table

console = Console()

# ── Common service names ───────────────────────────────────────────────────────

SERVICES: dict[int, str] = {
    21: "FTP",
    22: "SSH",
    23: "Telnet",
    25: "SMTP",
    53: "DNS",
    80: "HTTP",
    110: "POP3",
    111: "RPC",
    143: "IMAP",
    443: "HTTPS",
    445: "SMB",
    587: "SMTP/TLS",
    993: "IMAPS",
    995: "POP3S",
    1433: "MSSQL",
    1521: "Oracle DB",
    3306: "MySQL",
    3389: "RDP",
    5432: "PostgreSQL",
    5900: "VNC",
    6379: "Redis",
    8080: "HTTP-Proxy",
    8443: "HTTPS-Alt",
    9200: "Elasticsearch",
    27017: "MongoDB",
}

# Ports that use TLS — wrap socket with ssl before reading
TLS_PORTS = {443, 8443, 993, 995}

# Service-specific probes: sent after connect to elicit a banner.
# None means the server speaks first (FTP, SSH, SMTP, MySQL, etc.).
PROBES: dict[int, bytes | None] = {
    21: None,                                        # FTP — server speaks first
    22: None,                                        # SSH — server speaks first
    23: None,                                        # Telnet — server speaks first
    25: b"EHLO scanner\r\n",                         # SMTP
    80: b"HEAD / HTTP/1.0\r\nHost: \r\n\r\n",       # HTTP
    110: b"CAPA\r\n",                                # POP3
    143: b"A001 CAPABILITY\r\n",                     # IMAP
    443: b"HEAD / HTTP/1.0\r\nHost: \r\n\r\n",      # HTTPS (over TLS)
    587: b"EHLO scanner\r\n",                        # SMTP/TLS
    993: b"A001 CAPABILITY\r\n",                     # IMAPS
    995: b"CAPA\r\n",                                # POP3S
    3306: None,                                      # MySQL — server speaks first
    5432: None,                                      # PostgreSQL — server speaks first
    6379: b"PING\r\n",                               # Redis
    8000: b"HEAD / HTTP/1.0\r\nHost: \r\n\r\n",
    8008: b"HEAD / HTTP/1.0\r\nHost: \r\n\r\n",
    8080: b"HEAD / HTTP/1.0\r\nHost: \r\n\r\n",
    8443: b"HEAD / HTTP/1.0\r\nHost: \r\n\r\n",     # HTTPS-Alt (over TLS)
    8888: b"HEAD / HTTP/1.0\r\nHost: \r\n\r\n",
    9200: b"GET / HTTP/1.0\r\nHost: \r\n\r\n",      # Elasticsearch
}


# ── Core scanning logic ────────────────────────────────────────────────────────

def grab_banner(sock: socket.socket, host: str, port: int, timeout: float) -> str:
    """Read up to one line of banner from an already-connected socket.

    Wraps the socket in TLS for known secure ports, then sends a
    service-appropriate probe (or waits for the server to speak first).
    """
    try:
        sock.settimeout(min(timeout, 2.0))

        # Upgrade to TLS for secure ports
        if port in TLS_PORTS:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            try:
                sock = ctx.wrap_socket(sock, server_hostname=host)
            except ssl.SSLError:
                return ""

        probe = PROBES.get(port, b"")   # unknown ports: send nothing, wait
        if probe:
            sock.sendall(probe)

        raw = sock.recv(1024).decode("utf-8", errors="replace").strip()
        lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
        return lines[0][:80] if lines else ""
    except OSError:
        return ""


def scan_port(host: str, port: int, timeout: float) -> tuple[int, str, str] | None:
    """
    Attempt a TCP connection to host:port.
    Returns (port, service, banner) when open, None when closed/filtered.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.settimeout(timeout)
        if sock.connect_ex((host, port)) != 0:
            return None
        banner = grab_banner(sock, host, port, timeout)
        return (port, SERVICES.get(port, ""), banner)
    except OSError:
        return None
    finally:
        sock.close()


def _worker(
    host: str,
    port_q: queue.Queue,
    timeout: float,
    results: list,
    lock: threading.Lock,
    progress: Progress,
    task_id,
) -> None:
    """Thread worker: drain the port queue, scan each port."""
    while True:
        try:
            port = port_q.get_nowait()
        except queue.Empty:
            break
        try:
            result = scan_port(host, port, timeout)
            if result:
                with lock:
                    results.append(result)
        except Exception:
            pass
        progress.advance(task_id)
        port_q.task_done()


def scan_all(
    host: str,
    ports: list[int],
    timeout: float,
    num_threads: int,
) -> list[tuple[int, str, str]]:
    """Spawn worker threads and collect results, showing a live progress bar."""
    port_q: queue.Queue = queue.Queue()
    for p in ports:
        port_q.put(p)

    results: list[tuple[int, str, str]] = []
    lock = threading.Lock()

    with Progress(
        TextColumn("[bold cyan]Scanning[/bold cyan]"),
        BarColumn(bar_width=40),
        MofNCompleteColumn(),
        TextColumn("[dim]{task.fields[open]} open[/dim]"),
        console=console,
        transient=True,
    ) as progress:
        task_id = progress.add_task("scan", total=len(ports), open=0)

        threads = [
            threading.Thread(
                target=_worker,
                args=(host, port_q, timeout, results, lock, progress, task_id),
                daemon=True,
            )
            for _ in range(min(num_threads, len(ports)))
        ]
        for t in threads:
            t.start()

        # Update the "open" field while threads run (sleep to avoid CPU spin)
        while any(t.is_alive() for t in threads):
            progress.update(task_id, open=len(results))
            time.sleep(0.1)

        for t in threads:
            t.join()
        progress.update(task_id, open=len(results))

    return results


# ── CLI helpers ────────────────────────────────────────────────────────────────

def parse_ports(spec: str) -> list[int]:
    """Parse a port spec like '1-1024', '80,443', or '22,100-200' into a sorted list."""
    ports: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            lo_s, _, hi_s = part.partition("-")
            try:
                lo, hi = int(lo_s), int(hi_s)
            except ValueError:
                console.print(f"[red]Error:[/red] invalid port range '{part}'")
                sys.exit(1)
            if not (1 <= lo <= hi <= 65535):
                console.print(f"[red]Error:[/red] port range '{part}' out of bounds (1-65535)")
                sys.exit(1)
            ports.update(range(lo, hi + 1))
        else:
            try:
                p = int(part)
            except ValueError:
                console.print(f"[red]Error:[/red] invalid port '{part}'")
                sys.exit(1)
            if not (1 <= p <= 65535):
                console.print(f"[red]Error:[/red] port {p} out of bounds (1-65535)")
                sys.exit(1)
            ports.add(p)
    if not ports:
        console.print("[red]Error:[/red] no ports specified")
        sys.exit(1)
    return sorted(ports)


def resolve_host(target: str) -> str:
    """Resolve a hostname to an IPv4 address, exit cleanly on failure."""
    try:
        return socket.gethostbyname(target)
    except socket.gaierror as exc:
        console.print(f"[red]Error:[/red] cannot resolve '{target}': {exc}")
        sys.exit(1)


def build_table(results: list[tuple[int, str, str]], target: str, ip: str) -> Table:
    """Render open port results as a rich Table."""
    table = Table(
        title=f"[bold]Scan results — {target}[/bold] [dim]({ip})[/dim]",
        show_lines=False,
        header_style="bold magenta",
        border_style="dim",
        min_width=60,
    )
    table.add_column("Port", style="cyan", justify="right", width=7)
    table.add_column("State", style="green", width=7)
    table.add_column("Service", style="yellow", width=16)
    table.add_column("Banner", style="white", no_wrap=False)

    for port, service, banner in sorted(results):
        table.add_row(str(port), "open", service, banner)

    return table


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Threaded TCP port scanner with service banner detection.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python3 port_scanner.py 192.168.1.1
  python3 port_scanner.py example.com -p 1-65535
  python3 port_scanner.py 10.0.0.1 -p 22,80,443,8000-8100 --timeout 2
  python3 port_scanner.py scanme.nmap.org --threads 200
""",
    )
    parser.add_argument("target", help="Target IP address or hostname")
    parser.add_argument(
        "-p", "--ports",
        default="1-1024",
        metavar="RANGE",
        help="Port range or list (e.g. 1-1024, 80,443, 22,100-200) [default: 1-1024]",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=1.0,
        metavar="SEC",
        help="Connection timeout per port in seconds [default: 1.0]",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=100,
        metavar="N",
        help="Number of concurrent threads [default: 100]",
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
        help="Directory to save results (default: ~/network_tools/scans/port_scans)",
    )
    return parser.parse_args()


# ── Output ─────────────────────────────────────────────────────────────────────

def save_results(
    results: list[tuple[int, str, str]],
    target: str,
    ip: str,
    port_desc: str,
    timeout: float,
    threads: int,
    elapsed: float,
    started: datetime,
    output_format: str = "text",
    save_dir: str | None = None,
) -> None:
    """Write scan results to a timestamped file (text or JSON)."""
    import os
    out_dir = os.path.expanduser(save_dir) if save_dir else os.path.expanduser("~/network_tools/scans/port_scans")
    os.makedirs(out_dir, exist_ok=True)

    stamp = started.strftime("%Y-%m-%d_%H-%M-%S")
    safe_target = target.replace("/", "_").replace(":", "_")

    if output_format == "json":
        filename = os.path.join(out_dir, f"scan_{safe_target}_{stamp}.json")
        payload = {
            "target": target,
            "ip": ip,
            "ports": port_desc,
            "threads": threads,
            "timeout": timeout,
            "started": started.strftime("%Y-%m-%d %H:%M:%S"),
            "elapsed_seconds": round(elapsed, 2),
            "open_count": len(results),
            "results": [
                {"port": port, "state": "open", "service": service, "banner": banner}
                for port, service, banner in sorted(results)
            ],
        }
        with open(filename, "w") as f:
            json.dump(payload, f, indent=2)
    else:
        filename = os.path.join(out_dir, f"scan_{safe_target}_{stamp}.txt")
        lines = [
            "Port scan report",
            f"Target  : {target} ({ip})",
            f"Ports   : {port_desc}",
            f"Threads : {threads}",
            f"Timeout : {timeout}s",
            f"Started : {started.strftime('%Y-%m-%d %H:%M:%S')}",
            f"Elapsed : {elapsed:.2f}s",
            f"Open    : {len(results)}",
            "",
            f"{'Port':<8} {'State':<8} {'Service':<18} Banner",
            "-" * 70,
        ]
        for port, service, banner in sorted(results):
            lines.append(f"{port:<8} {'open':<8} {service:<18} {banner}")
        with open(filename, "w") as f:
            f.write("\n".join(lines) + "\n")

    console.print(f"[dim]Results saved → {filename}[/dim]")


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()

    if args.timeout <= 0:
        console.print("[red]Error:[/red] --timeout must be positive")
        sys.exit(1)
    if args.threads < 1:
        console.print("[red]Error:[/red] --threads must be at least 1")
        sys.exit(1)

    ports = parse_ports(args.ports)
    ip = resolve_host(args.target)

    port_desc = (
        f"{ports[0]}-{ports[-1]}"
        if ports == list(range(ports[0], ports[-1] + 1))
        else f"{len(ports)} ports"
    )

    console.print(
        f"\n[bold]Target:[/bold] {args.target} [dim]({ip})[/dim]  "
        f"[bold]Ports:[/bold] {port_desc}  "
        f"[bold]Threads:[/bold] {args.threads}  "
        f"[bold]Timeout:[/bold] {args.timeout}s"
    )
    console.print(f"[dim]Started {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}[/dim]\n")

    t0 = datetime.now()
    results = scan_all(ip, ports, args.timeout, args.threads)
    elapsed = (datetime.now() - t0).total_seconds()

    if not results:
        console.print(
            f"[yellow]No open ports found[/yellow] in {elapsed:.2f}s "
            f"({len(ports)} ports scanned)"
        )
    else:
        console.print(build_table(results, args.target, ip))
        console.print(
            f"\n[dim]Scanned {len(ports)} ports in {elapsed:.2f}s — "
            f"[green]{len(results)} open[/green][/dim]\n"
        )

    save_results(results, args.target, ip, port_desc, args.timeout, args.threads, elapsed, t0, args.output, args.save_dir)


if __name__ == "__main__":
    main()
