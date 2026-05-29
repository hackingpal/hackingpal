#!/usr/bin/env python3
"""lan_scanner.py — LAN host discovery with ARP MAC enrichment."""

import argparse
import ipaddress
import json
import queue
import re
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime

from rich.console import Console
from rich.progress import BarColumn, MofNCompleteColumn, Progress, TextColumn
from rich.table import Table

console = Console()


# ── Network detection ─────────────────────────────────────────────────────────

def _hex_netmask_to_dotted(hex_mask: str) -> str:
    """Convert macOS hex netmask (0xffffff00) → dotted notation (255.255.255.0)."""
    val = int(hex_mask, 16)
    return ".".join(str((val >> (8 * i)) & 0xFF) for i in (3, 2, 1, 0))


def get_local_network() -> str | None:
    """
    Parse `ifconfig` to find the first active non-loopback IPv4 interface
    and return its network in CIDR notation (e.g. 192.168.1.0/24).
    """
    try:
        out = subprocess.check_output(["ifconfig"], text=True, stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None

    inet_re = re.compile(
        r"inet (\d+\.\d+\.\d+\.\d+)\s+netmask\s+(0x[0-9a-fA-F]+|\d+\.\d+\.\d+\.\d+)"
    )
    for match in inet_re.finditer(out):
        ip, mask = match.group(1), match.group(2)
        if ip.startswith("127."):
            continue
        if mask.startswith("0x"):
            mask = _hex_netmask_to_dotted(mask)
        try:
            net = ipaddress.IPv4Network(f"{ip}/{mask}", strict=False)
            return str(net)
        except ValueError:
            continue
    return None


# ── ARP cache ─────────────────────────────────────────────────────────────────

def build_arp_cache() -> dict[str, str]:
    """
    Run `arp -a` and return {ip: mac} for all cached entries.
    macOS format: ? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope ...
    """
    cache: dict[str, str] = {}
    try:
        out = subprocess.check_output(["arp", "-a"], text=True, stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return cache

    arp_re = re.compile(r"\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:]{11,17})")
    for match in arp_re.finditer(out):
        cache[match.group(1)] = match.group(2)
    return cache


# ── Host probing ──────────────────────────────────────────────────────────────

# Common ports tried during TCP host discovery. Fast in-process probe avoids
# the subprocess overhead of `ping` and finds hosts that block ICMP.
_PROBE_PORTS = (80, 443, 22, 445, 139, 8080, 53, 631, 5000, 7000)


def ping_host(ip: str, timeout: float = 1.0) -> bool:
    """Return True if host accepts a TCP connection on any common port.

    Despite the name (kept for API stability), this uses TCP connect rather
    than ICMP — faster and works on hosts that drop pings.
    """
    deadline = time.monotonic() + timeout
    per_port = max(0.05, timeout / len(_PROBE_PORTS))
    for port in _PROBE_PORTS:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.settimeout(min(per_port, remaining))
            err = sock.connect_ex((ip, port))
            # 0 = open, ECONNREFUSED = host alive but port closed (also a signal)
            if err == 0 or err == 61:
                return True
        except OSError:
            pass
        finally:
            sock.close()
    return False


def resolve_hostname(ip: str) -> str:
    """Reverse DNS lookup; returns empty string on failure."""
    try:
        return socket.gethostbyaddr(ip)[0]
    except (socket.herror, socket.gaierror):
        return ""


# ── Scanning ──────────────────────────────────────────────────────────────────

def _worker(
    ip_q: queue.Queue,
    timeout: float,
    arp_cache: dict[str, str],
    results: list,
    lock: threading.Lock,
    progress,
    task_id,
) -> None:
    while True:
        try:
            ip = ip_q.get_nowait()
        except queue.Empty:
            break

        try:
            if ping_host(ip, timeout):
                mac = arp_cache.get(ip, "")
                hostname = resolve_hostname(ip)
                with lock:
                    results.append({"ip": ip, "mac": mac, "hostname": hostname})
        except Exception:
            pass

        progress.advance(task_id)
        ip_q.task_done()


def scan_network(
    network: str,
    timeout: float = 1.0,
    num_threads: int = 100,
) -> list[dict]:
    """
    Ping every host in the subnet; enrich live hosts with MAC and hostname.
    Returns a list of dicts sorted by IP.
    """
    try:
        net = ipaddress.IPv4Network(network, strict=False)
    except ValueError as exc:
        console.print(f"[red]Error:[/red] invalid network '{network}': {exc}")
        sys.exit(1)

    hosts = [str(h) for h in net.hosts()]
    if not hosts:
        return []

    arp_cache = build_arp_cache()   # pre-populate before threads start

    ip_q: queue.Queue = queue.Queue()
    for ip in hosts:
        ip_q.put(ip)

    results: list[dict] = []
    lock = threading.Lock()

    with Progress(
        TextColumn("[bold cyan]Scanning[/bold cyan]"),
        BarColumn(bar_width=40),
        MofNCompleteColumn(),
        TextColumn("[dim]{task.fields[found]} found[/dim]"),
        console=console,
        transient=True,
    ) as progress:
        task_id = progress.add_task("scan", total=len(hosts), found=0)

        threads = [
            threading.Thread(
                target=_worker,
                args=(ip_q, timeout, arp_cache, results, lock, progress, task_id),
                daemon=True,
            )
            for _ in range(min(num_threads, len(hosts)))
        ]
        for t in threads:
            t.start()

        while any(t.is_alive() for t in threads):
            progress.update(task_id, found=len(results))
            time.sleep(0.1)

        for t in threads:
            t.join()
        progress.update(task_id, found=len(results))

    # Rebuild ARP cache once after probing finishes — TCP connects populate
    # the kernel's ARP table, so hosts missing MACs initially should resolve now.
    fresh = build_arp_cache()
    for r in results:
        if not r["mac"]:
            r["mac"] = fresh.get(r["ip"], "")

    results.sort(key=lambda r: ipaddress.IPv4Address(r["ip"]))
    return results


# ── Output ────────────────────────────────────────────────────────────────────

def build_table(results: list[dict], network: str) -> Table:
    """Render discovered hosts as a rich Table."""
    table = Table(
        title=f"[bold]LAN Scan — {network}[/bold]",
        show_lines=False,
        header_style="bold magenta",
        border_style="dim",
        min_width=70,
    )
    table.add_column("#", style="dim", justify="right", width=4)
    table.add_column("IP Address", style="cyan", width=16)
    table.add_column("MAC Address", style="yellow", width=20)
    table.add_column("Hostname", style="white", no_wrap=False)

    for i, host in enumerate(results, 1):
        table.add_row(
            str(i),
            host["ip"],
            host["mac"] or "—",
            host["hostname"] or "—",
        )
    return table


def save_results(
    results: list[dict],
    network: str,
    elapsed: float,
    started: datetime,
    output_format: str = "text",
    save_dir: str | None = None,
) -> None:
    """Write results to a timestamped file as text or JSON."""
    import os
    out_dir = os.path.expanduser(save_dir) if save_dir else os.path.expanduser("~/network_tools/scans/lan_scans")
    os.makedirs(out_dir, exist_ok=True)

    stamp = started.strftime("%Y-%m-%d_%H-%M-%S")
    safe_net = network.replace("/", "-").replace(".", "_")

    if output_format == "json":
        filename = os.path.join(out_dir, f"lan_{safe_net}_{stamp}.json")
        payload = {
            "network": network,
            "started": started.strftime("%Y-%m-%d %H:%M:%S"),
            "elapsed_seconds": round(elapsed, 2),
            "host_count": len(results),
            "hosts": results,
        }
        with open(filename, "w") as f:
            json.dump(payload, f, indent=2)
    else:
        filename = os.path.join(out_dir, f"lan_{safe_net}_{stamp}.txt")
        lines = [
            "LAN Scan Report",
            f"Network : {network}",
            f"Started : {started.strftime('%Y-%m-%d %H:%M:%S')}",
            f"Elapsed : {elapsed:.2f}s",
            f"Hosts   : {len(results)} found",
            "",
            f"{'#':<4} {'IP Address':<18} {'MAC Address':<20} Hostname",
            "-" * 70,
        ]
        for i, host in enumerate(results, 1):
            lines.append(
                f"{i:<4} {host['ip']:<18} {host['mac'] or '—':<20} {host['hostname'] or '—'}"
            )
        with open(filename, "w") as f:
            f.write("\n".join(lines) + "\n")

    console.print(f"[dim]Results saved → {filename}[/dim]")


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="LAN host discovery with MAC address enrichment via ARP.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python3 lan_scanner.py                        # auto-detect local network
  python3 lan_scanner.py -n 192.168.1.0/24
  python3 lan_scanner.py -n 10.0.0.0/24 --output json
  python3 lan_scanner.py --timeout 2 --threads 50
""",
    )
    parser.add_argument(
        "-n", "--network",
        metavar="CIDR",
        help="Target network in CIDR notation (e.g. 192.168.1.0/24). "
             "Auto-detected from ifconfig if omitted.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=1.0,
        metavar="SEC",
        help="Ping timeout per host in seconds [default: 1.0]",
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
        help="Directory to save results (default: ~/network_tools/scans/lan_scans)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    network = args.network
    if not network:
        network = get_local_network()
        if not network:
            console.print(
                "[red]Error:[/red] could not auto-detect local network. "
                "Specify one with -n (e.g. -n 192.168.1.0/24)"
            )
            sys.exit(1)
        console.print(f"[dim]Auto-detected network:[/dim] [cyan]{network}[/cyan]")

    net = ipaddress.IPv4Network(network, strict=False)
    console.print(
        f"\n[bold]Network:[/bold] {network}  "
        f"[bold]Hosts:[/bold] {net.num_addresses - 2}  "
        f"[bold]Threads:[/bold] {args.threads}  "
        f"[bold]Timeout:[/bold] {args.timeout}s"
    )
    console.print(f"[dim]Started {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}[/dim]\n")

    started = datetime.now()
    results = scan_network(network, args.timeout, args.threads)
    elapsed = (datetime.now() - started).total_seconds()

    if not results:
        console.print(
            f"[yellow]No hosts found[/yellow] in {elapsed:.2f}s "
            f"({net.num_addresses - 2} addresses scanned)"
        )
    else:
        console.print(build_table(results, network))
        console.print(
            f"\n[dim]Scanned {net.num_addresses - 2} addresses in {elapsed:.2f}s — "
            f"[green]{len(results)} host{'s' if len(results) != 1 else ''} up[/green][/dim]\n"
        )

    save_results(results, network, elapsed, started, args.output, args.save_dir)


if __name__ == "__main__":
    main()
