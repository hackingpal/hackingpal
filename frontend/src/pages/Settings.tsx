// Central Settings page. The roadmap calls this out as a v1.0 critical
// item: API keys were previously only managable via curl (for named keys)
// or through the chat-bubble settings panel (for the Anthropic key), with
// no single place for the user to see what was configured.
//
// Sections:
//   - System: backend version, platform, hostname, Python version, refresh
//   - Anthropic API key (chat assistant)
//   - External API keys (10 keys for OSINT / cloud / breach sources)
//   - Appearance (theme cycle)
//   - Engagement quick-links (Engagements list, Findings, Audit log)
//
// Out of scope for this first cut:
//   - Lab vs Engagement mode toggle (needs deeper product design — the
//     audit_log already auto-classifies based on engagement-id presence).
//   - Sudoers cleanup UI (just shows current install status; revoke happens
//     via the existing tcpdump/nmap pages or `sudo rm /etc/sudoers.d/...`).
//   - Restart sidecar / clear engagement DB (destructive ops we want
//     confirmation flows for; out of v1 settings scope).

import { useCallback, useEffect, useState } from "react";
import {
  api,
  deleteApiKey, deleteNamedKey,
  fetchApiKeyStatus, fetchNamedKeys, fetchSystemInfo,
  fetchTcpdumpStatus, fetchNmapStatus,
  setApiKey, setNamedKey,
  type ApiKeyStatus, type NamedKeyStatus,
  type SystemInfo, type TcpdumpStatus, type NmapStatus,
} from "../api";
import { useTheme } from "../lib/theme";

type Health = { status: string; version: string; pid: string };

type Props = {
  onJumpTo: (id: string) => void;
};

export default function Settings({ onJumpTo }: Props) {
  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
          Utilities
        </div>
        <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
          Settings
        </h2>
        <p className="mt-1 text-[11px] text-ink-dim max-w-2xl">
          API keys, system info, appearance. Keys live in the OS keychain —
          MyHackingPal never writes them to disk.
        </p>
      </header>

      <div className="p-6 space-y-6 max-w-3xl">
        <SystemSection />
        <AnthropicKeySection />
        <NamedKeysSection />
        <PrivilegedToolsSection />
        <AppearanceSection />
        <EngagementLinksSection onJumpTo={onJumpTo} />
      </div>
    </div>
  );
}

// ── System ─────────────────────────────────────────────────────────────────

function SystemSection() {
  const [health, setHealth] = useState<Health | null>(null);
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [h, s] = await Promise.all([
        api<Health>("/health").catch(() => null),
        fetchSystemInfo().catch(() => null),
      ]);
      setHealth(h);
      setSysInfo(s);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Section title="System" hint="Sidecar runtime + platform — useful when filing a bug.">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
        <Row label="Backend version" value={health?.version ?? "—"} />
        <Row label="Backend PID"     value={health?.pid ?? "—"} />
        <Row label="Status"          value={health?.status ?? "unreachable"}
             tone={health?.status === "ok" ? "text-phos" : "text-danger"} />
        <Row label="Platform"        value={sysInfo?.system ?? "—"} />
        <Row label="Release"         value={sysInfo?.release ?? "—"} />
        <Row label="Architecture"    value={sysInfo?.arch ?? "—"} />
        <Row label="Hostname"        value={sysInfo?.hostname ?? "—"} />
        <Row label="Python"          value={sysInfo?.python_version ?? "—"} />
      </div>
      <div className="mt-3">
        <button onClick={refresh} disabled={refreshing}
                className="px-3 py-1.5 rounded bg-bg-base border border-divider
                           text-[11px] text-ink-primary hover:border-accent
                           disabled:opacity-40">
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </Section>
  );
}

// ── Anthropic key ──────────────────────────────────────────────────────────

