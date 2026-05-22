// Planned-tools catalog — user-defined stubs that surface in the sidebar
// under a "PLANNED" section, opening a placeholder page that just shows the
// description. Persisted to localStorage; survives across launches.
//
// Each planned tool gets a nav id like `planned:<slug>` so it doesn't collide
// with the typed built-in NavId union.

import { useEffect, useState } from "react";

export type PlannedTool = {
  id: string;          // "planned:<slug>"
  label: string;
  description: string;
  addedAt: string;     // ISO timestamp
};

const STORAGE_KEY = "mhp:planned-tools:v1";

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function load(): PlannedTool[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlannedTool[]) : [];
  } catch {
    return [];
  }
}

function save(list: PlannedTool[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota — ignore */
  }
}

let cache: PlannedTool[] = load();
const listeners = new Set<() => void>();
function notify() { for (const l of listeners) l(); }

export function getPlannedTools(): PlannedTool[] {
  return cache;
}

export function isPlannedId(id: string): boolean {
  return id.startsWith("planned:");
}

export function findPlannedTool(id: string): PlannedTool | undefined {
  return cache.find((t) => t.id === id);
}

/**
 * Add a planned tool. Returns the new entry's id, or null if the label was
 * empty / a duplicate. Duplicates are detected by slug.
 */
export function addPlannedTool(label: string, description: string): string | null {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return null;
  const slug = slugify(trimmedLabel);
  if (!slug) return null;
  const id = `planned:${slug}`;
  if (cache.some((t) => t.id === id)) return null;
  cache = [...cache, { id, label: trimmedLabel, description: description.trim(), addedAt: new Date().toISOString() }];
  save(cache);
  notify();
  return id;
}

export function removePlannedTool(id: string): void {
  cache = cache.filter((t) => t.id !== id);
  save(cache);
  notify();
}

/**
 * Remove planned tools whose label matches any in `labels` (case-insensitive,
 * trimmed). Returns the number removed. Used by the catalog's "clean up built
 * tools" button.
 */
export function removePlannedToolsByLabel(labels: string[]): number {
  const targets = new Set(labels.map((l) => l.trim().toLowerCase()));
  const before = cache.length;
  cache = cache.filter((t) => !targets.has(t.label.trim().toLowerCase()));
  const removed = before - cache.length;
  if (removed > 0) {
    save(cache);
    notify();
  }
  return removed;
}

/** Labels of every catalog suggestion we've built — used for cleanup matching. */
export const BUILT_CATALOG_LABELS: string[] = [
  // Active Directory
  "LDAP Enumerator", "Kerberoasting", "AS-REP Roasting",
  "BloodHound Ingestor", "SMB Enumerator", "AD Password Sprayer",
  // Cloud
  "AWS Enumeration", "Azure Recon", "GCP Recon",
  "IMDS Tester", "S3 Bucket Scanner",
  // OSINT
  "Breach Data Lookup", "LinkedIn Scraper", "Google Dorking",
  "Paste / GitHub Leak Scanner", "People Search Aggregator",
  "Shodan / Censys Query",
  // Wireless
  "WPA Handshake Capture", "Evil Twin Detector", "PMKID Attack",
  "Bluetooth Recon",
  // Post-Exploit
  "Payload Obfuscator", "C2 Beacon Simulator", "Credential Harvester",
  "Lateral Movement Planner", "Pivoting Helper",
  // Reporting
  "CVSS Calculator (built-in)", "Screenshot evidence attachments",
  "GitHub Issues export",
];

export function usePlannedTools(): PlannedTool[] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return cache;
}
