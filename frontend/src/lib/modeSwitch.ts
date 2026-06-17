// Wrapper around setMode that also writes an audit-log row. Kept in its
// own file so both ModePill and Settings can call it without recreating
// the api ↔ mode import cycle (api.ts imports getMode; mode.ts must not
// import api.ts back).
//
// The audit POST is fire-and-forget — the local mode change always
// happens, audit failure is swallowed so a transient network blip
// can't trap the user in the wrong mode.

import { auditModeSwitch } from "../api";
import { getMode, setMode, type Mode } from "./mode";

export function switchMode(next: Mode): void {
  const old = getMode();
  setMode(next);
  if (old !== next) {
    void auditModeSwitch(old, next).catch(() => { /* best-effort */ });
  }
}
