"""Per-user settings (Anthropic API key) stored in the macOS Keychain.

Uses the `security` CLI shipped with macOS — no extra Python deps, and the key
stays encrypted at rest under the user's login keychain.
"""
from __future__ import annotations

import os
import subprocess

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.auth import require_local_auth

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(require_local_auth)])

KEYCHAIN_SERVICE = "MyHackingPal"
KEYCHAIN_ACCOUNT = "anthropic_api_key"

# Additional named keys for external services (subdomain enum sources etc.).
# Naming convention: the keychain account is the value passed to keychain_get_named.
NAMED_KEYS = {
    "securitytrails_api_key": "SecurityTrails API key",
    "virustotal_api_key":     "VirusTotal API key",
    "shodan_api_key":         "Shodan API key",
    "hibp_api_key":           "HaveIBeenPwned API key",
    "github_token":           "GitHub personal access token",
    "google_cse_api_key":     "Google Custom Search API key",
    "google_cse_id":          "Google Custom Search engine ID (cx)",
    "censys_api_id":          "Censys API ID",
    "censys_api_secret":      "Censys API secret",
    "hunter_api_key":         "Hunter.io API key",
}


def keychain_get_named(account: str) -> str | None:
    try:
        r = subprocess.run(
            ["security", "find-generic-password",
             "-a", account, "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True, text=True, timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    return r.stdout.strip() or None


def keychain_set_named(account: str, value: str) -> None:
    r = subprocess.run(
        ["security", "add-generic-password",
         "-a", account, "-s", KEYCHAIN_SERVICE, "-w", value, "-U"],
        capture_output=True, text=True, timeout=5,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "keychain write failed")


def keychain_delete_named(account: str) -> bool:
    r = subprocess.run(
        ["security", "delete-generic-password",
         "-a", account, "-s", KEYCHAIN_SERVICE],
        capture_output=True, text=True, timeout=5,
    )
    return r.returncode == 0


# Back-compat helpers — the original chat router uses these.
def keychain_get() -> str | None:
    # Env var first so Linux/Docker deployments (no `security` CLI) can still
    # supply an Anthropic key without writing to disk.
    env_key = os.environ.get("ANTHROPIC_API_KEY")
    if env_key:
        return env_key.strip()
    return keychain_get_named(KEYCHAIN_ACCOUNT)


def keychain_set(value: str) -> None:
    keychain_set_named(KEYCHAIN_ACCOUNT, value)


def keychain_delete() -> bool:
    return keychain_delete_named(KEYCHAIN_ACCOUNT)


class ApiKeyStatus(BaseModel):
    present: bool
    last4: str = ""


class ApiKeyBody(BaseModel):
    api_key: str = Field(..., min_length=10)


@router.get("/api-key/status", response_model=ApiKeyStatus)
def api_key_status() -> ApiKeyStatus:
    k = keychain_get()
    if not k:
        return ApiKeyStatus(present=False)
    return ApiKeyStatus(present=True, last4=k[-4:])


@router.post("/api-key", response_model=ApiKeyStatus)
def api_key_set(body: ApiKeyBody) -> ApiKeyStatus:
    key = body.api_key.strip()
    if not key.startswith("sk-ant-"):
        raise HTTPException(400, "Key must start with 'sk-ant-'")
    try:
        keychain_set(key)
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    return ApiKeyStatus(present=True, last4=key[-4:])


@router.delete("/api-key", response_model=ApiKeyStatus)
def api_key_delete() -> ApiKeyStatus:
    keychain_delete()
    return ApiKeyStatus(present=False)


# ── Named-key endpoints (SecurityTrails / VirusTotal / Shodan etc.) ─────────

class NamedKeyStatus(BaseModel):
    name: str
    label: str
    present: bool
    last4: str = ""


class NamedKeyBody(BaseModel):
    value: str = Field(..., min_length=4)


@router.get("/keys", response_model=list[NamedKeyStatus])
def list_named_keys() -> list[NamedKeyStatus]:
    out: list[NamedKeyStatus] = []
    for name, label in NAMED_KEYS.items():
        v = keychain_get_named(name)
        out.append(NamedKeyStatus(
            name=name, label=label,
            present=bool(v), last4=v[-4:] if v else "",
        ))
    return out


@router.post("/keys/{name}", response_model=NamedKeyStatus)
def set_named_key(name: str, body: NamedKeyBody) -> NamedKeyStatus:
    if name not in NAMED_KEYS:
        raise HTTPException(404, f"Unknown key name: {name}")
    try:
        keychain_set_named(name, body.value.strip())
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    return NamedKeyStatus(name=name, label=NAMED_KEYS[name],
                          present=True, last4=body.value.strip()[-4:])


@router.delete("/keys/{name}", response_model=NamedKeyStatus)
def delete_named_key(name: str) -> NamedKeyStatus:
    if name not in NAMED_KEYS:
        raise HTTPException(404, f"Unknown key name: {name}")
    keychain_delete_named(name)
    return NamedKeyStatus(name=name, label=NAMED_KEYS[name], present=False)
