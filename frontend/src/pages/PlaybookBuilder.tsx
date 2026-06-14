/**
 * Playbook Builder — three-mode workspace for designing security playbooks
 * for apps you own.
 *
 *   1. Copilot Suggest  — describe your app, get a tailored playbook.
 *   2. Basic Check      — quick, conservative baseline scan.
 *   3. Custom Builder   — hand-pick tools and assemble your own playbook.
 *
 * Plays the same engagement-first / approval-card story as SelfAssess, but
 * focused on home-app builders rather than triage of an unknown target.
 */
import { useEffect, useState } from "react";
import { api, authFetch, parseError } from "../api";
import SeverityBadge, { normalizeSeverity, type Severity } from "../components/SeverityBadge";

type Mode = "suggest" | "basic" | "custom";

// ── Copilot Suggest types (match playbook_suggest.py) ──────────────────────

type SuggestedStep = {
  id: string;
  tool: string;
  rationale: string;
  options: Record<string, unknown>;
};

type SuggestedPhase = {
  name: string;
  steps: SuggestedStep[];
};

type SuggestedPlaybook = {
  id: string;
  name: string;
  description: string;
  target_type: string;
  category: string;
  mode_required: string;
  author: string;
  steps: Array<{
    id: string; tool: string; rationale: string;
    approval: boolean; options: Record<string, unknown>;
  }>;
  phases: SuggestedPhase[];
};

type SuggestResponse = {
  playbook_name: string;
  rationale: string;
  playbook: SuggestedPlaybook;
};

// ── Basic Check types (match basic_check.py) ───────────────────────────────

type DnsResult = {
  host: string;
  a: string[];
  aaaa: string[];
  ns: string[];
  mx: string[];
  resolved: boolean;
};

type TlsResult = {
  attempted: boolean;
  handshake_ok: boolean;
  version: string | null;
  cipher: string | null;
  cert_cn: string | null;
  cert_expiry: string | null;
  error: string | null;
};

type HeaderResult = {
  attempted: boolean;
  status: number | null;
  server: string | null;
  headers_present: string[];
  headers_missing: string[];
  error: string | null;
};

type OpenPort = { port: number; service: string; banner: string };

type PortResult = {
  scanned: number;
  open: OpenPort[];
  elapsed: number;
};

type RiskItem = { severity: string; label: string; detail: string };

type RiskSummary = { overall: string; items: RiskItem[] };

type BasicCheckResponse = {
  target: string;
  canonical: string;
  elapsed_ms: number;
  dns: DnsResult;
  tls: TlsResult;
  headers: HeaderResult;
  ports: PortResult;
  risk_summary: RiskSummary;
};

// ── Custom builder types ───────────────────────────────────────────────────

type CustomStep = {
  uid: string;        // local-only id (for React keys); becomes `id` on save
  tool: string;
  rationale: string;
};

type Props = { onJumpTo: (id: string) => void };

