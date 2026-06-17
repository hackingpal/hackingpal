// Top-bar pill showing the active target. Click → dropdown grouped by
// kind (Labs / Manual / Tailscale / SSH / LAN) with quick switch and a
// "Manage targets" link. Mirrors EngagementPill.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  listTargets, setActiveTarget, useActiveTargetId,
  type Target, type TargetKind,
} from "../lib/targets";

type Props = { onOpenTargetsPage: () => void };

const KIND_ORDER: TargetKind[] = ["lab", "manual", "tailscale", "ssh", "lan"];
const KIND_LABEL: Record<TargetKind, string> = {
  lab: "Labs", manual: "Manual", tailscale: "Tailscale", ssh: "SSH", lan: "LAN",
};

export default function ActiveTargetPicker({ onOpenTargetsPage }: Props) {
  const activeId = useActiveTargetId();
  const [targets, setTargets] = useState<Target[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      setTargets(await listTargets());
    } catch { /* backend may not be up yet */ }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (open) void refresh(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const active = useMemo(
    () => targets.find((t) => t.id === activeId) ?? null,
    [targets, activeId],
  );

  const grouped = useMemo(() => {
    const out: Record<TargetKind, Target[]> = {
      lab: [], manual: [], tailscale: [], ssh: [], lan: [],
    };
    for (const t of targets) {
      if (t.kind in out) out[t.kind].push(t);
    }
    return out;
  }, [targets]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Active target — pre-fills tool pages"
        className={
          "flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] tracking-wider " +
          "border transition leading-none font-mono " +
          (active
            ? "border-accent/50 text-accent hover:border-accent"
            : "border-divider text-ink-dim hover:border-ink-muted hover:text-ink-primary")
        }
      >
        <span aria-hidden style={{ fontSize: 9, lineHeight: 1 }}>◎</span>
        <span className="uppercase max-w-[180px] truncate">
          {active ? active.name : "No target"}
        </span>
        <span className="text-ink-dim">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-bg-card border border-divider
                        rounded shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-divider text-[10px] tracking-widest text-ink-muted">
            ACTIVE TARGET
          </div>

          <button
            onClick={() => { setActiveTarget(null); setOpen(false); }}
            className={
              "w-full text-left px-3 py-2 text-[12px] " +
              (activeId === null
                ? "bg-bg-nav-active text-ink-primary"
                : "text-ink-muted hover:bg-bg-nav-hover")
            }
          >
            <div className="flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink-dim" />
              None (no pre-fill)
            </div>
          </button>

          <div className="max-h-72 overflow-y-auto border-t border-divider">
            {targets.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-ink-dim italic">
                No targets yet. Start a lab or add one from the Targets page.
              </div>
            )}
            {KIND_ORDER.map((kind) => {
              const rows = grouped[kind];
              if (rows.length === 0) return null;
              return (
                <div key={kind}>
                  <div className="px-3 py-1 text-[9px] tracking-widest text-ink-dim
                                  uppercase bg-bg-base/40 font-bold">
                    {KIND_LABEL[kind]}
                  </div>
                  {rows.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { setActiveTarget(t); setOpen(false); }}
                      className={
                        "w-full text-left px-3 py-1.5 text-[12px] " +
                        (t.id === activeId
                          ? "bg-bg-nav-active text-accent"
                          : "text-ink-primary hover:bg-bg-nav-hover")
                      }
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={"inline-block w-1.5 h-1.5 rounded-full " +
                          (t.id === activeId ? "bg-accent" : "bg-ink-dim")} />
                        <span className="flex-1 truncate">{t.name}</span>
                        <span className="text-[10px] text-ink-dim font-mono truncate max-w-[40%]">
                          {t.address}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => { setOpen(false); onOpenTargetsPage(); }}
            className="w-full text-left px-3 py-2 text-[11px] border-t border-divider
                       text-ink-primary hover:bg-bg-nav-hover"
          >
            Manage targets →
          </button>
        </div>
      )}
    </div>
  );
}
