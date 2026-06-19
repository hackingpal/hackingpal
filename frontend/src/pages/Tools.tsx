// Tools — combined catalog + readiness page (merger of the old
// ToolLibrary + ToolStatus). The display catalog (TOOL_GROUPS from nav.ts)
// drives WHICH tools to show and HOW to group them; the readiness
// registry is overlaid per-tool-id so each row also shows whether it's
// ready, needs setup, or won't run on this OS. Tools that don't yet have
// a registry entry render with a neutral "untracked" indicator.

import { useEffect, useMemo, useState } from "react";
import { EyebrowPill } from "performative-ui";
import { fetchSystemInfo } from "../api";
import { filterGroups, type NavGroup, type Platform } from "../lib/nav";
import { usePlannedTools } from "../lib/plannedTools";
import {
  clearReadinessCache,
  fetchAllToolRequirements,
  fetchToolReadiness,
  type ReadinessCheck,
  type ToolRequirement,
} from "../lib/toolRequirements";

type Status = "ready" | "needs-setup" | "wrong-os" | "untracked";

type ToolDisplay = {
  id: string;
  label: string;
  section: string;
  req: ToolRequirement | null;
  readiness: ReadinessCheck | null;
  status: Status;
};

type Props = { onJumpTo: (id: string) => void };

