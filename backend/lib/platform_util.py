"""Centralised platform-detection helpers.

Routers used to scatter `sys.platform == "darwin"` / `IS_DARWIN` constants
across ~20 files. This module is the single source of truth — import
`IS_DARWIN`, `IS_LINUX`, `IS_WINDOWS` from here.

Also exposes:
  * `app_data_dir()` — the right per-user data directory for the active OS.
  * `require_not_windows()` / `require_darwin()` / `require_linux()` — raise
    HTTPException 501 with a useful detail when a router can't run on the
    current OS. Use these at the top of endpoint handlers that wrap binaries
    only available on a specific OS.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from fastapi import HTTPException

IS_DARWIN  = sys.platform == "darwin"
IS_LINUX   = sys.platform.startswith("linux")
IS_WINDOWS = sys.platform == "win32"


def app_data_dir(app_name: str = "MyHackingPal") -> Path:
    """Return (and create) the per-user data directory for this app.

    macOS:   ~/Library/Application Support/<app>/
    Windows: %APPDATA%/<app>/  (typically C:\\Users\\<u>\\AppData\\Roaming\\<app>)
    Linux:   $XDG_DATA_HOME/<app>/  or  ~/.local/share/<app>/  with
             ~/.config/<app>/ as a fallback if the dev workflow already
             populated it (legacy compat — kept for engagements.db).
    """
    if IS_DARWIN:
        base = Path.home() / "Library" / "Application Support" / app_name
    elif IS_WINDOWS:
        roaming = os.environ.get("APPDATA")
        base = Path(roaming) / app_name if roaming else Path.home() / "AppData" / "Roaming" / app_name
    else:
        # Linux — keep historical ~/.config/<app>/ if it already exists so
        # existing engagement DBs aren't orphaned. Otherwise use XDG_DATA_HOME.
        legacy = Path.home() / ".config" / app_name
        if legacy.exists():
            base = legacy
        else:
            xdg = os.environ.get("XDG_DATA_HOME")
            base = Path(xdg) / app_name if xdg else Path.home() / ".local" / "share" / app_name
    base.mkdir(parents=True, exist_ok=True)
    return base


def _format_hint(detail: str | None) -> str:
    return detail or "This endpoint is not supported on the current OS."


def require_not_windows(detail: str | None = None) -> None:
    if IS_WINDOWS:
        raise HTTPException(status_code=501, detail=_format_hint(detail))


def require_darwin(detail: str | None = None) -> None:
    if not IS_DARWIN:
        raise HTTPException(
            status_code=501,
            detail=detail or "This endpoint is macOS-only.",
        )


def require_linux(detail: str | None = None) -> None:
    if not IS_LINUX:
        raise HTTPException(
            status_code=501,
            detail=detail or "This endpoint is Linux-only.",
        )


def require_windows(detail: str | None = None) -> None:
    if not IS_WINDOWS:
        raise HTTPException(
            status_code=501,
            detail=detail or "This endpoint is Windows-only.",
        )


def require_unix(detail: str | None = None) -> None:
    """501 on Windows — for endpoints that work on both macOS and Linux."""
    if IS_WINDOWS:
        raise HTTPException(
            status_code=501,
            detail=detail or "This endpoint requires macOS or Linux.",
        )
