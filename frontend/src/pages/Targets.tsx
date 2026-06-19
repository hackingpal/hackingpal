// Targets — first-class registry of things the tools can run against.
//
// Sections grouped by `kind`:
//   • Labs (auto-registered when a lab starts; soft-deleted on stop)
//   • Manual (user-added via the + Add form below)
//   • Tailscale / SSH / LAN — discovered on demand, picked individually
//
// Active-target selection lives in localStorage (see lib/targets) so it
// survives page navigation. Tool pages that opt in pre-fill their target
// field from it.

import { useCallback, useEffect, useState } from "react";
import {
  Target, TargetKind, ScopeTag,
  listTargets, createTarget, deleteTarget,
  getActiveTargetId, setActiveTarget, useActiveTargetId,
  discoverTailscale, discoverSsh, discoverLan,
  TailscalePeer, SshHost, LanHost,
} from "../lib/targets";
import { useActiveEngagementId } from "../lib/engagement";

type Props = { onJumpTo: (id: string) => void };

const KIND_LABEL: Record<TargetKind, string> = {
  lab:       "Labs",
  manual:    "Manual",
  tailscale: "Tailscale",
  ssh:       "SSH",
  lan:       "LAN",
};

export default function Targets({ onJumpTo }: Props) {
  const activeEngagementId = useActiveEngagementId();
  const activeTargetId = useActiveTargetId();
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const ts = await listTargets();
      setTargets(ts);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Group by kind
  const grouped: Record<TargetKind, Target[]> = {
    lab: [], manual: [], tailscale: [], ssh: [], lan: [],
  };
  for (const t of targets) {
    if (t.kind in grouped) grouped[t.kind].push(t);
  }

  const totalActive = targets.length;

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">SCOPE</div>
        <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
          Targets
        </h2>
        <p className="mt-1 text-[12px] text-ink-muted leading-snug">
          A registry of hosts and labs you can aim the tools at. The active
          target pre-fills every tool page's target field.
          {activeEngagementId ? null : (
            <>
              {" "}<button
                onClick={() => onJumpTo("engagements")}
                className="text-accent hover:underline"
              >Set an active engagement</button> to bind manual targets to it.
            </>
          )}
        </p>
        <div className="mt-2 flex items-center gap-3 text-[11px] font-mono">
          <span className="text-ink-dim">{totalActive} target{totalActive === 1 ? "" : "s"}</span>
          {activeTargetId && (
            <button
              onClick={() => setActiveTarget(null)}
              className="text-ink-dim hover:text-ink-primary underline decoration-dotted"
              title="Clear active target"
            >
              clear active
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && <ErrorBanner msg={error} onDismiss={() => setError(null)} />}

        <AddManualForm
          activeEngagementId={activeEngagementId}
          onAdded={() => void refresh()}
        />

        <Section
          title={`${KIND_LABEL.lab} (${grouped.lab.length})`}
          empty="No labs running. Start one from the Labs page to see it here."
          onJumpToSource={() => onJumpTo("labs")}
          sourceLabel="Open Labs →"
        >
          {grouped.lab.map((t) => (
            <TargetRow key={t.id} t={t} activeId={activeTargetId}
                       onActivate={setActiveTarget} onRemove={() => void deleteAndRefresh(t.id, refresh, setError)} />
          ))}
        </Section>

        <Section
          title={`${KIND_LABEL.manual} (${grouped.manual.length})`}
          empty="No manual targets yet. Use the form above to add one."
        >
          {grouped.manual.map((t) => (
            <TargetRow key={t.id} t={t} activeId={activeTargetId}
                       onActivate={setActiveTarget} onRemove={() => void deleteAndRefresh(t.id, refresh, setError)} />
          ))}
        </Section>

        <DiscoverySection
          title={KIND_LABEL.tailscale}
          existing={grouped.tailscale}
          activeId={activeTargetId}
          discover={async () => {
            const r = await discoverTailscale();
            return { available: r.available, items: r.peers, error: r.error };
          }}
          renderItem={(p: TailscalePeer) => (
            <span>
              <span className={p.online ? "text-phos" : "text-ink-dim"}>●</span>{" "}
              {p.name}
              <span className="ml-2 text-ink-dim font-mono text-[11px]">
                {p.address} · {p.os}
              </span>
            </span>
          )}
          itemToTarget={(p: TailscalePeer) => ({
            name:        p.name,
            address:     p.address,
            kind:        "tailscale",
            scope_tag:   "owned",
            source_meta: { dns_name: p.dns_name, os: p.os, online: p.online },
          })}
          onActivate={setActiveTarget}
          onRemove={(id) => void deleteAndRefresh(id, refresh, setError)}
          onAdded={() => void refresh()}
        />

        <DiscoverySection
          title={KIND_LABEL.ssh}
          existing={grouped.ssh}
          activeId={activeTargetId}
          discover={async () => {
            const r = await discoverSsh();
            return { available: r.available, items: r.hosts, error: r.error };
          }}
          renderItem={(h: SshHost) => (
            <span>
              {h.name}
              <span className="ml-2 text-ink-dim font-mono text-[11px]">
                {h.user ? `${h.user}@` : ""}{h.address}:{h.port}
              </span>
            </span>
          )}
          itemToTarget={(h: SshHost) => ({
            name:        h.name,
            address:     h.address,
            kind:        "ssh",
            scope_tag:   "owned",
            source_meta: { user: h.user, port: h.port, identity_file: h.identity_file },
          })}
          onActivate={setActiveTarget}
          onRemove={(id) => void deleteAndRefresh(id, refresh, setError)}
          onAdded={() => void refresh()}
        />

        <DiscoverySection
          title={KIND_LABEL.lan}
          existing={grouped.lan}
          activeId={activeTargetId}
          discover={async () => {
            const r = await discoverLan();
            return { available: r.available, items: r.hosts, error: r.error };
          }}
          renderItem={(h: LanHost) => (
            <span>
              {h.hostname || h.address}
              <span className="ml-2 text-ink-dim font-mono text-[11px]">
                {h.address}{h.mac ? ` · ${h.mac}` : ""}{h.is_self ? " · this Mac" : ""}
              </span>
            </span>
          )}
          itemToTarget={(h: LanHost) => ({
            name:        h.hostname || h.address,
            address:     h.address,
            kind:        "lan",
            scope_tag:   "owned",
            source_meta: { mac: h.mac, hostname: h.hostname, is_self: h.is_self },
          })}
          onActivate={setActiveTarget}
          onRemove={(id) => void deleteAndRefresh(id, refresh, setError)}
          onAdded={() => void refresh()}
        />

        {loading && <div className="text-ink-dim text-[12px]">Loading targets…</div>}
      </div>
    </div>
  );
}