function AnthropicKeySection() {
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try { setStatus(await fetchApiKeyStatus()); }
    catch { setStatus({ present: false }); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function save() {
    const k = input.trim();
    if (!k) return;
    setBusy(true); setError("");
    try {
      setStatus(await setApiKey(k));
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remove the saved Anthropic API key from the Keychain?")) return;
    setBusy(true); setError("");
    try { setStatus(await deleteApiKey()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Section title="Anthropic API key" hint="Powers the AI chat assistant (claude-opus-4-7).">
      {status?.present ? (
        <div className="flex items-center gap-3 text-[12px]">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-phos" />
          <span className="text-ink-primary">
            Configured · ending <code className="text-amber">…{status.last4}</code>
          </span>
          <button onClick={remove} disabled={busy}
                  className="ml-auto px-2 py-0.5 rounded border border-divider
                             text-[11px] text-ink-muted hover:border-danger
                             hover:text-danger disabled:opacity-40">
            Remove
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="sk-ant-…"
            disabled={busy}
            className="flex-1 bg-bg-base border border-divider rounded
                       px-2 py-1.5 text-[12px] font-mono text-ink-primary
                       focus:outline-none focus:border-accent"
          />
          <button onClick={save} disabled={busy || !input.trim()}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px]
                             font-bold disabled:opacity-40">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      )}
      {error && <div className="mt-2 text-[11px] text-danger">⚠ {error}</div>}
    </Section>
  );
}

// ── Named external-service keys ────────────────────────────────────────────

function NamedKeysSection() {
  const [keys, setKeys] = useState<NamedKeyStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setKeys(await fetchNamedKeys()); }
    catch { setKeys([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Section title="External API keys"
             hint="OSINT / breach / cloud / search sources. Each unlocks the matching tool.">
      {loading && keys.length === 0 ? (
        <div className="text-[12px] text-ink-dim italic">Loading…</div>
      ) : keys.length === 0 ? (
        <div className="text-[12px] text-ink-dim italic">
          Backend hasn't reported any configurable keys yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {keys.map((k) => (
            <NamedKeyRow key={k.name} initial={k} onChange={refresh} />
          ))}
        </div>
      )}
    </Section>
  );
}

function NamedKeyRow({ initial, onChange }: {
  initial: NamedKeyStatus; onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(initial);

  useEffect(() => { setStatus(initial); }, [initial]);

  async function save() {
    const v = input.trim();
    if (!v) return;
    setBusy(true); setError("");
    try {
      setStatus(await setNamedKey(status.name, v));
      setInput("");
      setEditing(false);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove the ${status.label} from the Keychain?`)) return;
    setBusy(true); setError("");
    try {
      setStatus(await deleteNamedKey(status.name));
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-divider/40 last:border-0">
      <span className={"inline-block w-1.5 h-1.5 rounded-full " +
                       (status.present ? "bg-phos" : "bg-ink-dim")} />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-ink-primary truncate">
          {status.label}
        </div>
        <div className="text-[10px] text-ink-dim font-mono truncate">
          {status.name}
          {status.present && status.last4 && (
            <span className="ml-1.5 text-amber">…{status.last4}</span>
          )}
        </div>
      </div>
      {!editing ? (
        <>
          <button onClick={() => { setEditing(true); setInput(""); setError(""); }}
                  disabled={busy}
                  className="px-2 py-0.5 rounded bg-bg-base border border-divider
                             text-[11px] text-ink-primary hover:border-accent
                             disabled:opacity-40">
            {status.present ? "Replace" : "Set"}
          </button>
          {status.present && (
            <button onClick={remove} disabled={busy}
                    className="px-2 py-0.5 rounded border border-divider
                               text-[11px] text-ink-muted hover:border-danger
                               hover:text-danger disabled:opacity-40">
              Remove
            </button>
          )}
        </>
      ) : (
        <>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="paste secret"
            disabled={busy}
            autoFocus
            className="w-64 bg-bg-base border border-divider rounded
                       px-2 py-1 text-[11px] font-mono text-ink-primary
                       focus:outline-none focus:border-accent"
          />
          <button onClick={save} disabled={busy || !input.trim()}
                  className="px-2 py-0.5 rounded bg-accent text-white text-[11px]
                             font-bold disabled:opacity-40">
            {busy ? "…" : "Save"}
          </button>
          <button onClick={() => { setEditing(false); setInput(""); }}
                  disabled={busy}
                  className="px-2 py-0.5 rounded border border-divider
                             text-[11px] text-ink-muted disabled:opacity-40">
            Cancel
          </button>
        </>
      )}
      {error && (
        <div className="absolute right-6 mt-7 text-[10px] text-danger">⚠ {error}</div>
      )}
    </div>
  );
}

// ── Privileged tools (sudoers status, read-only) ──────────────────────────

function PrivilegedToolsSection() {
  const [tcp, setTcp] = useState<TcpdumpStatus | null>(null);
  const [nmap, setNmap] = useState<NmapStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [t, n] = await Promise.all([
        fetchTcpdumpStatus().catch(() => null),
        fetchNmapStatus().catch(() => null),
      ]);
      if (alive) { setTcp(t); setNmap(n); setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <Section title="Privileged tools" hint="Sudoers drop-ins for tcpdump + nmap.">
        <div className="text-[12px] text-ink-dim italic">Loading…</div>
      </Section>
    );
  }

  return (
    <Section title="Privileged tools"
             hint="Sudoers drop-ins let tcpdump + nmap SYN/UDP/OS scans run without re-prompting. Revoke with `sudo rm /etc/sudoers.d/network-tools-<tool>`.">
      <div className="space-y-1.5 text-[12px]">
        <StatusLine label="tcpdump"
                    installed={!!tcp?.passwordless}
                    detail={tcp?.passwordless
                      ? (tcp.sudoers_path || "/etc/sudoers.d/network-tools-tcpdump")
                      : "not installed (install on the TCPDump page)"} />
        <StatusLine label="nmap (SYN/UDP/OS)"
                    installed={!!nmap?.passwordless}
                    detail={nmap?.passwordless
                      ? (nmap.sudoers_path || "/etc/sudoers.d/network-tools-nmap")
                      : "not installed (install on the Nmap page)"} />
      </div>
    </Section>
  );
}

function StatusLine({ label, installed, detail }: {
  label: string; installed: boolean; detail: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={"inline-block w-1.5 h-1.5 rounded-full " +
                       (installed ? "bg-phos" : "bg-ink-dim")} />
      <span className="text-ink-primary w-40">{label}</span>
      <span className="text-ink-muted font-mono text-[11px]">{detail}</span>
    </div>
  );
}

// ── Appearance ─────────────────────────────────────────────────────────────

function AppearanceSection() {
  const theme = useTheme();
  const choices: { id: typeof theme.choice; label: string; hint: string }[] = [
    { id: "dark",   label: "Dark",   hint: "the default" },
    { id: "light",  label: "Light",  hint: "" },
    { id: "system", label: "System", hint: `currently ${theme.resolved}` },
  ];
  return (
    <Section title="Appearance" hint="Theme is persisted to localStorage.">
      <div className="flex gap-2">
        {choices.map((c) => (
          <button key={c.id}
                  onClick={() => theme.setChoice(c.id)}
                  className={
                    "px-3 py-1.5 rounded text-[12px] " +
                    (theme.choice === c.id
                      ? "bg-accent text-white font-bold"
                      : "bg-bg-base border border-divider text-ink-primary hover:border-accent")
                  }>
            {c.label}
            {c.hint && (
              <span className={"ml-1.5 text-[10px] " +
                               (theme.choice === c.id ? "text-white/70" : "text-ink-dim")}>
                {c.hint}
              </span>
            )}
          </button>
        ))}
      </div>
    </Section>
  );
}

// ── Engagement quick-links ────────────────────────────────────────────────

function EngagementLinksSection({ onJumpTo }: { onJumpTo: (id: string) => void }) {
  const links: { id: string; label: string; hint: string }[] = [
    { id: "engagements", label: "Engagements",
      hint: "Create, switch, archive engagements + GitHub export" },
    { id: "findings",    label: "Findings",
      hint: "Promote scan results, attach screenshots, write up risks" },
    { id: "audit-log",   label: "Audit log",
      hint: "Append-only record of every tool invocation" },
  ];
  return (
    <Section title="Engagement workspace"
             hint="Quick-links to the engagement-centric pages.">
      <div className="grid grid-cols-3 gap-2">
        {links.map((l) => (
          <button key={l.id}
                  onClick={() => onJumpTo(l.id)}
                  className="text-left p-3 rounded bg-bg-base border border-divider
                             hover:border-accent transition">
            <div className="text-[12px] font-bold text-ink-primary">{l.label}</div>
            <div className="mt-0.5 text-[10px] text-ink-dim">{l.hint}</div>
          </button>
        ))}
      </div>
    </Section>
  );
}

// ── Shared layout helpers ─────────────────────────────────────────────────

function Section({ title, hint, children }: {
  title: string; hint: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-divider bg-bg-card">
      <header className="px-4 py-2.5 border-b border-divider">
        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-muted font-bold">
          {title}
        </div>
        <div className="mt-0.5 text-[11px] text-ink-dim">{hint}</div>
      </header>
      <div className="p-4 relative">{children}</div>
    </section>
  );
}

function Row({ label, value, tone }: {
  label: string; value: string; tone?: string;
}) {
  return (
    <>
      <div className="text-ink-muted">{label}</div>
      <div className={"font-mono text-ink-primary " + (tone ?? "")}>{value}</div>
    </>
  );
}
