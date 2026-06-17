// Unified Playbooks workspace. Hosts the two prior pages — Browse (Presets)
// and Build (PlaybookBuilder) — under a single sidebar entry with internal
// sub-tabs. Both `playbooks` and `playbook-builder` nav ids route here; the
// id picks the initial sub-tab.

import { useState } from "react";
import Presets from "./Presets";
import PlaybookBuilder from "./PlaybookBuilder";

type SubTab = "browse" | "build";

type Props = {
  initialTab?: SubTab;
  onJumpTo: (id: string) => void;
};

export default function Playbooks({ initialTab = "browse", onJumpTo }: Props): JSX.Element {
  const [tab, setTab] = useState<SubTab>(initialTab);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-divider bg-bg-sidebar">
        <button
          onClick={() => setTab("browse")}
          className={
            "text-[11px] tracking-widest px-3 py-1 rounded transition " +
            (tab === "browse"
              ? "bg-bg-nav-active text-accent border border-accentDim"
              : "text-ink-muted hover:text-ink-primary border border-transparent")
          }
        >
          BROWSE
        </button>
        <button
          onClick={() => setTab("build")}
          className={
            "text-[11px] tracking-widest px-3 py-1 rounded transition " +
            (tab === "build"
              ? "bg-bg-nav-active text-accent border border-accentDim"
              : "text-ink-muted hover:text-ink-primary border border-transparent")
          }
        >
          BUILD
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === "browse" ? <Presets /> : <PlaybookBuilder onJumpTo={onJumpTo} />}
      </div>
    </div>
  );
}
