"""End-to-end integration via FastAPI's TestClient.

These tests run the real ASGI app — they exercise the full request
pipeline (auth dep, header parsing, scope check, router handler)
without booting uvicorn.

Network-touching code paths are intentionally not exercised here; we
test the *gating* (deny in Engagement mode without an engagement, allow
in Lab mode, etc.) so the assertion targets the response status before
any outbound request happens.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from lib import engagements


@pytest.fixture
def client(temp_db, monkeypatch):
    """Boot the real app against the temp DB, with a known auth token."""
    monkeypatch.setenv("MHP_BACKEND_HOST", "127.0.0.1")
    # Force a deterministic auth token so we don't have to fetch /auth/token.
    from lib import auth as auth_mod
    monkeypatch.setattr(auth_mod, "AUTH_TOKEN", "testing-token")
    # TestClient reports `client.host == "testclient"`, which the loopback
    # guard would reject. Treat it as loopback for the test process only.
    monkeypatch.setattr(
        auth_mod, "_LOOPBACK_HOSTS",
        auth_mod._LOOPBACK_HOSTS | {"testclient"},
    )

    from main import app
    return TestClient(app)


AUTH = {"X-MHP-Token": "testing-token"}


# ── auth + health ───────────────────────────────────────────────────────────

def test_health_open_no_auth(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_auth_gated_endpoint_rejects_missing_token(client):
    """Tool endpoints carrying `require_local_auth` reject requests without
    the `X-MHP-Token` header. `/whois/...` is the cheapest example —
    `/engagements` is intentionally open to localhost callers."""
    r = client.get("/whois/example.com")
    assert r.status_code == 403


# ── engagements CRUD via the API ────────────────────────────────────────────

def test_engagements_crud_roundtrip(client):
    r = client.post("/engagements", headers=AUTH, json={
        "name": "ACME Q1",
        "scope": ["*.example.com"],
        "exclusions": ["admin.example.com"],
        "notes": "",
    })
    assert r.status_code == 200, r.text
    eid = r.json()["id"]

    listed = client.get("/engagements", headers=AUTH).json()
    assert any(e["id"] == eid for e in listed["engagements"])

    patched = client.patch(f"/engagements/{eid}", headers=AUTH,
                           json={"name": "ACME Q1 — external"}).json()
    assert patched["name"] == "ACME Q1 — external"

    client.delete(f"/engagements/{eid}", headers=AUTH)
    assert client.get(f"/engagements/{eid}", headers=AUTH).status_code == 404


# ── scope gating in the live request pipeline ───────────────────────────────

def test_scope_denied_in_engagement_mode_without_engagement(client):
    """A target-accepting endpoint must 403 in Engagement mode if no engagement
    is active. This exercises the X-MHP-Mode header → get_mode → scope.enforce_rest
    chain that's wired into every gated router."""
    r = client.get("/ct/search/example.com",
                   headers={**AUTH, "X-MHP-Mode": "engagement"})
    assert r.status_code == 403
    body = r.json()
    # MhpError envelope: { error, code, ... }
    assert body["code"] == "TARGET_DENIED"


def test_scope_denied_with_stale_engagement_id(client):
    r = client.get("/ct/search/example.com", headers={
        **AUTH, "X-MHP-Mode": "engagement", "X-MHP-Engagement-Id": "ghost",
    })
    assert r.status_code == 403
    assert r.json()["code"] == "TARGET_DENIED"


def test_scope_allowed_in_engagement_mode_when_target_in_scope(client, temp_db):
    """In-scope target should pass the scope check. External targets still
    trip the target_policy 'warn' layer (RFC1918 / loopback guard), so we
    pass `confirm=true` to acknowledge that and isolate the scope gate.
    Downstream call may fail on network — we accept anything *but* 403/409."""
    eng = engagements.create_engagement(
        name="acme", scope=["example.com"], exclusions=[], notes="",
    )
    r = client.get("/ct/search/example.com?confirm=true", headers={
        **AUTH, "X-MHP-Mode": "engagement", "X-MHP-Engagement-Id": eng["id"],
    })
    assert r.status_code not in (403, 409), \
        f"expected scope to allow; got {r.status_code}: {r.text[:200]}"


