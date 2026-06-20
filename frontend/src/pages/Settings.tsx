// Central Settings page. The roadmap calls this out as a v1.0 critical
// item: API keys were previously only managable via curl (for named keys)
// or through the chat-bubble settings panel (for the Anthropic key), with
// no single place for the user to see what was configured.
//
// Sections:
//   - System: backend version, platform, hostname, Python version, refresh
//   - Anthropic API key (chat assistant)
//   - External API keys (10 keys for OSINT / cloud / breach sources)
//   - Mode (Lab vs Engagement)
//   - Appearance (theme cycle)
//   - Engagement quick-links (Engagements list, Findings, Audit log)
//
// Out of scope for this first cut:
//   - Sudoers cleanup UI (just shows current install status; revoke happens
//     via the existing tcpdump/nmap pages or `sudo rm /etc/sudoers.d/...`).
//   - Restart sidecar / clear engagement DB (destructive ops we want
//     confirmation flows for; out of v1 settings scope).

import { useCallback, useEffect, useState } from "react";
import { Button, StatusDot } from "performative-ui";
import {
  api,
  auditPromptEdit,
  deleteApiKey, deleteNamedKey,
  fetchApiKeyStatus, fetchNamedKeys, fetchSystemInfo,
  fetchTcpdumpStatus, fetchNmapStatus,
  fetchChatSettings, updateChatSettings,
  revokeTcpdumpSudoers, revokeNmapSudoers,
  setApiKey, setNamedKey,
  type ApiKeyStatus, type NamedKeyStatus,
  type SystemInfo, type TcpdumpStatus, type NmapStatus,
  type ChatSettings,
} from "../api";
import { useTheme } from "../lib/theme";
import { useMode } from "../lib/mode";
import { switchMode } from "../lib/modeSwitch";
import { useActiveEngagementId } from "../lib/engagement";
import {
  DOPAMINE_DEFAULTS, DOPAMINE_PRESETS,
  getSettings as getDopamineSettings,
  setSettings as setDopamineSettings,
  resetSettings as resetDopamineSettings,
  playNamed,
  type DopamineSettings, type DopamineMood,
} from "../lib/dopamine";

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
          HackingPal never writes them to disk.
        </p>
      </header>

      <div className="p-6 space-y-6 max-w-3xl">
        <SystemSection />
        <AnthropicKeySection />
        <AssistantSection />
        <NamedKeysSection />
        <PrivilegedToolsSection />
        <ModeSection onJumpTo={onJumpTo} />
        <AppearanceSection />
        <EffectsSection />
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

// ── Assistant (model + system prompt) ──────────────────────────────────────

const MODEL_LABELS: Record<string, { label: string; hint: string }> = {
  "claude-opus-4-7": {
    label: "Opus 4.7",
    hint: "Smartest, slowest, most expensive.",
  },
  "claude-sonnet-4-6": {
    label: "Sonnet 4.6",
    hint: "Recommended default — fast + plenty smart for explaining scans.",
  },
  "claude-haiku-4-5-20251001": {
    label: "Haiku 4.5",
    hint: "Fastest + cheapest. Weaker on multi-step reasoning.",
  },
};

