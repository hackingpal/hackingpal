// Shared types + in-memory cache for the tool-requirements registry.
// The list endpoint is fetched at most once per session; readiness is
// per-tool and refetched on demand (since the user may install a binary
// or paste an API key between visits to a page).

import { useEffect, useState } from "react";
import { api } from "../api";

export type BinaryReq = { name: string; install_hint: string };
export type ApiKeyReq = {
  provider: string;
  env_var?: string | null;
  keyring?: string | null;
  how_to: string;
};
export type SetupReq = {
  binaries: BinaryReq[];
  api_keys: ApiKeyReq[];
  sudoers: boolean;
  sudoers_file?: string | null;
  platforms: ("darwin" | "linux" | "win32")[];
  network_required: boolean;
  docker_required: boolean;
};
export type ToolRequirement = {
  id: string;
  name: string;
  category: string;
  router: string;
  endpoints: string[];
  target_format: string;
  target_examples: string[];
  setup: SetupReq;
  expected_output: string;
  notes?: string | null;
};
export type ReadinessCheck = {
  ready: boolean;
  missing: {
    binaries: string[];
    api_keys: string[];
    sudoers: boolean;
    platform: boolean;
  };
};

let _listCache: ToolRequirement[] | null = null;
let _listPromise: Promise<ToolRequirement[]> | null = null;
const _byIdCache = new Map<string, ToolRequirement | null>();
const _readinessCache = new Map<string, ReadinessCheck>();

export async function fetchAllToolRequirements(): Promise<ToolRequirement[]> {
  if (_listCache) return _listCache;
  if (!_listPromise) {
    _listPromise = (async () => {
      try {
        const r = await api<{ tools: ToolRequirement[] }>("/tools/requirements");
        _listCache = r.tools;
        for (const t of r.tools) _byIdCache.set(t.id, t);
        return r.tools;
      } catch {
        _listCache = [];
        return [];
      }
    })();
  }
  return _listPromise;
}

export async function fetchToolRequirement(id: string): Promise<ToolRequirement | null> {
  if (_byIdCache.has(id)) return _byIdCache.get(id) ?? null;
  // Make sure the list has loaded so byId is populated.
  await fetchAllToolRequirements();
  return _byIdCache.get(id) ?? null;
}

export async function fetchToolReadiness(id: string, force = false): Promise<ReadinessCheck | null> {
  if (!force && _readinessCache.has(id)) return _readinessCache.get(id)!;
  try {
    const r = await api<ReadinessCheck>(`/tools/requirements/${id}/check`);
    _readinessCache.set(id, r);
    return r;
  } catch {
    return null;
  }
}

export function clearReadinessCache(): void {
  _readinessCache.clear();
}

export function useToolRequirement(id: string): {
  req: ToolRequirement | null;
  readiness: ReadinessCheck | null;
  loading: boolean;
  refetch: () => void;
} {
  const [req, setReq] = useState<ToolRequirement | null>(null);
  const [readiness, setReadiness] = useState<ReadinessCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const r = await fetchToolRequirement(id);
      const rd = r ? await fetchToolReadiness(id, tick > 0) : null;
      if (cancelled) return;
      setReq(r);
      setReadiness(rd);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, tick]);

  return { req, readiness, loading, refetch: () => setTick((n) => n + 1) };
}