def test_scope_blocks_out_of_scope_target(client, temp_db):
    eng = engagements.create_engagement(
        name="acme", scope=["example.com"], exclusions=[], notes="",
    )
    r = client.get("/ct/search/attacker.com", headers={
        **AUTH, "X-MHP-Mode": "engagement", "X-MHP-Engagement-Id": eng["id"],
    })
    assert r.status_code == 403
    assert r.json()["code"] == "TARGET_DENIED"


def test_scope_exclusion_blocks_even_inside_scope(client, temp_db):
    eng = engagements.create_engagement(
        name="acme",
        scope=["example.com"],
        exclusions=["admin.example.com"],
        notes="",
    )
    r = client.get("/ct/search/admin.example.com", headers={
        **AUTH, "X-MHP-Mode": "engagement", "X-MHP-Engagement-Id": eng["id"],
    })
    assert r.status_code == 403


# ── engagement-present gates on non-target tools ────────────────────────────
#
# Routers wired with `scope.enforce_engagement_present` (no concrete network
# target, but active actions that must attach to an engagement record). The
# gate must 403 in Engagement mode when no engagement is active; Lab mode
# (the default header value) lets the request fall through to its real
# handler.

@pytest.mark.parametrize("method,path,body", [
    # Active actions on the first wave (network-target-ish tools).
    ("POST", "/shodan-censys/query", {"service": "shodan", "query": "test"}),
    ("POST", "/terminal/exec",       {"command": "echo hi"}),
    ("POST", "/vpn/start",           None),
    ("POST", "/vpn/stop",            None),
    ("POST", "/processes/kill",      {"pid": 99999, "signal": "TERM",
                                      "admin": False, "confirm": True}),
    ("POST", "/processes/kill_bulk", {"pids": [99999], "signal": "TERM",
                                      "admin": False, "confirm": True}),
    ("GET",  "/bt/devices",          None),
    # Evidence-producing local-host audits — gated to match wifi.py precedent.
    ("GET",  "/linux/posture",       None),
    ("GET",  "/macos/posture",       None),
    ("GET",  "/windows/posture",     None),
    ("GET",  "/users/audit",         None),
    ("GET",  "/firewall/rules",      None),
    ("GET",  "/cred-harvest/scan",   None),
    # Stateful BloodHound graph + offline crack — also evidence-producing.
    ("POST", "/lateral/clear",       None),
    ("POST", "/hash/crack",          {"hash": "deadbeef"}),
])
def test_engagement_present_gate_denies_without_engagement(client, method, path, body):
    headers = {**AUTH, "X-MHP-Mode": "engagement"}
    if method == "POST":
        r = client.post(path, headers=headers, json=body)
    else:
        r = client.get(path, headers=headers)
    assert r.status_code == 403, f"{path}: expected 403, got {r.status_code}: {r.text[:200]}"
    assert r.json()["code"] == "TARGET_DENIED", r.text[:200]


def test_engagement_present_gate_allows_in_lab_mode(client):
    """Lab mode is the default; the gate is a no-op. Pick the cheapest endpoint
    (shodan_censys/query) and verify we sail past the gate — the request will
    then fail downstream for an unrelated reason (no API key configured),
    proving the scope check was not the rejecter."""
    r = client.post("/shodan-censys/query", headers={**AUTH, "X-MHP-Mode": "lab"},
                    json={"service": "shodan", "query": "test"})
    assert r.status_code != 403
    # Without a Shodan key configured, the handler raises UNAUTHORIZED (401).
    assert r.json().get("code") in ("UNAUTHORIZED", None)


# ── chat provider resolution ────────────────────────────────────────────────

def test_chat_config_reports_provider_when_no_key(client, monkeypatch):
    """With no API key and `claude` CLI present (dev environment), the
    auto-resolver should pick claude-cli. CI without the CLI on PATH should
    still parse the response — only the `provider` field changes."""
    r = client.get("/chat/config", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] in ("claude-cli", "anthropic")
    assert "usable" in body
