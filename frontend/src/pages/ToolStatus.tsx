// Tool Status matrix — one row per tool with ready / needs-setup / wrong-OS
// state, grouped by category. Surfaces what's blocking the user before they
// click into a tool page.

import { useEffect, useMemo, useState } from "react";
import {
  clearReadinessCache,
  fetchAllToolRequirements,
  fetchToolReadiness,
  type ReadinessCheck,
  type ToolRequirement,
} from "../lib/toolRequirements";

type Status = "ready" | "needs-setup" | "wrong-os";
type Row = { req: ToolRequirement; readiness: ReadinessCheck | null; status: Status };

type Props = { onJumpTo: (id: string) => void };

export default function ToolStatus({ onJumpTo }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const tools = await fetchAllToolRequirements();
      const checks = await Promise.all(
        tools.map((t) => fetchToolReadiness(t.id, tick > 0)),
      );
      if (cancelled) return;
      const next: Row[] = tools.map((req, i) => {
        const readiness = checks[i];
        const status: Status =
          readiness?.missing.platform ? "wrong-os"
          : readiness?.ready ? "ready"
          : "needs-setup";
        return { req, readiness, status };
      });
      setRows(next);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tick]);

  const filtered = useMemo(() =>
    filter === "all" ? rows : rows.filter((r) => r.status === filter),
    [rows, filter]);

  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of filtered) {
      const arr = m.get(r.req.category) ?? [];
      arr.push(r);
      m.set(r.req.category, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const counts = useMemo(() => ({
    total: rows.length,
    ready: rows.filter((r) => r.status === "ready").length,
    setup: rows.filter((r) => r.status === "needs-setup").length,
    wrongos: rows.filter((r) => r.status === "wrong-os").length,
  }), [rows]);

  return (
    <div className="h-full flex flex-col bg-bg-base">
      <header className="px-6 py-4 border-b border-divider">
        <h1 className="text-[15px] font-bold text-ink-primary tracking-tight">
          Tool Status
        </h1>
        <p className="text-[12px] text-ink-muted mt-0.5">
          What's ready to run on this machine.
        </p>
      </header>

      <div className="px-6 py-3 border-b border-divider bg-bg-sidebar
                      flex items-center gap-4 text-[11px]">
        <Counter label="Total"      count={counts.total}   tone="ink-primary" />
        <Counter label="Ready"      count={counts.ready}   tone="phos"   onClick={() => setFilter("ready")} />
        <Counter label="Needs setup" count={counts.setup}  tone="amber"  onClick={() => setFilter("needs-setup")} />
        <Counter label="Wrong OS"   count={counts.wrongos} tone="danger" onClick={() => setFilter("wrong-os")} />
        <div className="ml-auto flex items-center gap-2">
          <FilterChip active={filter === "all"}        onClick={() => setFilter("all")}>All</FilterChip>
          <FilterChip active={filter === "ready"}      onClick={() => setFilter("ready")}>Ready</FilterChip>
          <FilterChip active={filter === "needs-setup"} onClick={() => setFilter("needs-setup")}>Setup</FilterChip>
          <FilterChip active={filter === "wrong-os"}   onClick={() => setFilter("wrong-os")}>Wrong OS</FilterChip>
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
        {!loading && rows.length === 0 && (
          <div className="text-ink-muted text-sm">
            Registry empty. Backend may need to be restarted to pick up new entries.
          </div>
        )}
        {grouped.map(([cat, items]) => (
          <section key={cat}>
            <header className="flex items-center gap-2 mb-2">
              <h2 className="text-[11px] uppercase tracking-wider text-ink-dim font-bold">
                {cat}
              </h2>
              <span className="text-[10px] text-ink-dim">{items.length}</span>
            </header>
            <div className="border border-divider rounded">
              {items.map((row, i) => (
                <ToolRow
                  key={row.req.id}
                  row={row}
                  expanded={expanded.has(row.req.id)}
                  onToggle={() =>
                    setExpanded((s) => {
                      const next = new Set(s);
                      if (next.has(row.req.id)) next.delete(row.req.id);
                      else next.add(row.req.id);
                      return next;
                    })}
                  onOpen={() => onJumpTo(row.req.id)}
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
  label: string; count: number; tone: "ink-primary" | "phos" | "amber" | "danger"; onClick?: () => void;
}) {
  // Tailwind JIT needs literal class names — dynamic `text-${tone}` would
  // get tree-shaken from the production bundle. Switch on the prop instead.
  const toneCls = tone === "phos" ? "text-phos"
    : tone === "amber" ? "text-amber"
    : tone === "danger" ? "text-danger"
    : "text-ink-primary";
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="flex items-baseline gap-1.5 disabled:cursor-default
                 hover:bg-bg-nav-hover transition rounded px-1.5 py-0.5"
    >
      <span className={`text-[13px] font-bold ${toneCls}`}>{count}</span>
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

function ToolRow({ row, expanded, onToggle, onOpen, first }: {
  row: Row; expanded: boolean; onToggle: () => void; onOpen: () => void; first: boolean;
}) {
  const dotColor =
    row.status === "ready" ? "bg-phos"
    : row.status === "wrong-os" ? "bg-danger"
    : "bg-amber";
  const blurb = row.status === "ready"
    ? row.req.expected_output
    : summarize(row);

  return (
    <div className={"flex items-stretch " + (first ? "" : "border-t border-divider")}>
      <button onClick={onToggle} className="flex-1 text-left px-3 py-2 flex items-center gap-3">
        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-ink-primary font-bold text-[12px] w-40 shrink-0">
          {row.req.name}
        </span>
        <code className="text-ink-dim text-[10px] font-mono w-16 shrink-0">{row.req.id}</code>
        <span className="text-ink-muted text-[11px] truncate">{blurb}</span>
      </button>
      <button
        onClick={onOpen}
        className="px-3 my-1 mr-2 border border-divider rounded text-[10px]
                   text-ink-muted hover:text-accent hover:border-accent
                   uppercase tracking-wider transition"
      >Open</button>
      {expanded && (
        <div className="basis-full px-3 py-2 border-t border-divider
                        text-[11px] text-ink-muted bg-bg-card space-y-1">
          {row.req.setup.binaries.length > 0 && (
            <div><span className="text-ink-dim">Binaries: </span>
              {row.req.setup.binaries.map((b) => `${b.name} (${b.install_hint})`).join(" · ")}
            </div>
          )}
          {row.req.setup.api_keys.length > 0 && (
            <div><span className="text-ink-dim">Keys: </span>
              {row.req.setup.api_keys.map((k) => `${k.provider} — ${k.how_to}`).join(" · ")}
            </div>
          )}
          {row.req.setup.sudoers && (
            <div><span className="text-ink-dim">Sudoers: </span>
              {row.req.setup.sudoers_file ?? "/etc/sudoers.d/..."}
            </div>
          )}
          {row.req.setup.platforms.length < 3 && (
            <div><span className="text-ink-dim">Platforms: </span>
              {row.req.setup.platforms.join(" · ")}
            </div>
          )}
          <div><span className="text-ink-dim">Finds: </span>
            <span className="text-ink-primary">{row.req.expected_output}</span>
          </div>
          {row.req.notes && (
            <div><span className="text-ink-dim">Notes: </span>{row.req.notes}</div>
          )}
        </div>
      )}
    </div>
  );
}

function summarize(row: Row): string {
  const m = row.readiness?.missing;
  if (!m) return row.req.expected_output;
  const parts: string[] = [];
  if (m.binaries.length) parts.push(`needs: ${m.binaries.join(", ")}`);
  if (m.api_keys.length) parts.push(`needs key: ${m.api_keys.join(", ")}`);
  if (m.sudoers) parts.push("needs sudoers install");
  if (m.platform) parts.push(`wrong OS (needs ${row.req.setup.platforms.join("/")})`);
  return parts.join(" · ") || row.req.expected_output;
}
