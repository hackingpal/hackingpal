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
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { filterGroups, type Platform } from "../lib/nav";
import { usePlannedTools } from "../lib/plannedTools";
import type { NavId } from "./Sidebar";

type FlatItem = {
  id: NavId | string;
  label: string;
  section: string;
};

type Scored = FlatItem & { score: number; hits: Set<number> };

/**
 * Score how well `query` matches `target`. Returns
 *   {score: 0, hits: empty}  on no match
 *   {score: >0, hits: set of indexes in target that matched}  on hit.
 *
 * Score = sum of per-character contributions:
 *   +1   base hit
 *   +3   adjacent to the previous hit
 *   +5   matches at a word boundary (start, after non-alphanum, or capital)
 *   +10  matches at position 0
 *
 * Result is normalized by `target.length` so shorter labels rank higher when
 * everything else ties (LFI beats "Local Discovery" for "lf").
 */
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
        ? <span key={i} className="text-accent font-bold">{ch}</span>
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

  const results = useMemo<Scored[]>(() => {
    if (!query.trim()) {
      return flatItems.map((it) => ({ ...it, score: 1, hits: new Set<number>() }));
    }
    const scored: Scored[] = [];
    for (const it of flatItems) {
      // Try the label first; if no hit, try "label · section" so e.g. "exploit"
      // matches the WEB EXPLOIT section.
      const a = score(query, it.label);
      if (a.score > 0) { scored.push({ ...it, score: a.score, hits: a.hits }); continue; }
      const b = score(query, it.section);
      if (b.score > 0) scored.push({ ...it, score: b.score * 0.4, hits: new Set() });
    }
    scored.sort((x, y) => y.score - x.score);
    return scored.slice(0, 12);
  }, [query, flatItems]);

  // Reset selection when the result set changes
  useEffect(() => { setSelected(0); }, [query]);

  // Focus the input and clear query on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children?.[selected] as HTMLElement | undefined;
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

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[18vh] px-4
                 bg-bg-base/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-bg-card border border-divider rounded-lg shadow-2xl
                      flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-divider">
          <span className="text-ink-dim text-[11px] tracking-widest">⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to tool…"
            className="flex-1 bg-transparent text-ink-primary text-[14px] focus:outline-none
                       placeholder:text-ink-dim"
          />
          <span className="text-ink-dim text-[10px]">{results.length} of {flatItems.length}</span>
        </div>

        <div ref={listRef}
             className="max-h-[55vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-3 py-6 text-center text-ink-dim text-[12px]">
              No matches for "{query}".
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={r.id}
              onClick={() => { onSelect(r.id); onClose(); }}
              onMouseMove={() => setSelected(i)}
              className={
                "w-full flex items-center gap-3 px-3 py-2 text-left text-[13px] " +
                (i === selected
                  ? "bg-bg-nav-active text-ink-primary"
                  : "text-ink-primary hover:bg-bg-nav-hover")
              }
            >
              <span className="flex-1 truncate">
                <Highlight text={r.label} hits={r.hits} />
              </span>
              <span className="text-[10px] tracking-widest text-ink-dim">{r.section}</span>
            </button>
          ))}
        </div>

        <div className="border-t border-divider px-3 py-1.5 flex items-center gap-3
                        text-[10px] text-ink-dim">
          <span><kbd className="text-ink-muted">↑↓</kbd> navigate</span>
          <span><kbd className="text-ink-muted">↵</kbd> open</span>
          <span><kbd className="text-ink-muted">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