async function deleteAndRefresh(
  id: string, refresh: () => Promise<void>, onError: (s: string) => void,
) {
  try {
    if (id === getActiveTargetId()) setActiveTarget(null);
    await deleteTarget(id);
    await refresh();
  } catch (e) {
    onError(humanError(e));
  }
}

// ── Manual add form ─────────────────────────────────────────────────────────

function AddManualForm({ activeEngagementId, onAdded }: {
  activeEngagementId: string | null; onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [scopeTag, setScopeTag] = useState<ScopeTag>("authorized");
  const [bindToEngagement, setBindToEngagement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !address.trim()) return;
    try {
      setBusy(true);
      setErr(null);
      await createTarget({
        name: name.trim(),
        address: address.trim(),
        kind: "manual",
        scope_tag: scopeTag,
        engagement_id: bindToEngagement ? activeEngagementId : null,
      });
      setName(""); setAddress("");
      onAdded();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }, [name, address, scopeTag, bindToEngagement, activeEngagementId, onAdded]);

  return (
    <form onSubmit={submit} className="border border-divider rounded p-3 space-y-2 bg-bg-card">
      <div className="text-[10px] uppercase tracking-widest text-ink-dim font-bold">
        Add manual target
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Prod web)"
          className={inputCls()}
          disabled={busy}
        />
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address (host, IP, or URL)"
          className={inputCls()}
          disabled={busy}
        />
      </div>
      <div className="flex items-center gap-3 text-[11px] font-mono text-ink-muted">
        <label className="flex items-center gap-1.5">
          Scope:
          <select
            value={scopeTag}
            onChange={(e) => setScopeTag(e.target.value as ScopeTag)}
            className={selectInline()}
            disabled={busy}
          >
            <option value="authorized">authorized</option>
            <option value="owned">owned</option>
            <option value="manual">manual</option>
          </select>
        </label>
        {activeEngagementId && (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={bindToEngagement}
              onChange={(e) => setBindToEngagement(e.target.checked)}
              disabled={busy}
            />
            Bind to active engagement
          </label>
        )}
        <button
          type="submit"
          disabled={busy || !name.trim() || !address.trim()}
          className="ml-auto bg-accent text-white text-[11px] font-bold px-3 py-1 rounded
                     hover:bg-accentDim transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {err && <div className="text-danger text-[11px] font-mono">{err}</div>}
    </form>
  );
}

// ── Section + Row primitives ────────────────────────────────────────────────

function Section({
  title, empty, children, onJumpToSource, sourceLabel,
}: {
  title: string; empty: string; children: React.ReactNode;
  onJumpToSource?: () => void; sourceLabel?: string;
}) {
  const isEmpty = !children || (Array.isArray(children) && children.length === 0);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[12px] font-bold uppercase tracking-widest text-ink-primary">
          {title}
        </h3>
        {onJumpToSource && (
          <button
            onClick={onJumpToSource}
            className="text-[11px] text-accent hover:underline font-mono"
          >
            {sourceLabel}
          </button>
        )}
      </div>
      <div className="border border-divider rounded bg-bg-card divide-y divide-divider">
        {isEmpty ? (
          <div className="px-3 py-3 text-[12px] text-ink-dim italic">{empty}</div>
        ) : children}
      </div>
    </div>
  );
}

