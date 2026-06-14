/**
 * Cmd+K (Ctrl+K) command palette.
 *
 * Fuzzy-search across every page in the sidebar nav. Keyboard-driven:
 *   ↑ / ↓   move selection
 *   Enter   activate
 *   Esc     close
 *
 * Filtering is a tiny subsequence-match scorer: characters of the query must
 * appear in order in (label + section), case-insensitive. Adjacent matches
 * and matches at word boundaries score higher.
 *
 * Reads navigation from src/lib/nav.ts (filterGroups) — structure, names,
 * and ordering are unchanged from before; only the chrome was restyled.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { filterGroups, type Platform } from "../lib/nav";
import { usePlannedTools } from "../lib/plannedTools";
import { popIn } from "../lib/anim";
import type { NavId } from "./Sidebar";

type FlatItem = {
  id: NavId | string;
  label: string;
  section: string;
};

type Scored = FlatItem & { score: number; hits: Set<number> };

function score(query: string, target: string): { score: number; hits: Set<number> } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const hits = new Set<number>();
  if (q.length === 0) return { score: 0, hits };
  let qi = 0;
  let lastHit = -2;
  let total = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let contribution = 1;
      if (ti === lastHit + 1) contribution += 3;
      if (ti === 0) contribution += 10;
      else if (!/[a-z0-9]/.test(t[ti - 1])) contribution += 5;
      total += contribution;
      hits.add(ti);
      lastHit = ti;
      qi++;
    }
  }
  if (qi < q.length) return { score: 0, hits: new Set() };
  return { score: total - target.length * 0.05, hits };
}

function Highlight({ text, hits }: { text: string; hits: Set<number> }) {
  if (hits.size === 0) return <>{text}</>;
  return (
    <>
      {[...text].map((ch, i) => hits.has(i)
        ? <span key={i} style={{ color: "var(--accent-bright)", fontWeight: 600 }}>{ch}</span>
        : <span key={i}>{ch}</span>)}
    </>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (id: NavId | string) => void;
  platform: Platform | null;
};

export default function CommandPalette({ open, onClose, onSelect, platform }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const planned = usePlannedTools();
  const flatItems = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = [];
    for (const g of filterGroups(platform, planned)) {
      for (const it of g.items) {
        out.push({ id: it.id, label: it.label, section: g.section });
      }
    }
    return out;
  }, [platform, planned]);

  // When the query is empty, show items grouped by section. When the user
  // types, switch to a flat ranked list (grouping after fuzzy ranking would
  // re-order the matches).
  const grouped = useMemo(() => {
    const map = new Map<string, FlatItem[]>();
    for (const it of flatItems) {
      const arr = map.get(it.section) ?? [];
      arr.push(it);
      map.set(it.section, arr);
    }
    return [...map.entries()];
  }, [flatItems]);

  const results = useMemo<Scored[]>(() => {
    if (!query.trim()) {
      return flatItems.map((it) => ({ ...it, score: 1, hits: new Set<number>() }));
    }
    const scored: Scored[] = [];
    for (const it of flatItems) {
      const a = score(query, it.label);
      if (a.score > 0) { scored.push({ ...it, score: a.score, hits: a.hits }); continue; }
      const b = score(query, it.section);
      if (b.score > 0) scored.push({ ...it, score: b.score * 0.4, hits: new Set() });
    }
    scored.sort((x, y) => y.score - x.score);
    return scored.slice(0, 14);
  }, [query, flatItems]);

  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
      popIn(modalRef.current);
    }
  }, [open]);

  // Scroll selected row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-cmd-row="${selected}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[selected];
      if (target) { onSelect(target.id); onClose(); }
    }
  }

  const showGrouped = query.trim().length === 0;
  // Flat ranked view: render `results` (already truncated to 14).
  // Grouped view: render `grouped` keeping section order from nav.ts.

  // Linear index → row index so keyboard nav lines up with rendered rows.
  // In grouped mode we walk the groups in order and only the flat `results`
  // indexes are kept in keyboard nav, so map the keyboard selection back to
  // the matching id when rendering.
  const activeId = results[selected]?.id;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[14vh] px-4 animate-in"
      style={{
        background: "rgba(10, 10, 15, 0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={modalRef}
        className="w-full"
        style={{
          maxWidth: 560,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-bright)",
          borderRadius: 12,
          boxShadow: "0 24px 64px -16px rgba(0,0,0,0.55), 0 0 0 1px var(--border-accent)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          opacity: 0,   // GSAP fades it in via popIn() on open
        }}
      >
        {/* Search input */}
        <div
          className="flex items-center gap-3 px-4"
          style={{
            height: 48,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <svg
            width={16} height={16} viewBox="0 0 24 24"
            fill="none" stroke="var(--text-muted)" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden
          >
            <circle cx={11} cy={11} r={7} />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to tool…"
            style={{
              flex: 1,
              background: "transparent",
              outline: "none",
              border: "none",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              color: "var(--text-primary)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.1em",
              color: "var(--text-muted)",
            }}
          >
            {results.length} of {flatItems.length}
          </span>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          style={{
            maxHeight: "55vh",
            overflowY: "auto",
            padding: "6px 0",
          }}
        >
          {results.length === 0 && (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--text-muted)",
                fontFamily: "var(--font-sans)",
                fontSize: 12,
              }}
            >
              No matches for "{query}".
            </div>
          )}

          {showGrouped
            ? grouped.map(([section, items]) => (
                <div key={section}>
                  <div
                    style={{
                      padding: "8px 16px 4px",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    {section}
                  </div>
                  {items.map((it) => {
                    const isActive = it.id === activeId;
                    const idx = results.findIndex((r) => r.id === it.id);
                    return (
                      <PaletteRow
                        key={it.id}
                        label={it.label}
                        section={it.section}
                        active={isActive}
                        dataIndex={idx}
                        onMouseEnter={() => idx >= 0 && setSelected(idx)}
                        onClick={() => { onSelect(it.id); onClose(); }}
                      />
                    );
                  })}
                </div>
              ))
            : results.map((r, i) => (
                <PaletteRow
                  key={r.id}
                  label={<Highlight text={r.label} hits={r.hits} />}
                  section={r.section}
                  active={i === selected}
                  dataIndex={i}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => { onSelect(r.id); onClose(); }}
                />
              ))}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-4 px-4"
          style={{
            height: 32,
            borderTop: "1px solid var(--border)",
            background: "var(--bg-surface)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-muted)",
            letterSpacing: "0.06em",
          }}
        >
          <Hint k="↑↓">navigate</Hint>
          <Hint k="↵">open</Hint>
          <Hint k="esc">close</Hint>
        </div>
      </div>
    </div>
  );
}

function PaletteRow({
  label, section, active, onClick, onMouseEnter, dataIndex,
}: {
  label: React.ReactNode;
  section: string;
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  dataIndex: number;
}) {
  return (
    <button
      data-cmd-row={dataIndex}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        background: active ? "var(--accent-dim)" : "transparent",
        borderLeft: active
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        color: active ? "var(--text-accent)" : "var(--text-primary)",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        textAlign: "left",
        cursor: "pointer",
        border: "none",
        borderTop: "none",
        borderRight: "none",
        borderBottom: "none",
        transition: "background 100ms ease, color 100ms ease",
      }}
    >
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
        }}
      >
        {section}
      </span>
    </button>
  );
}

function Hint({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <kbd
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          padding: "1px 5px",
          borderRadius: 4,
          background: "var(--bg-elevated)",
          color: "var(--text-secondary)",
          border: "1px solid var(--border)",
        }}
      >
        {k}
      </kbd>
      <span>{children}</span>
    </span>
  );
}