export default function PlaybookBuilder({ onJumpTo }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>("suggest");

  // Shared
  const [target, setTarget] = useState("");

  // Suggest
  const [appDescription, setAppDescription] = useState("");
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const [suggestion, setSuggestion] = useState<SuggestResponse | null>(null);
  const [savedAs, setSavedAs] = useState<string | null>(null);

  // Basic
  const [basicLoading, setBasicLoading] = useState(false);
  const [basicError, setBasicError] = useState("");
  const [basic, setBasic] = useState<BasicCheckResponse | null>(null);

  // Custom
  const [catalog, setCatalog] = useState<string[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customSteps, setCustomSteps] = useState<CustomStep[]>([]);
  const [customSaveError, setCustomSaveError] = useState("");
  const [customSavedAs, setCustomSavedAs] = useState<string | null>(null);
  // Picker state for the "add step" form.
  const [pickerTool, setPickerTool] = useState("");
  const [pickerRationale, setPickerRationale] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ tools: string[] }>("/presets/_meta/tools");
        if (!cancelled) setCatalog(r.tools);
      } catch (e) {
        if (!cancelled) {
          setCatalogError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Copilot Suggest ──────────────────────────────────────────────────────

  async function runSuggest(): Promise<void> {
    if (!target.trim() || suggestLoading) return;
    setSuggestLoading(true);
    setSuggestError("");
    setSuggestion(null);
    setSavedAs(null);
    try {
      const res = await api<SuggestResponse>("/playbook/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: target.trim(),
          app_description: appDescription.trim(),
        }),
        timeoutMs: 90_000,
      });
      setSuggestion(res);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestLoading(false);
    }
  }

  async function saveSuggested(): Promise<void> {
    if (!suggestion) return;
    setSavedAs(null);
    try {
      const r = await authFetch("/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: suggestion.playbook.id,
          name: suggestion.playbook.name,
          description: suggestion.playbook.description,
          target_type: suggestion.playbook.target_type,
          steps: suggestion.playbook.steps.map((s) => ({
            id: s.id,
            tool: s.tool,
            rationale: s.rationale,
            approval: s.approval,
            options: s.options,
          })),
        }),
      });
      if (!r.ok) {
        setSuggestError(await parseError(r));
        return;
      }
      const body = await r.json();
      setSavedAs(body.id || suggestion.playbook.id);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Basic Check ──────────────────────────────────────────────────────────

  async function runBasic(): Promise<void> {
    if (!target.trim() || basicLoading) return;
    setBasicLoading(true);
    setBasicError("");
    setBasic(null);
    try {
      const res = await api<BasicCheckResponse>("/basic_check/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim() }),
        // The backend caps internal work to <30s, but DNS+TLS+port wallclock
        // plus network overhead can drift higher on a slow link.
        timeoutMs: 45_000,
      });
      setBasic(res);
    } catch (e) {
      setBasicError(e instanceof Error ? e.message : String(e));
    } finally {
      setBasicLoading(false);
    }
  }

  // ── Custom Builder ───────────────────────────────────────────────────────

  function addCustomStep(): void {
    const tool = pickerTool.trim();
    if (!tool) return;
    setCustomSteps((s) => [
      ...s,
      {
        // Keep uids stable even if the user renames the tool.
        uid: `step_${Date.now()}_${s.length}`,
        tool,
        rationale: pickerRationale.trim(),
      },
    ]);
    setPickerTool("");
    setPickerRationale("");
  }

  function removeCustomStep(uid: string): void {
    setCustomSteps((s) => s.filter((x) => x.uid !== uid));
  }

  function moveCustomStep(uid: string, dir: -1 | 1): void {
    setCustomSteps((s) => {
      const idx = s.findIndex((x) => x.uid === uid);
      if (idx < 0) return s;
      const swap = idx + dir;
      if (swap < 0 || swap >= s.length) return s;
      const next = s.slice();
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  async function saveCustom(): Promise<void> {
    setCustomSaveError("");
    setCustomSavedAs(null);
    const name = customName.trim();
    if (!name) {
      setCustomSaveError("Name is required.");
      return;
    }
    if (customSteps.length === 0) {
      setCustomSaveError("Add at least one step.");
      return;
    }
    // De-dupe step ids by tool — preset_engine rejects duplicates.
    const seen = new Set<string>();
    const steps = customSteps.map((s) => {
      let base = s.tool;
      let id = base;
      let n = 2;
      while (seen.has(id)) {
        id = `${base}_${n}`;
        n++;
      }
      seen.add(id);
      return {
        id,
        tool: s.tool,
        rationale: s.rationale,
        approval: true,
        options: {},
      };
    });

    try {
      const r = await authFetch("/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: customDescription.trim(),
          target_type: "domain",
          steps,
        }),
      });
      if (!r.ok) {
        setCustomSaveError(await parseError(r));
        return;
      }
      const body = await r.json();
      setCustomSavedAs(body.id);
    } catch (e) {
      setCustomSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-4">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">
          PLAYBOOK BUILDER
        </h2>
        <p className="text-[11px] text-ink-dim mt-1 max-w-3xl leading-relaxed">
          Build a security playbook for an app you own. Let the copilot draft
          one from your description, run a quick conservative baseline check,
          or hand-pick tools yourself. Saved playbooks land in the Playbooks
          tab where they run with the full streaming UI.
        </p>
      </header>

      {/* Mode toggle */}
      <div className="flex gap-1 mb-4 border-b border-divider">
        {([
          ["suggest", "Copilot Suggest"],
          ["basic",   "Basic Security Check"],
          ["custom",  "Custom Builder"],
        ] as const).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={
              "px-3 py-1.5 text-[12px] font-bold tracking-wider uppercase border-b-2 -mb-px " +
              (mode === m
                ? "border-accent text-accent"
                : "border-transparent text-ink-muted hover:text-ink-primary")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* Shared target field — visible in suggest + basic */}
      {mode !== "custom" && (
        <section className="border border-divider rounded p-3 mb-4 bg-bg-card">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-dim">
              Target (URL, hostname, or IP)
            </span>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="http://localhost:3000  ·  myapp.example.com  ·  192.168.1.50"
              className="bg-bg-base border border-divider px-2 py-1.5 text-[13px]
                         text-ink-primary font-mono rounded focus:outline-none
                         focus:border-accent"
            />
          </label>

          {mode === "suggest" && (
            <label className="flex flex-col gap-1 mt-3">
              <span className="text-[10px] uppercase tracking-wider text-ink-dim">
                Describe your app (stack, exposure, what it does)
              </span>
              <textarea
                value={appDescription}
                onChange={(e) => setAppDescription(e.target.value)}
                rows={4}
                placeholder="e.g. Next.js + Postgres, runs on my LAN at port 3000, has a login form and an uploads endpoint. Built this for fun, want to know if it has obvious holes before opening it to friends."
                className="bg-bg-base border border-divider px-2 py-1.5 text-[12px]
                           text-ink-primary rounded focus:outline-none focus:border-accent
                           font-mono resize-y"
              />
            </label>
          )}

          <div className="flex flex-wrap gap-2 mt-3">
            {mode === "suggest" && (
              <button
                onClick={() => void runSuggest()}
                disabled={!target.trim() || suggestLoading}
                className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {suggestLoading ? "Thinking…" : "Get suggested playbook"}
              </button>
            )}
            {mode === "basic" && (
              <button
                onClick={() => void runBasic()}
                disabled={!target.trim() || basicLoading}
                className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {basicLoading ? "Checking…" : "Run basic check"}
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── Suggest output ─────────────────────────────────────────────────── */}
      {mode === "suggest" && suggestError && (
        <ErrorPanel detail={suggestError} />
      )}

      {mode === "suggest" && suggestion && (
        <section className="border border-divider rounded p-3 mb-4 bg-bg-card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[12px] font-bold tracking-wider text-ink-primary">
              SUGGESTED PLAYBOOK
            </h3>
            <span className="text-[11px] text-ink-muted font-mono">
              {suggestion.playbook.steps.length} steps
            </span>
          </div>
          <p className="text-[13px] text-ink-primary font-bold">
            {suggestion.playbook_name}
          </p>
          <p className="text-[12px] text-ink-primary mt-1 leading-relaxed">
            {suggestion.rationale}
          </p>

          <div className="mt-3 space-y-3">
            {suggestion.playbook.phases.map((ph, pi) => (
              <div key={pi} className="border border-divider rounded p-2.5 bg-bg-base">
                <div className="text-[10px] uppercase tracking-wider text-accent font-bold mb-2">
                  {pi + 1}. {ph.name}
                </div>
                <ul className="space-y-2">
                  {ph.steps.map((s, idx) => (
                    <li key={s.id} className="flex items-start gap-2">
                      <span className="text-ink-dim text-[10px] w-4 mt-0.5">
                        {idx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-mono text-accent">
                          {s.tool}
                        </div>
                        <p className="text-[11px] text-ink-primary mt-0.5 leading-snug">
                          {s.rationale}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={() => void saveSuggested()}
              disabled={!!savedAs}
              className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savedAs ? "Saved ✓" : "Save as playbook"}
            </button>
            {savedAs && (
              <button
                onClick={() => onJumpTo("playbooks")}
                className="px-3 py-1.5 rounded border border-accent text-accent text-[12px] font-bold"
              >
                Open in Playbooks →
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── Basic Check output ─────────────────────────────────────────────── */}
      {mode === "basic" && basicError && (
        <ErrorPanel detail={basicError} />
      )}

      {mode === "basic" && basic && (
        <div className="space-y-3 mb-4">
          <BasicHeader basic={basic} />
          <RiskPanel summary={basic.risk_summary} />
          <DnsPanel dns={basic.dns} />
          <TlsPanel tls={basic.tls} />
          <HeadersPanel headers={basic.headers} />
          <PortsPanel ports={basic.ports} />
        </div>
      )}

      {/* ── Custom Builder ─────────────────────────────────────────────────── */}
      {mode === "custom" && (
        <section className="border border-divider rounded p-3 mb-4 bg-bg-card">
          {catalogError && (
            <p className="text-[11px] text-danger mb-3">
              Could not load tool catalog: {catalogError}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-[10px] uppercase tracking-wider text-ink-dim">
                Playbook name
              </span>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="My home server baseline"
                className="bg-bg-base border border-divider px-2 py-1.5 text-[13px]
                           text-ink-primary rounded focus:outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-[10px] uppercase tracking-wider text-ink-dim">
                Description (optional)
              </span>
              <input
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder="What this playbook is for"
                className="bg-bg-base border border-divider px-2 py-1.5 text-[12px]
                           text-ink-primary rounded focus:outline-none focus:border-accent"
              />
            </label>
          </div>

          <div className="border border-divider rounded p-2.5 bg-bg-base mb-3">
            <div className="text-[10px] uppercase tracking-wider text-ink-dim mb-2">
              Add step
            </div>
            <div className="flex flex-col gap-2">
              <select
                value={pickerTool}
                onChange={(e) => setPickerTool(e.target.value)}
                className="bg-bg-base border border-divider px-2 py-1.5 text-[12px]
                           text-ink-primary rounded focus:outline-none focus:border-accent"
              >
                <option value="">-- pick a tool --</option>
                {catalog.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                value={pickerRationale}
                onChange={(e) => setPickerRationale(e.target.value)}
                placeholder="Why this step matters (e.g. 'check for legacy TLS on the public port')"
                className="bg-bg-base border border-divider px-2 py-1.5 text-[12px]
                           text-ink-primary rounded focus:outline-none focus:border-accent"
              />
              <button
                onClick={addCustomStep}
                disabled={!pickerTool}
                className="self-start px-3 py-1.5 rounded border border-accent text-accent
                           text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                + Add step
              </button>
            </div>
          </div>

          {customSteps.length === 0 ? (
            <p className="text-[12px] text-ink-muted italic">No steps yet.</p>
          ) : (
            <ol className="space-y-2 mb-3">
              {customSteps.map((s, idx) => (
                <li key={s.uid}
                    className="border border-divider rounded p-2.5 bg-bg-base">
                  <div className="flex items-start gap-2">
                    <span className="text-ink-dim text-[10px] w-4 mt-0.5">
                      {idx + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-mono text-accent">{s.tool}</div>
                      {s.rationale && (
                        <p className="text-[11px] text-ink-primary mt-0.5">
                          {s.rationale}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => moveCustomStep(s.uid, -1)}
                        disabled={idx === 0}
                        className="px-1.5 py-0.5 text-[11px] text-ink-muted border border-divider rounded
                                   disabled:opacity-30"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveCustomStep(s.uid, 1)}
                        disabled={idx === customSteps.length - 1}
                        className="px-1.5 py-0.5 text-[11px] text-ink-muted border border-divider rounded
                                   disabled:opacity-30"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removeCustomStep(s.uid)}
                        className="px-1.5 py-0.5 text-[11px] text-danger border border-danger/40 rounded"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {customSaveError && (
            <p className="text-[11px] text-danger mb-2">{customSaveError}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void saveCustom()}
              disabled={!!customSavedAs || customSteps.length === 0 || !customName.trim()}
              className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {customSavedAs ? "Saved ✓" : "Save playbook"}
            </button>
            {customSavedAs && (
              <button
                onClick={() => onJumpTo("playbooks")}
                className="px-3 py-1.5 rounded border border-accent text-accent text-[12px] font-bold"
              >
                Open in Playbooks →
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Sub-panels ─────────────────────────────────────────────────────────────

function ErrorPanel({ detail }: { detail: string }): JSX.Element {
  return (
    <section className="border border-danger/40 bg-red-500/10 rounded p-3 mb-4">
      <p className="text-[12px] text-danger">{detail}</p>
    </section>
  );
}

function BasicHeader({ basic }: { basic: BasicCheckResponse }): JSX.Element {
  return (
    <section className="border border-divider rounded p-3 bg-bg-card">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-dim">
            Basic check
          </div>
          <div className="text-[13px] font-mono text-ink-primary">
            {basic.canonical}
          </div>
        </div>
        <div className="text-[11px] text-ink-muted">
          {(basic.elapsed_ms / 1000).toFixed(1)}s
        </div>
      </div>
    </section>
  );
}

function RiskPanel({ summary }: { summary: RiskSummary }): JSX.Element {
  const overall = (summary.overall || "info").toLowerCase();
  return (
    <section className="border border-divider rounded p-3 bg-bg-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[12px] font-bold tracking-wider text-ink-primary">
          RISK SUMMARY
        </h3>
        <SeverityBadge
          severity={normalizeSeverity(overall === "clean" ? "info" : overall)}
          label={overall.toUpperCase()}
          size="sm"
        />
      </div>
      {summary.items.length === 0 ? (
        <p className="text-[12px] text-ink-muted italic">
          No issues found at this depth. Run a deeper playbook for more.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {summary.items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <SeverityBadge severity={severityFor(it.severity)} />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-ink-primary">{it.label}</div>
                <div className="text-[11px] text-ink-muted">{it.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DnsPanel({ dns }: { dns: DnsResult }): JSX.Element {
  return (
    <Panel title="DNS">
      <KV label="Host" value={dns.host} />
      <KV label="Resolved" value={dns.resolved ? "yes" : "no"} />
      <KV label="A" value={dns.a.join(", ") || "—"} />
      {dns.aaaa.length > 0 && <KV label="AAAA" value={dns.aaaa.join(", ")} />}
      <KV label="NS" value={dns.ns.join(", ") || "—"} />
      <KV label="MX" value={dns.mx.join(", ") || "—"} />
    </Panel>
  );
}

function TlsPanel({ tls }: { tls: TlsResult }): JSX.Element {
  if (!tls.attempted) {
    return (
      <Panel title="TLS">
        <p className="text-[12px] text-ink-muted italic">
          Skipped (non-HTTPS target).
        </p>
      </Panel>
    );
  }
  if (!tls.handshake_ok) {
    return (
      <Panel title="TLS">
        <p className="text-[12px] text-danger">
          Handshake failed: {tls.error || "unknown"}
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="TLS">
      <KV label="Version" value={tls.version || "—"} />
      <KV label="Cipher" value={tls.cipher || "—"} />
      <KV label="Cert CN" value={tls.cert_cn || "—"} />
      <KV label="Expires" value={tls.cert_expiry || "—"} />
    </Panel>
  );
}

function HeadersPanel({ headers }: { headers: HeaderResult }): JSX.Element {
  if (headers.error) {
    return (
      <Panel title="Security Headers">
        <p className="text-[12px] text-danger">{headers.error}</p>
      </Panel>
    );
  }
  return (
    <Panel title="Security Headers">
      <KV label="Status" value={headers.status !== null ? String(headers.status) : "—"} />
      <KV label="Server" value={headers.server || "—"} />
      <div className="mt-1.5">
        <div className="text-[9px] uppercase tracking-wider text-ink-dim mb-1">Present</div>
        {headers.headers_present.length === 0 ? (
          <p className="text-[11px] text-ink-muted">none</p>
        ) : (
          <ul className="text-[11px] text-phos font-mono space-y-0.5">
            {headers.headers_present.map((h) => <li key={h}>✓ {h}</li>)}
          </ul>
        )}
      </div>
      <div className="mt-2">
        <div className="text-[9px] uppercase tracking-wider text-ink-dim mb-1">Missing</div>
        {headers.headers_missing.length === 0 ? (
          <p className="text-[11px] text-ink-muted">none</p>
        ) : (
          <ul className="text-[11px] text-amber font-mono space-y-0.5">
            {headers.headers_missing.map((h) => <li key={h}>✗ {h}</li>)}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function PortsPanel({ ports }: { ports: PortResult }): JSX.Element {
  return (
    <Panel title={`Open Ports (top ${ports.scanned})`}>
      <div className="text-[11px] text-ink-muted mb-1.5">
        Scan elapsed: {ports.elapsed}s
      </div>
      {ports.open.length === 0 ? (
        <p className="text-[12px] text-ink-muted italic">
          No open ports in the top-100 set.
        </p>
      ) : (
        <ul className="text-[12px] font-mono space-y-0.5">
          {ports.open.map((p) => (
            <li key={p.port} className="flex items-baseline gap-2">
              <span className="text-amber w-12">{p.port}</span>
              <span className="text-ink-primary w-24">{p.service || "?"}</span>
              <span className="text-ink-muted text-[11px] truncate">
                {p.banner}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Panel({ title, children }:
                 { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="border border-divider rounded p-3 bg-bg-card">
      <h3 className="text-[12px] font-bold tracking-wider text-ink-primary mb-2">
        {title.toUpperCase()}
      </h3>
      <div className="text-[12px] text-ink-primary space-y-0.5">
        {children}
      </div>
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wider text-ink-dim w-20 shrink-0">
        {label}
      </span>
      <span className="text-[12px] font-mono text-ink-primary truncate">
        {value}
      </span>
    </div>
  );
}

// Risk severities from basic_check.py are: high|medium|low|info; map to the
// shared SeverityBadge type (which adds "critical").
function severityFor(s: string): Severity {
  return normalizeSeverity(s);
}