function TargetRow({ t, activeId, onActivate, onRemove }: {
  t: Target; activeId: string | null;
  onActivate: (t: Target) => void; onRemove: () => void;
}) {
  const isActive = activeId === t.id;
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-bg-base">
      <div className="flex-1 min-w-0">
        <div className={"text-[13px] truncate " + (isActive ? "text-accent font-bold" : "text-ink-primary")}>
          {t.name}
        </div>
        <div className="text-[11px] font-mono text-ink-dim truncate">
          {t.address}
          {t.engagement_id ? " · engagement-bound" : ""}
          {" · " + t.scope_tag}
        </div>
      </div>
      <button
        onClick={() => onActivate(t)}
        disabled={isActive}
        className={"text-[11px] px-2 py-0.5 rounded border " +
          (isActive
            ? "border-accent/60 text-accent bg-accent/10 cursor-default"
            : "border-divider text-ink-muted hover:text-ink-primary hover:border-ink-muted")}
      >
        {isActive ? "Active" : "Set active"}
      </button>
      <button
        onClick={onRemove}
        title="Remove from registry"
        className="text-ink-dim hover:text-danger text-base leading-none px-1"
      >
        ×
      </button>
    </div>
  );
}

// ── Discovery section ───────────────────────────────────────────────────────
// One generic component because tailscale / ssh / lan share the shape:
// list of existing in-registry rows + "Discover" button + per-candidate add.

type DiscoverResult<T> = { available: boolean; items: T[]; error?: string };

function DiscoverySection<T extends { address: string; name?: string }>({
  title, existing, activeId,
  discover, renderItem, itemToTarget,
  onActivate, onRemove, onAdded,
}: {
  title: string;
  existing: Target[];
  activeId: string | null;
  discover: () => Promise<DiscoverResult<T>>;
  renderItem: (item: T) => React.ReactNode;
  itemToTarget: (item: T) => Parameters<typeof createTarget>[0];
  onActivate: (t: Target) => void;
  onRemove: (id: string) => void;
  onAdded: () => void;
}) {
  const [items, setItems] = useState<T[] | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);

  const run = useCallback(async () => {
    try {
      setBusy(true); setErr(null);
      const r = await discover();
      setItems(r.items);
      setAvailable(r.available);
      if (r.error) setErr(r.error);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }, [discover]);

  const adopt = useCallback(async (item: T) => {
    try {
      setAddingKey(item.address);
      await createTarget(itemToTarget(item));
      onAdded();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setAddingKey(null);
    }
  }, [itemToTarget, onAdded]);

  const existingAddrs = new Set(existing.map((t) => t.address));

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[12px] font-bold uppercase tracking-widest text-ink-primary">
          {title} ({existing.length})
        </h3>
        <button
          onClick={() => void run()}
          disabled={busy}
          className="text-[11px] text-accent hover:underline font-mono disabled:opacity-50"
        >
          {busy ? "Discovering…" : items === null ? "Discover" : "Re-discover"}
        </button>
      </div>
      <div className="border border-divider rounded bg-bg-card divide-y divide-divider">
        {existing.map((t) => (
          <TargetRow key={t.id} t={t} activeId={activeId}
                     onActivate={onActivate} onRemove={() => onRemove(t.id)} />
        ))}
        {existing.length === 0 && items === null && (
          <div className="px-3 py-3 text-[12px] text-ink-dim italic">
            Click Discover to look for {title.toLowerCase()} candidates.
          </div>
        )}
        {available === false && (
          <div className="px-3 py-2 text-[11px] text-amber font-mono">
            {title} source not available on this machine.
          </div>
        )}
        {err && (
          <div className="px-3 py-2 text-[11px] text-danger font-mono">
            {err}
          </div>
        )}
        {items && items.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-ink-dim
                            bg-bg-base/50 font-bold">
              Candidates
            </div>
            {items.map((item) => {
              const already = existingAddrs.has(item.address);
              return (
                <div key={item.address}
                     className="flex items-center gap-3 px-3 py-2 hover:bg-bg-base">
                  <div className="flex-1 min-w-0 text-[13px] text-ink-primary truncate">
                    {renderItem(item)}
                  </div>
                  <button
                    onClick={() => void adopt(item)}
                    disabled={already || addingKey === item.address}
                    className={"text-[11px] px-2 py-0.5 rounded border " +
                      (already
                        ? "border-ink-dim/40 text-ink-dim cursor-default"
                        : "border-divider text-accent hover:bg-accent hover:text-white")}
                  >
                    {already ? "Added" : addingKey === item.address ? "Adding…" : "+ Add"}
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div className="border border-danger/40 bg-danger/10 text-danger rounded px-3 py-2
                    text-sm font-mono flex items-start gap-3">
      <span className="flex-1">Error — {msg}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-lg leading-none font-bold">×</button>
    </div>
  );
}

function humanError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

const inputCls = () =>
  "w-full bg-bg-base border border-divider rounded px-2 py-1 text-[13px] font-mono " +
  "text-ink-primary placeholder:text-ink-dim focus:outline-none focus:border-accent " +
  "disabled:opacity-60";
const selectInline = () =>
  "bg-bg-base border border-divider rounded px-1.5 py-0.5 text-[11px] font-mono " +
  "text-ink-primary focus:outline-none focus:border-accent disabled:opacity-60";