export default function Tools({ onJumpTo }: Props) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [reqs, setReqs] = useState<ToolRequirement[]>([]);
  const [readiness, setReadiness] = useState<Map<string, ReadinessCheck | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const planned = usePlannedTools();

  useEffect(() => {
    fetchSystemInfo()
      .then((info) => setPlatform(info.platform as Platform))
      .catch(() => setPlatform(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const tools = await fetchAllToolRequirements();
      const checks = await Promise.all(
        tools.map((t) => fetchToolReadiness(t.id, tick > 0)),
      );
      if (cancelled) return;
      const m = new Map<string, ReadinessCheck | null>();
      tools.forEach((t, i) => m.set(t.id, checks[i]));
      setReqs(tools);
      setReadiness(m);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tick]);

  const navGroups: NavGroup[] = useMemo(
    () => filterGroups(platform, planned),
    [platform, planned],
  );

  const reqById = useMemo(() => {
    const m = new Map<string, ToolRequirement>();
    reqs.forEach((r) => m.set(r.id, r));
    return m;
  }, [reqs]);

  const all: ToolDisplay[] = useMemo(() => {
    const out: ToolDisplay[] = [];
    for (const g of navGroups) {
      for (const it of g.items) {
        const req = reqById.get(it.id) ?? null;
        const r = readiness.get(it.id) ?? null;
        const status: Status =
          !req ? "untracked"
          : r?.missing?.platform ? "wrong-os"
          : r?.ready ? "ready"
          : "needs-setup";
        out.push({ id: it.id, label: it.label, section: g.section, req, readiness: r, status });
      }
    }
    return out;
  }, [navGroups, reqById, readiness]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((t) => {
      if (filter !== "all" && t.status !== filter) return false;
      if (!q) return true;
      return t.label.toLowerCase().includes(q) ||
             t.section.toLowerCase().includes(q) ||
             t.id.toLowerCase().includes(q);
    });
  }, [all, query, filter]);

  const groupedDisplay = useMemo(() => {
    const m = new Map<string, ToolDisplay[]>();
    for (const t of filtered) {
      const arr = m.get(t.section) ?? [];
      arr.push(t);
      m.set(t.section, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const counts = useMemo(() => ({
    total:     all.length,
    ready:     all.filter((t) => t.status === "ready").length,
    setup:     all.filter((t) => t.status === "needs-setup").length,
    wrongos:   all.filter((t) => t.status === "wrong-os").length,
    untracked: all.filter((t) => t.status === "untracked").length,
  }), [all]);

  return (
    <div className="h-full flex flex-col bg-bg-base">
      <header className="px-6 py-4 border-b border-divider flex items-end gap-4">
        <div>
          <EyebrowPill icon={false} className="mhp-eyebrow">CATALOG</EyebrowPill>
          <h1 className="text-[15px] font-bold text-ink-primary tracking-tight mt-0.5">
            Tools
          </h1>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tools…"
          className="flex-1 max-w-md bg-bg-card border border-divider rounded
                     px-3 py-1.5 text-sm font-mono text-ink-primary
                     placeholder:text-ink-dim
                     focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
          autoCorrect="off" spellCheck={false}
        />
        <div className="text-[11px] text-ink-dim">
          {query || filter !== "all"
            ? `${filtered.length} / ${all.length}`
            : `${all.length} tools`}
        </div>
      </header>

      <div className="px-6 py-3 border-b border-divider bg-bg-sidebar
                      flex items-center gap-4 text-[11px] flex-wrap">
        <Counter label="Total"       count={counts.total}     tone="ink-primary" onClick={() => setFilter("all")} />
        <Counter label="Ready"       count={counts.ready}     tone="phos"        onClick={() => setFilter("ready")} />
        <Counter label="Needs setup" count={counts.setup}     tone="amber"       onClick={() => setFilter("needs-setup")} />
        <Counter label="Wrong OS"    count={counts.wrongos}   tone="danger"      onClick={() => setFilter("wrong-os")} />
        <Counter label="Untracked"   count={counts.untracked} tone="ink-dim"     onClick={() => setFilter("untracked")} />
        <div className="ml-auto flex items-center gap-2">
          <FilterChip active={filter === "all"}         onClick={() => setFilter("all")}>All</FilterChip>
          <FilterChip active={filter === "ready"}       onClick={() => setFilter("ready")}>Ready</FilterChip>
          <FilterChip active={filter === "needs-setup"} onClick={() => setFilter("needs-setup")}>Setup</FilterChip>
          <FilterChip active={filter === "wrong-os"}    onClick={() => setFilter("wrong-os")}>Wrong OS</FilterChip>
          <button
            onClick={() => { clearReadinessCache(); setTick((n) => n + 1); }}
            className="ml-2 text-[10px] text-ink-dim hover:text-ink-primary
                       border border-divider rounded px-2 py-0.5 transition"
          >
            Re-check all
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
        {loading && (
          <div className="text-ink-muted text-sm">Loading registry…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-ink-dim italic text-sm">
            {query ? `No tools match "${query}".` : "No tools match the current filter."}
          </div>
        )}
        {groupedDisplay.map(([section, items]) => (
          <section key={section}>
            <header className="flex items-center gap-2 mb-2">
              <h2 className="text-[11px] uppercase tracking-wider text-ink-dim font-bold">
                {section}
              </h2>
              <span className="text-[10px] text-ink-dim">{items.length}</span>
            </header>
            <div className="border border-divider rounded">
              {items.map((t, i) => (
                <ToolRow
                  key={t.id}
                  tool={t}
                  expanded={expanded.has(t.id)}
                  onToggle={() => setExpanded((s) => {
                    const next = new Set(s);
                    if (next.has(t.id)) next.delete(t.id);
                    else next.add(t.id);
                    return next;
                  })}
                  onOpen={() => onJumpTo(t.id)}
                  first={i === 0}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Counter({ label, count, tone, onClick }: {
  label: string;
  count: number;
  tone: "ink-primary" | "phos" | "amber" | "danger" | "ink-dim";
  onClick?: () => void;
}) {
  // Tailwind JIT needs literal class names — dynamic `text-${tone}` would
  // get tree-shaken from the production bundle. Switch on the prop instead.
  const toneCls = tone === "phos" ? "text-phos"
    : tone === "amber" ? "text-amber"
    : tone === "danger" ? "text-danger"
    : tone === "ink-dim" ? "text-ink-dim"
    : "text-ink-primary";
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="flex items-baseline gap-1.5 disabled:cursor-default
                 hover:bg-bg-nav-hover transition rounded px-1.5 py-0.5"
    >
      {/* Plain text — performative-ui's StatCounter captures the initial
          `target` in an empty-deps useEffect, so once-deferred values (like
          our async fetch result) never re-animate and the display stays at 0.
          A static span is fine here — these are setup counters, not hero stats. */}
      <span className={`text-[13px] font-bold tabular-nums ${toneCls}`}>
        {count}
      </span>
      <span className="text-ink-muted uppercase tracking-wider text-[10px]">
        {label}
      </span>
    </button>
  );
}

function FilterChip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-2 py-0.5 rounded text-[10px] uppercase tracking-wider transition " +
        (active
          ? "bg-accent/15 text-accent border border-accent/40"
          : "border border-divider text-ink-dim hover:text-ink-primary")
      }
    >{children}</button>
  );
}

function ToolRow({ tool, expanded, onToggle, onOpen, first }: {
  tool: ToolDisplay; expanded: boolean; onToggle: () => void; onOpen: () => void; first: boolean;
}) {
  const dotColor =
    tool.status === "ready" ? "bg-phos"
    : tool.status === "wrong-os" ? "bg-danger"
    : tool.status === "needs-setup" ? "bg-amber"
    : "bg-ink-dim";

  const blurb =
    tool.status === "ready" ? (tool.req?.expected_output ?? "Ready")
    : tool.status === "untracked" ? "Not yet in the readiness registry."
    : summarize(tool);

  return (
    <div className={"flex items-stretch flex-wrap " + (first ? "" : "border-t border-divider")}>
      <button onClick={onToggle} className="flex-1 text-left px-3 py-2 flex items-center gap-3 min-w-0">
        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-ink-primary font-bold text-[12px] w-40 shrink-0 truncate">
          {tool.label}
        </span>
        <code className="text-ink-dim text-[10px] font-mono w-20 shrink-0 truncate">{tool.id}</code>
        <span className="text-ink-muted text-[11px] truncate">{blurb}</span>
      </button>
      <button
        onClick={onOpen}
        className="px-3 my-1 mr-2 border border-divider rounded text-[10px]
                   text-ink-muted hover:text-accent hover:border-accent
                   uppercase tracking-wider transition"
      >Open</button>
      {expanded && tool.req && (
        <div className="basis-full px-3 py-2 border-t border-divider
                        text-[11px] text-ink-muted bg-bg-card space-y-1">
          {tool.req.setup.binaries.length > 0 && (
            <div><span className="text-ink-dim">Binaries: </span>
              {tool.req.setup.binaries.map((b) => `${b.name} (${b.install_hint})`).join(" · ")}
            </div>
          )}
          {tool.req.setup.api_keys.length > 0 && (
            <div><span className="text-ink-dim">Keys: </span>
              {tool.req.setup.api_keys.map((k) => `${k.provider} — ${k.how_to}`).join(" · ")}
            </div>
          )}
          {tool.req.setup.sudoers && (
            <div><span className="text-ink-dim">Sudoers: </span>
              {tool.req.setup.sudoers_file ?? "/etc/sudoers.d/..."}
            </div>
          )}
          {tool.req.setup.platforms.length < 3 && (
            <div><span className="text-ink-dim">Platforms: </span>
              {tool.req.setup.platforms.join(" · ")}
            </div>
          )}
          <div><span className="text-ink-dim">Finds: </span>
            <span className="text-ink-primary">{tool.req.expected_output}</span>
          </div>
          {tool.req.notes && (
            <div><span className="text-ink-dim">Notes: </span>{tool.req.notes}</div>
          )}
        </div>
      )}
      {expanded && !tool.req && (
        <div className="basis-full px-3 py-2 border-t border-divider
                        text-[11px] text-ink-dim italic bg-bg-card">
          This tool isn't in the readiness registry yet — open it to use it.
        </div>
      )}
    </div>
  );
}

function summarize(tool: ToolDisplay): string {
  const m = tool.readiness?.missing;
  if (!m || !tool.req) return tool.req?.expected_output ?? "—";
  const parts: string[] = [];
  if (m.binaries.length) parts.push(`needs: ${m.binaries.join(", ")}`);
  if (m.api_keys.length) parts.push(`needs key: ${m.api_keys.join(", ")}`);
  if (m.sudoers) parts.push("needs sudoers install");
  if (m.platform) parts.push(`wrong OS (needs ${tool.req.setup.platforms.join("/")})`);
  return parts.join(" · ") || tool.req.expected_output;
}
