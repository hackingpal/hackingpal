"""System info — tells the frontend what OS it's running on.

GET /system/info → {platform, arch, is_mac, is_windows, is_linux, hostname,
                    python_version, release}

Used by the renderer to hide platform-locked tools from the sidebar.
"""
from __future__ import annotations

import platform
import socket
import sys
from typing import Any

from fastapi import APIRouter

router = APIRouter(tags=["system"])


@router.get("/system/info")
def info() -> dict[str, Any]:
    plat = sys.platform   # "darwin" | "linux" | "win32"
    return {
        "platform": plat,
        "is_mac":     plat == "darwin",
        "is_linux":   plat == "linux",
        "is_windows": plat == "win32",
        "arch":           platform.machine(),
        "release":        platform.release(),
        "system":         platform.system(),
        "hostname":       socket.gethostname(),
        "python_version": sys.version.split()[0],
    }
