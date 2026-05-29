// Tool Library — browse the full catalog of tools, grouped by category.
// Replaces the old long sidebar. Tools open into their dedicated pages via
// the same NavId routing the sidebar used.

import { useMemo, useState } from "react";
import { fetchSystemInfo } from "../api";
import { filterGroups, type NavGroup, type Platform } from "../lib/nav";
import { usePlannedTools } from "../lib/plannedTools";
import { useEffect } from "react";

type Props = {
  onOpenTool: (id: string) => void;
};

export default function ToolLibrary({ onOpenTool }: Props) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [query, setQuery] = useState("");
  const planned = usePlannedTools();

  useEffect(() => {
    fetchSystemInfo()
      .then((info) => setPlatform(info.platform as Platform))
      .catch(() => setPlatform(null));
  }, []);

  const groups: NavGroup[] = useMemo(
    () => filterGroups(platform, planned),
    [platform, planned],
  );

  const filtered: NavGroup[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (it) =>
            it.label.toLowerCase().includes(q) ||
            g.section.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  const totalCount = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups],
  );

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">CATALOG</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Tool Library
            </h2>
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
            {query ? `${filtered.reduce((n, g) => n + g.items.length, 0)} / ${totalCount}` : `${totalCount} tools`}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 && (
          <div className="text-ink-dim italic text-sm">No tools match "{query}".</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((g) => (
            <section key={g.section} className="rounded-md border border-divider overflow-hidden">
              <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                                 text-ink-dim border-b border-divider bg-bg-panel">
                {g.section}
                <span className="ml-2 text-ink-dim/70 normal-case tracking-normal">
                  · {g.items.length}
                </span>
              </header>
              <ul className="bg-bg-card">
                {g.items.map((it) => (
                  <li key={it.id}>
                    <button
                      onClick={() => onOpenTool(it.id)}
                      className="w-full text-left px-3 py-1.5 text-[13px] text-ink-primary
                                 hover:bg-bg-nav-hover hover:text-accent transition
                                 flex items-center justify-between border-l-2 border-transparent
                                 hover:border-accent"
                    >
                      <span>{it.label}</span>
                      <span className="text-ink-dim text-[10px] tracking-wider opacity-0 group-hover:opacity-100">
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