function AssistantSection() {
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState("");

  const refresh = useCallback(async () => {
    try {
      const s = await fetchChatSettings();
      setSettings(s);
      setPrompt(s.system_prompt);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function pickModel(m: string) {
    setBusy(true); setError("");
    try {
      const updated = await updateChatSettings({ model: m });
      setSettings(updated);
      setSavedFlash("Model updated.");
      window.setTimeout(() => setSavedFlash(""), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function savePrompt() {
    setBusy(true); setError("");
    const before = settings?.system_prompt.length ?? 0;
    try {
      const updated = await updateChatSettings({ system_prompt: prompt });
      setSettings(updated);
      setSavedFlash("System prompt saved.");
      window.setTimeout(() => setSavedFlash(""), 2000);
      // Audit best-effort — save already succeeded; a failed audit POST
      // shouldn't unwind it.
      void auditPromptEdit(before, updated.system_prompt.length, updated.model)
        .catch(() => { /* best-effort */ });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function resetPrompt() {
    if (settings) setPrompt(settings.system_prompt);
  }

  if (!settings) {
    return (
      <Section title="Assistant" hint="Model + system prompt for the in-app AI chat.">
        <div className="text-[11px] text-ink-dim">Loading…</div>
      </Section>
    );
  }

  const dirty = settings.system_prompt !== prompt;

  return (
    <Section title="Assistant" hint="Model + system prompt for the in-app AI chat.">
      <div className="space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1.5">
            Model
          </div>
          <div className="flex flex-col gap-1.5">
            {settings.available_models.map((m) => {
              const meta = MODEL_LABELS[m] ?? { label: m, hint: "" };
              const active = settings.model === m;
              return (
                <label key={m}
                       className={"flex items-start gap-2 px-2.5 py-2 rounded border cursor-pointer transition " +
                         (active
                           ? "border-accent/60 bg-accent/10"
                           : "border-divider bg-bg-card hover:border-ink-muted")}>
                  <input type="radio" checked={active}
                         disabled={busy}
                         onChange={() => void pickModel(m)}
                         className="mt-0.5" />
                  <div className="flex-1">
                    <div className="text-[12px] font-bold text-ink-primary">
                      {meta.label}
                      <span className="ml-2 font-mono font-normal text-[10px] text-ink-dim">{m}</span>
                    </div>
                    {meta.hint && (
                      <div className="text-[10px] text-ink-muted mt-0.5">{meta.hint}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-widest text-ink-dim">
              System prompt
            </span>
            {settings.system_prompt_path && (
              <span className="text-[10px] font-mono text-ink-dim truncate">
                {settings.system_prompt_path}
              </span>
            )}
          </div>
          {settings.system_prompt_editable ? (
            <>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={10}
                disabled={busy}
                spellCheck={false}
                className="w-full bg-bg-base border border-divider rounded
                           px-2.5 py-2 text-[11px] font-mono text-ink-primary
                           focus:outline-none focus:border-accent resize-y"
              />
              <div className="flex items-center gap-2 mt-2">
                <button onClick={savePrompt}
                        disabled={busy || !dirty}
                        className="px-3 py-1.5 rounded bg-accent text-white text-[11px] font-bold
                                   disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy ? "Saving…" : "Save prompt"}
                </button>
                <button onClick={resetPrompt}
                        disabled={busy || !dirty}
                        className="px-3 py-1.5 rounded bg-bg-base border border-divider
                                   text-[11px] text-ink-muted hover:text-ink-primary
                                   disabled:opacity-40">
                  Revert
                </button>
                <span className="ml-auto text-[10px] text-ink-dim">
                  {prompt.length.toLocaleString()} chars
                </span>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-amber bg-amber/10 border border-amber/30 rounded p-2">
              System prompt is read-only — <code>MHP_CHAT_SYSTEM_PROMPT</code> env var is set,
              which overrides the file.
            </div>
          )}
        </div>

        {savedFlash && <div className="text-[11px] text-phos">{savedFlash}</div>}
        {error && <div className="text-[11px] text-danger">⚠ {error}</div>}
      </div>
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
    <div className="border-b border-divider/40 last:border-0">
      <div className="flex items-center gap-3 py-1.5">
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
      </div>
      {error && (
        <div className="pl-5 pb-1.5 text-[10px] text-danger">⚠ {error}</div>
      )}
    </div>
  );
}

// ── Privileged tools (sudoers status, read-only) ──────────────────────────

function PrivilegedToolsSection() {
  const [tcp, setTcp] = useState<TcpdumpStatus | null>(null);
  const [nmap, setNmap] = useState<NmapStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"tcpdump" | "nmap" | null>(null);
  const [error, setError] = useState<{ tool: "tcpdump" | "nmap"; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    const [t, n] = await Promise.all([
      fetchTcpdumpStatus().catch(() => null),
      fetchNmapStatus().catch(() => null),
    ]);
    setTcp(t);
    setNmap(n);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await refresh();
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [refresh]);

  async function revoke(tool: "tcpdump" | "nmap") {
    const target = tool === "tcpdump" ? "tcpdump" : "nmap (SYN/UDP/OS)";
    if (!confirm(
      `Remove the passwordless-sudo entry for ${target}?\n\n` +
      `Future scans that need root will prompt for your password again. ` +
      `You'll see the OS admin prompt next to authorize the removal.`,
    )) return;
    setBusy(tool); setError(null);
    try {
      if (tool === "tcpdump") await revokeTcpdumpSudoers();
      else                    await revokeNmapSudoers();
      await refresh();
    } catch (e) {
      setError({ tool, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <Section title="Privileged tools" hint="Sudoers drop-ins for tcpdump + nmap.">
        <div className="text-[12px] text-ink-dim italic">Loading…</div>
      </Section>
    );
  }

  return (
    <Section title="Privileged tools"
             hint="Sudoers drop-ins let tcpdump + nmap SYN/UDP/OS scans run without re-prompting. Use Revoke to remove with one click — the OS admin prompt covers the privileged file removal.">
      <div className="space-y-1.5 text-[12px]">
        <StatusLine label="tcpdump"
                    installed={!!tcp?.passwordless}
                    detail={tcp?.passwordless
                      ? (tcp.sudoers_path || "/etc/sudoers.d/network-tools-tcpdump")
                      : "not installed (install on the TCPDump page)"}
                    onRevoke={tcp?.passwordless ? () => revoke("tcpdump") : undefined}
                    busy={busy === "tcpdump"}
                    error={error?.tool === "tcpdump" ? error.msg : null} />
        <StatusLine label="nmap (SYN/UDP/OS)"
                    installed={!!nmap?.passwordless}
                    detail={nmap?.passwordless
                      ? (nmap.sudoers_path || "/etc/sudoers.d/network-tools-nmap")
                      : "not installed (install on the Nmap page)"}
                    onRevoke={nmap?.passwordless ? () => revoke("nmap") : undefined}
                    busy={busy === "nmap"}
                    error={error?.tool === "nmap" ? error.msg : null} />
      </div>
    </Section>
  );
}

function StatusLine({ label, installed, detail, onRevoke, busy, error }: {
  label: string; installed: boolean; detail: string;
  onRevoke?: () => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <StatusDot
          color={installed ? "rgb(var(--phos-rgb))" : "rgb(var(--ink-dim-rgb))"}
          static={!installed}
        />
        <span className="text-ink-primary w-40">{label}</span>
        <span className="text-ink-muted font-mono text-[11px] flex-1 truncate">{detail}</span>
        {onRevoke && (
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => { void onRevoke(); }}
            title="Remove the passwordless-sudo drop-in. You'll see the OS admin prompt."
          >
            Revoke
          </Button>
        )}
      </div>
      {error && (
        <div className="pl-5 pt-0.5 text-[10px] text-danger">⚠ {error}</div>
      )}
    </div>
  );
}

// ── Appearance ─────────────────────────────────────────────────────────────

// ── Mode (Lab vs Engagement) ───────────────────────────────────────────────

function ModeSection({ onJumpTo }: { onJumpTo: (id: string) => void }) {
  const mode = useMode();
  const activeId = useActiveEngagementId();
  const isEngagement = mode === "engagement";

  return (
    <Section
      title="Mode"
      hint="Lab is for free experimentation. Engagement enforces scope and auto-records evidence."
    >
      <div className="flex items-stretch gap-2">
        <button
          onClick={() => switchMode("lab")}
          className={
            "flex-1 text-left p-3 rounded border transition " +
            (!isEngagement
              ? "border-amber bg-bg-base"
              : "border-divider bg-bg-base hover:border-ink-muted")
          }
        >
          <div className="flex items-center gap-2">
            <span className={"inline-block w-1.5 h-1.5 rounded-full " +
              (!isEngagement ? "bg-amber" : "bg-ink-dim")} />
            <span className="text-[12px] font-bold text-ink-primary">Lab</span>
            {!isEngagement && (
              <span className="ml-auto text-[10px] uppercase tracking-wider text-amber">
                Active
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-ink-dim">
            Scope checks skipped. Auto-record suppressed. Use against your own
            targets — home lab, public test sites, your own infra.
          </div>
        </button>

        <button
          onClick={() => switchMode("engagement")}
          className={
            "flex-1 text-left p-3 rounded border transition " +
            (isEngagement
              ? "border-phos bg-bg-base"
              : "border-divider bg-bg-base hover:border-ink-muted")
          }
        >
          <div className="flex items-center gap-2">
            <span className={"inline-block w-1.5 h-1.5 rounded-full " +
              (isEngagement ? "bg-phos" : "bg-ink-dim")} />
            <span className="text-[12px] font-bold text-ink-primary">Engagement</span>
            {isEngagement && (
              <span className="ml-auto text-[10px] uppercase tracking-wider text-phos">
                Active
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-ink-dim">
            Scope enforced against the active engagement. Results auto-attach
            to the evidence timeline. Use for authorized assessments.
          </div>
        </button>
      </div>

      {isEngagement && !activeId && (
        <div className="mt-3 px-3 py-2 rounded border border-amber/40 bg-amber/5
                        text-[11px] text-amber">
          No active engagement. Target-accepting tools will be denied until
          you{" "}
          <button onClick={() => onJumpTo("engagements")}
                  className="underline hover:text-ink-primary">
            pick one
          </button>
          .
        </div>
      )}
    </Section>
  );
}

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

// ── Visual effects (Dopamine) ─────────────────────────────────────────────

const PREVIEW_EFFECTS: { id: Parameters<typeof playNamed>[0]; label: string;
                         hint: string }[] = [
  { id: "ripple",      label: "Radar sweep",      hint: "scan-start wavefronts" },
  { id: "solarbloom",  label: "Pulse",            hint: "scan-complete bloom" },
  { id: "inkstroke",   label: "Ink stroke",       hint: "auth confirmation" },
  { id: "confetti",    label: "Confetti",         hint: "celebratory burst" },
  { id: "heartburst",  label: "Heart burst",      hint: "warm acknowledgement" },
  { id: "lightning",   label: "Lightning",        hint: "sharp electric arc" },
  { id: "fail",        label: "Fail stamp",       hint: "error / critical" },
  { id: "comic",       label: "Comic impact",     hint: "BAM! / POW!" },
];

const MOODS: { id: DopamineMood; label: string; hint: string }[] = [
  { id: "serene",      label: "Serene",      hint: "quiet, cool" },
  { id: "celebratory", label: "Celebratory", hint: "warm, bright" },
  { id: "electric",    label: "Electric",    hint: "violet, alert (default)" },
];

function EffectsSection() {
  const [settings, setSettings] = useState<DopamineSettings>(() => getDopamineSettings());
  const [activePresetId, setActivePresetId] = useState<string | null>(() => detectPreset(getDopamineSettings()));
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);

  // Keep settings UI in sync if another part of the app changes them.
  useEffect(() => {
    function onChange(e: Event) {
      const next = (e as CustomEvent<DopamineSettings>).detail;
      if (next) {
        setSettings(next);
        setActivePresetId(detectPreset(next));
      }
    }
    window.addEventListener("mhp:dopamine-changed", onChange);
    return () => window.removeEventListener("mhp:dopamine-changed", onChange);
  }, []);

  function patch(p: Partial<DopamineSettings>) {
    const next = setDopamineSettings(p);
    setSettings(next);
    setActivePresetId(detectPreset(next));
  }

  function applyPreset(id: string) {
    const preset = DOPAMINE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const next = setDopamineSettings(preset.patch);
    setSettings(next);
    setActivePresetId(id);
  }

  function reset() {
    const next = resetDopamineSettings();
    setSettings(next);
    setActivePresetId(detectPreset(next));
  }

  async function preview(effect: Parameters<typeof playNamed>[0]) {
    setPreviewBusy(effect);
    try {
      // Preview always fires from the center of the viewport — the preview
      // buttons can be anywhere on the Settings page so anchoring to them
      // pushes the effect off-screen / clipped. Center reads cleanly.
      await playNamed(effect, { x: 0.5, y: 0.5 });
    } finally {
      window.setTimeout(() => setPreviewBusy((p) => p === effect ? null : p), 1500);
    }
  }

  const disabled = !settings.enabled;

  return (
    <Section title="Visual effects"
             hint="Powered by Dopamine. Fires on scan start, scan complete, and auth confirmation. Persists to localStorage.">
      {/* Master toggle */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-divider">
        <div>
          <div className="text-[12px] font-bold text-ink-primary">
            {settings.enabled ? "Effects enabled" : "Effects disabled"}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-dim">
            Master kill-switch. When off, every effect call across the app is a no-op.
            Reduced-motion preference always wins regardless of this setting.
          </div>
        </div>
        <button
          onClick={() => patch({ enabled: !settings.enabled })}
          className={
            "px-3 py-1.5 rounded text-[12px] font-bold transition " +
            (settings.enabled
              ? "bg-accent text-white"
              : "bg-bg-base border border-divider text-ink-primary hover:border-accent")
          }
        >
          {settings.enabled ? "On" : "Off"}
        </button>
      </div>

      {/* Vibe presets */}
      <div className={disabled ? "opacity-40 pointer-events-none" : ""}>
        <div className="text-[11px] uppercase tracking-widest text-ink-dim mb-2">
          Vibe preset
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          {DOPAMINE_PRESETS.map((p) => {
            const isActive = activePresetId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                title={p.hint}
                className={
                  "px-3 py-1.5 rounded text-[12px] transition " +
                  (isActive
                    ? "bg-accent text-white font-bold"
                    : "bg-bg-base border border-divider text-ink-primary hover:border-accent")
                }
              >
                {p.label}
                <span className={"ml-1.5 text-[10px] " +
                                 (isActive ? "text-white/70" : "text-ink-dim")}>
                  {p.hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* Mood picker */}
        <div className="text-[11px] uppercase tracking-widest text-ink-dim mb-2">
          Mood
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          {MOODS.map((m) => {
            const isActive = settings.mood === m.id;
            return (
              <button
                key={m.id}
                onClick={() => patch({ mood: m.id })}
                className={
                  "px-3 py-1.5 rounded text-[12px] transition " +
                  (isActive
                    ? "bg-accent text-white font-bold"
                    : "bg-bg-base border border-divider text-ink-primary hover:border-accent")
                }
              >
                {m.label}
                <span className={"ml-1.5 text-[10px] " +
                                 (isActive ? "text-white/70" : "text-ink-dim")}>
                  {m.hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* Fine-tune sliders */}
        <div className="grid grid-cols-1 gap-4 mb-5">
          <Slider
            label="Intensity"
            hint="Overall energy — higher = bigger, brighter"
            value={settings.intensity}
            onChange={(v) => patch({ intensity: v })}
          />
          <Slider
            label="Whimsy"
            hint="Playfulness — higher = more variation per fire"
            value={settings.whimsy}
            onChange={(v) => patch({ whimsy: v })}
          />
        </div>

        {/* Preview gallery */}
        <div className="text-[11px] uppercase tracking-widest text-ink-dim mb-2">
          Preview
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
          {PREVIEW_EFFECTS.map((e) => (
            <button
              key={e.id}
              onClick={() => void preview(e.id)}
              disabled={previewBusy === e.id}
              title={`Fire ${e.label} from the center of the page`}
              className="text-left p-2.5 rounded bg-bg-base border border-divider
                         hover:border-accent transition group disabled:opacity-50"
            >
              <div className="text-[12px] font-bold text-ink-primary group-hover:text-accent">
                {previewBusy === e.id ? "▶ Firing…" : e.label}
              </div>
              <div className="text-[10px] text-ink-dim mt-0.5">{e.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Reset */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-divider">
        <div className="text-[10px] text-ink-dim">
          Stored at <code className="text-ink-muted">localStorage["mhp:dopamine"]</code>
        </div>
        <button
          onClick={reset}
          className="px-3 py-1.5 rounded bg-bg-base border border-divider
                     text-[11px] text-ink-primary hover:border-accent"
          title={`Reset to enabled · electric · intensity ${DOPAMINE_DEFAULTS.intensity} · whimsy ${DOPAMINE_DEFAULTS.whimsy}`}
        >
          Reset to defaults
        </button>
      </div>
    </Section>
  );
}

function Slider({
  label, hint, value, onChange,
}: { label: string; hint: string; value: number;
     onChange: (v: number) => void }) {
  const pct = Math.round(value * 100);
  return (
    <label className="block">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[11px] uppercase tracking-widest text-ink-muted font-bold">
          {label}
        </span>
        <span className="text-[10px] text-ink-dim">{hint}</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-accent tabular-nums">
          {value.toFixed(2)} · {pct}%
        </span>
      </div>
      <input
        type="range"
        min={0} max={1} step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

/** Return the preset id whose patch exactly matches the current settings, or
 * null if the user has fine-tuned away from any quick-pick. */
function detectPreset(s: DopamineSettings): string | null {
  for (const p of DOPAMINE_PRESETS) {
    const merged: DopamineSettings = { ...DOPAMINE_DEFAULTS, ...p.patch };
    if (merged.enabled !== s.enabled) continue;
    if (!merged.enabled) return p.id;  // "Off" preset only depends on enabled
    if (Math.abs((merged.intensity ?? 0) - s.intensity) > 0.001) continue;
    if (Math.abs((merged.whimsy ?? 0) - s.whimsy) > 0.001) continue;
    return p.id;
  }
  return null;
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
