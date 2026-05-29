/**
 * Nmap NSE Script Picker.
 *
 * Drops into the Nmap page as a collapsible panel. Three tabs:
 *
 *   - Presets:    cards for curated recipes (quick_vuln, web_enum, etc.)
 *   - Categories: accordion of NSE categories with per-script checkboxes
 *   - Custom:     free-text --script and --script-args
 *
 * All three tabs update the same draft state, which the parent merges into
 * its `opts` (via `onApply`) so the existing argv-preview / scan flow
 * picks the selection up without needing a separate code path.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

export type ScriptPickerPatch = {
  nse_categories?: string[];
  nse_scripts?: string[];
  nse_args?: string;
  port_spec?: string;
  service_version?: boolean;
  os_detect?: boolean;
  traceroute?: boolean;
};

type Preset = {
  id: string; name: string; description: string;
  categories: string[]; scripts: string[];
  ports?: string; service_version?: boolean;
  os_detect?: boolean; traceroute?: boolean;
  risk: "safe" | "moderate" | "intrusive";
  args_preview: string;
};

type ScriptRow = {
  name: string; category: string; categories: string[];
  risk: "safe" | "moderate" | "intrusive"; description: string;
};

type CatalogResp = {
  count: number;
  scripts_dir: string;
  scripts: ScriptRow[];
  category_index: Record<string, string[]>;
  risk_groups: Record<string, string[]>;
};

type PresetResp = { presets: Record<string, Preset> };

type Tab = "presets" | "categories" | "custom";

const RISK_COLOR: Record<string, string> = {
  safe:      "text-phos border-phos/40",
  moderate:  "text-amber border-amber/40",
  intrusive: "text-danger border-danger/50",
};

export default function NmapScriptPicker({
  selectedCategories,
  selectedScripts,
  scriptArgs,
  onApply,
}: {
  selectedCategories: string[];
  selectedScripts: string[];
  scriptArgs: string;
  onApply: (patch: ScriptPickerPatch & { _preset?: string | null }) => void;
}) {
  const [tab, setTab] = useState<Tab>("presets");
  const [presets, setPresets] = useState<Record<string, Preset>>({});
  const [catalog, setCatalog] = useState<CatalogResp | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [customScript, setCustomScript] = useState("");
  const [customArgs, setCustomArgs] = useState(scriptArgs);
  const [error, setError] = useState("");

  useEffect(() => {
    api<PresetResp>("/nmap/script-presets").then((r) => setPresets(r.presets))
      .catch((e) => setError(String(e)));
    api<CatalogResp>("/nmap/scripts").then(setCatalog)
      .catch(() => {/* catalog optional — presets still work */});
  }, []);

  const intrusiveSelected = useMemo(() => {
    if (!catalog) return false;
    const all = new Set([...selectedScripts]);
    selectedCategories.forEach((c) => {
      (catalog.category_index[c] ?? []).forEach((s) => all.add(s));
    });
    return [...all].some((name) => {
      const row = catalog.scripts.find((s) => s.name === name);
      return row?.risk === "intrusive";
    }) || selectedCategories.some((c) =>
      ["vuln", "exploit", "brute", "dos", "fuzzer", "malware", "intrusive"].includes(c),
    );
  }, [catalog, selectedCategories, selectedScripts]);

  function applyPreset(id: string) {
    const p = presets[id];
    if (!p) return;
    setActivePreset(id);
    onApply({
      nse_categories: [...p.categories],
      nse_scripts:    [...p.scripts],
      port_spec:      p.ports ?? "",
      service_version: !!p.service_version,
      os_detect:       !!p.os_detect,
      traceroute:      !!p.traceroute,
      _preset:         id,
    });
  }

  function toggleScript(name: string) {
    const next = selectedScripts.includes(name)
      ? selectedScripts.filter((s) => s !== name)
      : [...selectedScripts, name];
    setActivePreset(null);
    onApply({ nse_scripts: next, _preset: null });
  }

  function toggleAllInCategory(cat: string) {
    if (!catalog) return;
    const all = catalog.category_index[cat] ?? [];
    const allOn = all.every((n) => selectedScripts.includes(n));
    const next = allOn
      ? selectedScripts.filter((n) => !all.includes(n))
      : Array.from(new Set([...selectedScripts, ...all]));
    setActivePreset(null);
    onApply({ nse_scripts: next, _preset: null });
  }

  function applyCustom() {
    const list = customScript.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    setActivePreset(null);
    onApply({
      nse_scripts: Array.from(new Set([...selectedScripts, ...list])),
      nse_args:    customArgs,
      _preset:     null,
    });
  }

  const filteredCategories = useMemo(() => {
    if (!catalog) return [] as [string, string[]][];
    const entries = Object.entries(catalog.category_index)
      .sort(([a], [b]) => a.localeCompare(b));
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries
      .map(([cat, scripts]) =>
        [cat, scripts.filter((s) => s.toLowerCase().includes(q))] as [string, string[]])
      .filter(([, s]) => s.length > 0);
  }, [catalog, search]);

  // Live preview — match the parent's argv builder shape (-sV, -p, --script, --script-args).
  const commandPreview = useMemo(() => {
    const parts: string[] = ["nmap"];
    if (selectedCategories.length || selectedScripts.length) {
      const scripts = [...selectedCategories, ...selectedScripts].join(",");
      parts.push("--script", scripts);
    }
    if (customArgs.trim()) parts.push("--script-args", customArgs.trim());
    if (activePreset && presets[activePreset]?.ports)
      parts.unshift(`-p ${presets[activePreset].ports}`);
    return parts.join(" ");
  }, [selectedCategories, selectedScripts, customArgs, activePreset, presets]);

  return (
    <div className="border border-divider rounded-md bg-bg-card">
      <div className="flex border-b border-divider">
        {(["presets", "categories", "custom"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
                  className={"px-3 py-1.5 text-[11px] uppercase tracking-wider border-r border-divider " +
                    (tab === t ? "bg-accent/15 text-accent font-bold" : "text-ink-muted hover:text-ink-primary")}>
            {t}
          </button>
        ))}
        <div className="ml-auto px-3 py-1.5 text-[10px] text-ink-dim tracking-wider">
          NSE SCRIPT PICKER
        </div>
      </div>

      {intrusiveSelected && (
        <div className="px-3 py-2 bg-danger/10 border-b border-danger/30 text-[11px] text-danger">
          ⚠ Intrusive scripts may trigger IDS alerts or cause service disruption.
          Ensure you have authorization.
        </div>
      )}
      {error && (
        <div className="px-3 py-1 text-[11px] text-danger">⚠ {error}</div>
      )}

      <div className="p-3">
        {tab === "presets" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.values(presets).map((p) => (
              <button key={p.id} onClick={() => applyPreset(p.id)}
                      className={"text-left border rounded p-2 hover:border-accent " +
                        (activePreset === p.id ? "border-accent bg-accent/10" : "border-divider")}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-bold text-ink-primary">{p.name}</span>
                  <span className={"text-[9px] uppercase tracking-wider px-1.5 rounded border " +
                    RISK_COLOR[p.risk]}>{p.risk}</span>
                </div>
                <div className="text-[10px] text-ink-muted mb-1">{p.description}</div>
                <code className="text-[10px] text-amber font-mono">{p.args_preview}</code>
              </button>
            ))}
            {Object.keys(presets).length === 0 && (
              <div className="text-[11px] text-ink-dim italic col-span-full">Loading presets…</div>
            )}
          </div>
        )}

        {tab === "categories" && (
          <div className="space-y-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="filter scripts…"
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1
                              text-[11px] font-mono focus:outline-none focus:border-accent" />
            {!catalog && <div className="text-[11px] text-ink-dim italic">Loading NSE catalog…</div>}
            {filteredCategories.map(([cat, scripts]) => {
              const allOn = scripts.every((s) => selectedScripts.includes(s));
              const someOn = scripts.some((s) => selectedScripts.includes(s));
              const isOpen = openCat === cat;
              return (
                <div key={cat} className="border border-divider rounded">
                  <button onClick={() => setOpenCat(isOpen ? null : cat)}
                          className="w-full px-2 py-1 flex items-center gap-2 hover:bg-bg-nav-hover">
                    <span className="text-[10px] text-ink-dim">{isOpen ? "▼" : "▶"}</span>
                    <span className="text-[12px] font-bold text-ink-primary">{cat}</span>
                    <span className="text-[10px] text-ink-dim">({scripts.length})</span>
                    <span className="ml-auto flex items-center gap-2">
                      <span onClick={(e) => { e.stopPropagation(); toggleAllInCategory(cat); }}
                            className={"text-[10px] tracking-wider px-1.5 py-0.5 rounded border cursor-pointer " +
                              (allOn ? "bg-accent text-white border-accent"
                                : someOn ? "border-amber text-amber"
                                : "border-divider text-ink-muted")}>
                        {allOn ? "ALL ON" : someOn ? "PARTIAL" : "SELECT ALL"}
                      </span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-3 py-2 grid grid-cols-2 md:grid-cols-3 gap-1 border-t border-divider">
                      {scripts.map((s) => (
                        <label key={s} className="flex items-center gap-1 text-[10px] cursor-pointer">
                          <input type="checkbox" checked={selectedScripts.includes(s)}
                                 onChange={() => toggleScript(s)} />
                          <span className="font-mono text-ink-primary truncate">{s}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "custom" && (
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] tracking-wider text-ink-muted mb-1">--SCRIPT</label>
              <input value={customScript} onChange={(e) => setCustomScript(e.target.value)}
                     placeholder="http-title,ssl-cert,smb-*"
                     className="w-full bg-bg-base border border-divider rounded px-2 py-1
                                text-[11px] font-mono focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block text-[10px] tracking-wider text-ink-muted mb-1">--SCRIPT-ARGS</label>
              <input value={customArgs} onChange={(e) => setCustomArgs(e.target.value)}
                     placeholder='user=admin,pass=secret'
                     className="w-full bg-bg-base border border-divider rounded px-2 py-1
                                text-[11px] font-mono focus:outline-none focus:border-accent" />
            </div>
            <button onClick={applyCustom}
                    className="px-3 py-1 rounded bg-accent text-white text-[11px] font-bold">
              Add to selection
            </button>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-divider bg-bg-panel font-mono text-[11px] text-ink-primary overflow-x-auto">
        <span className="text-ink-dim mr-2">$</span>{commandPreview}
      </div>
    </div>
  );
}
