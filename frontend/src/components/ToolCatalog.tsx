// "Tool Catalog" modal. Add a new planned tool via the form at top; the list
// below shows every planned tool with description + Open / Remove buttons.
// Each "+ Add" appends to localStorage and surfaces a new entry in the
// sidebar's PLANNED section.

import { useEffect, useRef, useState } from "react";
import {
  addPlannedTool,
  BUILT_CATALOG_LABELS,
  removePlannedTool,
  removePlannedToolsByLabel,
  usePlannedTools,
} from "../lib/plannedTools";
import { fetchSuggestions } from "../lib/engagement";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenTool: (id: string) => void;
};

export default function ToolCatalog({ open, onClose, onOpenTool }: Props) {
  const planned = usePlannedTools();
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [seeding, setSeeding] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  async function seedFromSuggestions() {
    setSeeding(true);
    setError("");
    try {
      const suggestions = await fetchSuggestions();
      let added = 0;
      for (const s of suggestions) {
        const desc = `[${s.category}] ${s.description}`;
        if (addPlannedTool(s.label, desc)) added++;
      }
      if (added === 0) {
        setError("Nothing to add — all suggestions are already in your catalog.");
      }
    } catch (e) {
      setError(`Couldn't load suggestions: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSeeding(false);
    }
  }

  useEffect(() => {
    if (open) {
      setError("");
      setTimeout(() => labelRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  function add() {
    setError("");
    const id = addPlannedTool(label, description);
    if (!id) {
      setError(
        !label.trim() ? "Name is required"
          : "A tool with that name already exists",
      );
      return;
    }
    setLabel("");
    setDescription("");
  }

  function remove(id: string, name: string) {
    if (!confirm(`Remove "${name}" from the planned list?`)) return;
    removePlannedTool(id);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4
                 bg-bg-base/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="w-full max-w-xl bg-bg-card border border-divider rounded-lg shadow-2xl
                      flex flex-col max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-divider">
          <span className="text-accent text-[11px] font-bold tracking-widest">TOOL CATALOG</span>
          <span className="text-ink-dim text-[10px]">{planned.length} planned</span>
          <span className="flex-1" />
          <button onClick={onClose}
                  className="text-ink-muted hover:text-ink-primary px-1"
                  aria-label="Close">✕</button>
        </div>

        {/* Cleanup banner: shown when planned list contains entries for
            tools we've since shipped. One-click removes them. */}
        {(() => {
          const builtSet = new Set(BUILT_CATALOG_LABELS.map((l) => l.toLowerCase()));
          const builtPlanned = planned.filter((t) => builtSet.has(t.label.toLowerCase()));
          if (builtPlanned.length === 0) return null;
          return (
            <div className="flex items-center gap-3 px-4 py-2 border-b border-divider
                            bg-phos/10 text-[12px]">
              <span className="text-phos">
                ✓ {builtPlanned.length} planned tool{builtPlanned.length === 1 ? " has" : "s have"} been built
              </span>
              <button
                onClick={() => {
                  const n = removePlannedToolsByLabel(BUILT_CATALOG_LABELS);
                  setError(`Removed ${n} built tool${n === 1 ? "" : "s"} from the catalog.`);
                }}
                className="ml-auto px-2 py-0.5 rounded bg-phos/20 border border-phos/40
                           text-phos text-[11px] hover:bg-phos/30">
                Clean up
              </button>
            </div>
          );
        })()}

        {/* Add form */}
        <div className="px-4 py-3 border-b border-divider space-y-2">
          <div className="text-[11px] text-ink-muted tracking-wider mb-1">ADD A TOOL</div>
          <input
            ref={labelRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) add();
            }}
            placeholder="Name — e.g. Burp-style HTTP Proxy"
            className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                       text-[13px] text-ink-primary focus:outline-none focus:border-accent"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does it do? When is it useful? Any specific features you want…"
            rows={3}
            className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                       text-[12px] text-ink-primary font-mono
                       focus:outline-none focus:border-accent resize-y"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={add}
              disabled={!label.trim()}
              className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Add to catalog
            </button>
            <span className="text-[10px] text-ink-dim">
              ⌘↵ to add quickly
            </span>
            {error && <span className="text-[11px] text-danger">{error}</span>}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {planned.length === 0 && (
            <div className="text-center py-8 text-[12px] text-ink-dim italic">
              <p>No planned tools yet. Add one above and it'll appear in the
                sidebar under "PLANNED".</p>
              <button
                onClick={seedFromSuggestions}
                disabled={seeding}
                className="mt-3 px-3 py-1.5 rounded bg-bg-base border border-divider
                           text-[12px] text-accent hover:border-accent
                           disabled:opacity-40 not-italic"
              >
                {seeding ? "Seeding…" : "Seed with curated suggestions (AD, Cloud, OSINT, Wireless, …)"}
              </button>
            </div>
          )}
          {planned.map((t) => (
            <div key={t.id}
                 className="border border-divider rounded p-3 hover:bg-bg-nav-hover transition">
              <div className="flex items-start gap-2 mb-1">
                <div className="flex-1">
                  <div className="text-[13px] font-bold text-ink-primary">{t.label}</div>
                  <div className="text-[10px] text-ink-dim">
                    added {new Date(t.addedAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => { onOpenTool(t.id); onClose(); }}
                  className="px-2 py-0.5 rounded bg-bg-base border border-divider
                             text-[11px] text-ink-muted hover:text-ink-primary"
                >
                  Open
                </button>
                <button
                  onClick={() => remove(t.id, t.label)}
                  className="px-2 py-0.5 rounded border border-divider
                             text-[11px] text-ink-muted hover:text-danger hover:border-danger"
                  aria-label={`Remove ${t.label}`}
                >
                  Remove
                </button>
              </div>
              {t.description && (
                <div className="text-[12px] text-ink-muted whitespace-pre-wrap mt-1">
                  {t.description}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
