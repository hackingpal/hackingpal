// In-memory ring buffer of recent tool activity, used as context for the
// Claude chat. Every successful `api()` call lands here (see api.ts), and pages
// can opt-in to push additional events (e.g. WS "done" payloads) via record().

import { useEffect, useState } from "react";

export type SessionEvent = {
  ts: string;        // ISO timestamp
  category: string;  // path or human label (e.g. "/nmap/run", "Port Scanner: done")
  summary: string;   // short string, JSON-stringified + truncated if needed
};

const MAX_EVENTS = 50;
const SUMMARY_MAX = 1200;

let buffer: SessionEvent[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function summarize(value: unknown): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length > SUMMARY_MAX) s = s.slice(0, SUMMARY_MAX) + "…(truncated)";
  return s;
}

export function record(category: string, value: unknown): void {
  buffer = [
    ...buffer,
    { ts: new Date().toISOString(), category, summary: summarize(value) },
  ].slice(-MAX_EVENTS);
  notify();
}

export function clearLog(): void {
  buffer = [];
  notify();
}

export function snapshot(): SessionEvent[] {
  return buffer.slice();
}

export function useSessionLog(): SessionEvent[] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return buffer;
}
