"""Engagement-scope enforcement.

Layered on top of `lib/target_policy.py`, which does the OS-level
IP-class check (loopback / private / Tailscale / external). This module
adds the *engagement-relative* check: "is this target inside the active
engagement's scope list, and not on its exclusions list?"

The two layers compose. A typical target-accepting endpoint calls both::

    from lib import scope, target_policy

    pol_verdict, pol_reason = target_policy.check_target(target)
    sc_verdict, sc_reason   = scope.check(target, engagement_id)

    # Most-restrictive wins. Order: deny > warn > allow.
    verdict, reason = scope.combine(
        (pol_verdict, pol_reason), (sc_verdict, sc_reason),
    )

Scope syntax (each entry is a string in `engagement.scope` /
`engagement.exclusions`):

    1.2.3.4                    exact IP
    1.2.3.0/24                 CIDR
    example.com                exact hostname OR any of its subdomains
    *.example.com              subdomains only (NOT the bare apex)
    https://example.com/path   URL — host extracted, path ignored
    sub.example.com            exact-or-subdomain match

Exclusion matches always deny, regardless of whether scope matches.
Empty scope means "no restriction" — the engagement is permissive
unless the user explicitly scopes it. This is the standard pentest
contract pattern: scope is opt-in.

Lab mode (no engagement_id) skips the scope check entirely. Once the
Lab/Engagement toggle lands (roadmap item #2), the mode flag will
explicitly drive this behaviour rather than just "engagement_id present".
"""
from __future__ import annotations

import ipaddress
import logging
from typing import Literal
from urllib.parse import urlparse

from lib import engagements

logger = logging.getLogger(__name__)

Verdict = Literal["allow", "warn", "deny"]
_RANK: dict[Verdict, int] = {"allow": 0, "warn": 1, "deny": 2}


def combine(
    a: tuple[Verdict, str], b: tuple[Verdict, str],
) -> tuple[Verdict, str]:
    """Return whichever of `a`/`b` is more restrictive (deny > warn > allow).

    Tie-breaks on `a` so policy-layer reasons surface first when both are
    "warn" — keeps the UI from flip-flopping between equally-bad reasons.
    """
    if _RANK[a[0]] >= _RANK[b[0]]:
        return a
    return b


def _host_from_target(target: str) -> str:
    """Strip URL scheme/path so we match on host only."""
    t = (target or "").strip()
    if "://" in t:
        try:
            t = urlparse(t).hostname or t
        except ValueError:
            pass
    # Strip optional port `host:1234`. Don't strip from IPv6 — those have
    # multiple colons and live in brackets when porty.
    if t.count(":") == 1 and not t.startswith("["):
        t = t.split(":", 1)[0]
    return t.lower().strip(".")


def _entry_matches(target_host: str, target_ip: ipaddress._BaseAddress | None,
                   entry: str) -> bool:
    """One scope/exclusion entry vs one (host, optional IP)."""
    e = (entry or "").strip().lower()
    if not e:
        return False
    # URL in scope entry — extract host, ignore path.
    e_host = _host_from_target(e)
    if not e_host:
        return False
    # CIDR / IP entry
    try:
        net = ipaddress.ip_network(e_host, strict=False)
        if target_ip is not None and target_ip in net:
            return True
        # If the target is itself an IP-shaped string, check that too.
        try:
            t_ip = ipaddress.ip_address(target_host)
            if t_ip in net:
                return True
        except ValueError:
            pass
        return False
    except ValueError:
        pass
    # Hostname entry
    if e_host.startswith("*."):
        suffix = e_host[2:]
        return target_host.endswith("." + suffix)
    # Bare host: match exact OR any subdomain (standard scope contract).
    return target_host == e_host or target_host.endswith("." + e_host)


def _resolve_optional(target_host: str) -> ipaddress._BaseAddress | None:
    """Cheap resolve — returns one IP or None. We use the policy layer's
    resolver via lazy import to avoid circular deps; on failure return
    None and let the host string still match by name."""
    try:
        return ipaddress.ip_address(target_host)
    except ValueError:
        pass
    try:
        from lib.target_policy import _resolve  # internal, but stable
        ips = _resolve(target_host)
        return ips[0] if ips else None
    except Exception:
        return None


def check_against(
    target: str, *, scope_list: list[str], exclusions: list[str],
) -> tuple[Verdict, str]:
    """Match `target` against an arbitrary scope + exclusions pair.

    Useful for previewing scope decisions without committing to an
    engagement record (e.g. the "scope editor" UI).
    """
    host = _host_from_target(target)
    if not host:
        return "deny", "empty target"
    ip = _resolve_optional(host)

    for entry in exclusions or []:
        if _entry_matches(host, ip, entry):
            return "deny", f"matched exclusion: {entry}"

    scope = [e for e in (scope_list or []) if e.strip()]
    if not scope:
        # Permissive default — no scope means no scope-imposed restriction.
        return "allow", "no scope set"

    for entry in scope:
        if _entry_matches(host, ip, entry):
            return "allow", f"matched scope: {entry}"

    return "deny", "target not in engagement scope"


def check(target: str, engagement_id: str | None) -> tuple[Verdict, str]:
    """Engagement-scope check for the active engagement.

    Returns `("allow", "lab mode")` when there's no engagement_id —
    Lab-mode callers can short-circuit without any DB hit. When an
    engagement_id is supplied but doesn't exist, the verdict is "deny"
    rather than "allow lab" — stale IDs from the frontend shouldn't
    silently bypass scope.
    """
    if not engagement_id:
        return "allow", "lab mode (no engagement)"
    try:
        eng = engagements.get_engagement(engagement_id)
    except Exception:
        logger.exception("scope: failed to load engagement %s", engagement_id)
        return "deny", "could not load engagement record"
    if not eng:
        return "deny", f"engagement {engagement_id} not found"
    return check_against(
        target,
        scope_list=eng.get("scope") or [],
        exclusions=eng.get("exclusions") or [],
    )


def check_combined(
    target: str, engagement_id: str | None,
) -> tuple[Verdict, str, dict[str, str]]:
    """Full check: target_policy + engagement scope.

    Returns `(verdict, reason, layers)` where `layers` is a dict mapping
    layer name to reason so the UI can show which layer triggered which
    verdict.
    """
    from lib import target_policy  # lazy import keeps this file's footprint minimal
    # target_policy raises through to the IDNA encoder for pathological
    # inputs like "..../etc/passwd" — we treat any unhandled crash from
    # the policy layer as a deny rather than letting it 500.
    try:
        pol_v, pol_r = target_policy.check_target(target)
    except Exception as e:
        pol_v, pol_r = "deny", f"target failed validation: {type(e).__name__}"
    sc_v,  sc_r  = check(target, engagement_id)
    verdict, _ = combine((pol_v, pol_r), (sc_v, sc_r))
    # Reason on the combined verdict prefers the layer that triggered it.
    if _RANK[pol_v] >= _RANK[sc_v]:
        reason = f"policy: {pol_r}"
    else:
        reason = f"scope: {sc_r}"
    return verdict, reason, {"policy": f"{pol_v}: {pol_r}",
                             "scope":  f"{sc_v}: {sc_r}"}
