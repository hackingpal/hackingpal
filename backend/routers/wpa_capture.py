"""WPA Handshake / PMKID Capture wrapper.

We can't realistically capture handshakes from the Mac's built-in WiFi card —
Apple removed monitor-mode access in modern macOS, even for `airport sniff`.
This router does three things instead:

  1. Detects whether `aircrack-ng`, `airodump-ng`, `hcxdumptool` are installed
     (via Homebrew).
  2. Lists wireless interfaces — flags any USB external adapters distinct
     from the internal `en0`.
  3. Streams output from a chosen capture command if invoked. The user supplies
     the interface (likely an external adapter routed to a Linux VM or USB-IF
     adapter), and we shell out.

For real captures, the user typically wants Kali in a VM with USB passthrough
of an Alfa-class adapter. This page exists to keep all wireless tooling under
one roof.
"""
from __future__ import annotations

import asyncio
import shutil
import subprocess
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from lib.platform_util import require_darwin

router = APIRouter(prefix="/wpa-capture", tags=["wpa-capture"])

# Tools we know about + their roles
TOOL_INFO = {
    "aircrack-ng": "Crack captured WPA handshakes against a wordlist.",
    "airodump-ng": "Capture frames; the standard handshake-capture tool.",
    "aireplay-ng": "Inject deauth frames to trigger reconnection.",
    "hcxdumptool": "Capture PMKID (modern WPA2 attack — no client needed).",
    "hcxpcapngtool": "Convert .pcapng to hashcat 22000 format.",
    "hashcat":      "Crack PMKID / handshake hashes (modes 22000 / 2500).",
}


@router.get("/status")
def status() -> dict[str, Any]:
    """Detect installed wireless tools + list wireless interfaces (best effort)."""
    require_darwin("WPA capture wraps macOS-native networksetup + Homebrew "
                   "aircrack-ng tooling. For Win/Linux, use Kali in a VM with "
                   "USB-WiFi passthrough.")
    tools: dict[str, dict[str, Any]] = {}
    for name, descr in TOOL_INFO.items():
        path = shutil.which(name)
        tools[name] = {"installed": bool(path), "path": path or "", "description": descr}

    # Interface list via `networksetup -listallhardwareports` (macOS)
    ifaces: list[dict[str, Any]] = []
    try:
        r = subprocess.run(
            ["networksetup", "-listallhardwareports"],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0:
            current_block: dict[str, str] = {}
            for line in r.stdout.splitlines():
                line = line.strip()
                if not line:
                    if current_block.get("Device"):
                        ifaces.append({
                            "device": current_block.get("Device", ""),
                            "name":   current_block.get("Hardware Port", ""),
                            "mac":    current_block.get("Ethernet Address", ""),
                            "is_wifi": "wi-fi" in current_block.get("Hardware Port", "").lower()
                                       or "wifi" in current_block.get("Hardware Port", "").lower(),
                            "is_usb":  "usb" in current_block.get("Hardware Port", "").lower(),
                        })
                    current_block = {}
                elif ":" in line:
                    k, _, v = line.partition(":")
                    current_block[k.strip()] = v.strip()
            if current_block.get("Device"):
                ifaces.append({
                    "device": current_block.get("Device", ""),
                    "name":   current_block.get("Hardware Port", ""),
                    "mac":    current_block.get("Ethernet Address", ""),
                    "is_wifi": "wi-fi" in current_block.get("Hardware Port", "").lower(),
                    "is_usb":  "usb" in current_block.get("Hardware Port", "").lower(),
                })
    except Exception:
        pass

    return {
        "tools": tools,
        "interfaces": ifaces,
        "macos_note": (
            "macOS removed monitor-mode + frame-injection from the built-in WiFi card "
            "(airport sniff). For real handshake / PMKID captures you need an "
            "external USB adapter routed to a Kali Linux VM via USB passthrough — "
            "the AWUS036ACS / AWUS036ACH are common picks."
        ),
    }


@router.websocket("/ws/run")
async def run_capture(ws: WebSocket) -> None:
    """Stream output from a user-chosen capture command.

    init = {"argv": ["airodump-ng", "-c", "6", "--bssid", "AA:BB:...", "wlan0mon"]}
    """
    await ws.accept()
    stop = asyncio.Event()

    async def listen_for_stop() -> None:
        try:
            while True:
                msg = await ws.receive_json()
                if isinstance(msg, dict) and msg.get("action") == "stop":
                    stop.set(); return
        except Exception:
            stop.set()

    proc: asyncio.subprocess.Process | None = None
    try:
        init = await ws.receive_json()
        argv = list(init.get("argv") or [])
        if not argv:
            await ws.send_json({"type": "error", "detail": "argv required"})
            await ws.close(); return

        # Allow only known tools
        binary = argv[0].split("/")[-1]
        if binary not in TOOL_INFO:
            await ws.send_json({"type": "error",
                "detail": f"refusing to run {binary!r} (not in allowlist)"})
            await ws.close(); return

        path = shutil.which(binary)
        if not path:
            await ws.send_json({"type": "error",
                "detail": f"{binary!r} not installed (try `brew install aircrack-ng hcxdumptool`)"})
            await ws.close(); return

        await ws.send_json({"type": "started", "cmd": [path] + argv[1:]})
        listener = asyncio.create_task(listen_for_stop())

        proc = await asyncio.create_subprocess_exec(
            path, *argv[1:],
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        assert proc.stdout
        async for raw in proc.stdout:
            if stop.is_set():
                proc.terminate(); break
            line = raw.decode(errors="replace").rstrip("\n")
            await ws.send_json({"type": "line", "text": line})

        rc = await proc.wait()
        listener.cancel()
        await ws.send_json({"type": "done", "rc": rc, "stopped": stop.is_set()})
    except WebSocketDisconnect:
        stop.set()
        if proc and proc.returncode is None:
            proc.terminate()
    except Exception as exc:
        try:
            await ws.send_json({"type": "error",
                                "detail": f"{type(exc).__name__}: {exc}"})
        except Exception:
            pass
        if proc and proc.returncode is None:
            try: proc.terminate()
            except Exception: pass
    finally:
        try: await ws.close()
        except Exception: pass
