// Collapsible setup-requirements banner for a tool page.
// Default-collapsed when ready; default-expanded when something is
// missing so the user sees the install hint without scrolling.

import { useState } from "react";
import { useToolRequirement, type ToolRequirement } from "../lib/toolRequirements";

type Props = { toolId: string };

export default function ToolRequirements({ toolId }: Props) {
  const { req, readiness, loading, refetch } = useToolRequirement(toolId);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);

  if (loading) return null;
  if (!req) return null;

  const ready = readiness?.ready ?? false;
  const open = openOverride ?? !ready;

  const missingBins = new Set(readiness?.missing.binaries ?? []);
  const missingKeys = new Set(readiness?.missing.api_keys ?? []);
  const sudoersMissing = readiness?.missing.sudoers ?? false;
  const platformBad = readiness?.missing.platform ?? false;

  return (
    <div className={
      "border rounded-md mb-3 text-[12px] " +
      (ready
        ? "border-divider bg-bg-card"
        : "border-amber/40 bg-amber/5")
    }>
      <button
        onClick={() => setOpenOverride(open ? false : true)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
      >
        <span className={
          "inline-block w-1.5 h-1.5 rounded-full " +
          (ready ? "bg-phos" : "bg-amber")
        } />
        <span className="font-bold text-ink-primary">
          {ready ? "Ready to run" : "Needs setup"}
        </span>
        <span className="text-ink-dim">·</span>
        <span className="text-ink-muted">
          Target: <code className="font-mono">{req.target_format}</code>
        </span>
        {!ready && (
          <span className="ml-2 text-amber font-mono">
            {summarizeMissing(req, readiness)}
          </span>
        )}
        <span className="ml-auto text-ink-dim">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-divider">
          {req.target_examples.length > 0 && (
            <Row label="Examples">
              {req.target_examples.map((e) => (
                <code key={e} className="font-mono mr-2 text-ink-primary">{e}</code>
              ))}
            </Row>
          )}

          {req.setup.binaries.length > 0 && (
            <Row label="Binaries">
              <div className="space-y-0.5">
                {req.setup.binaries.map((b) => (
                  <div key={b.name} className="flex gap-2">
                    <code className={
                      "font-mono " +
                      (missingBins.has(b.name) ? "text-amber" : "text-phos")
                    }>{b.name}</code>
                    <span className="text-ink-dim">·</span>
                    <span className="text-ink-muted font-mono">{b.install_hint}</span>
                  </div>
                ))}
              </div>
            </Row>
          )}

          {req.setup.api_keys.length > 0 && (
            <Row label="API keys">
              <div className="space-y-0.5">
                {req.setup.api_keys.map((k) => (
                  <div key={k.provider}>
                    <span className={
                      "font-bold " +
                      (missingKeys.has(k.provider) ? "text-amber" : "text-phos")
                    }>{k.provider}</span>
                    <span className="text-ink-muted"> — {k.how_to}</span>
                    {k.env_var && (
                      <span className="text-ink-dim font-mono"> [{k.env_var}]</span>
                    )}
                  </div>
                ))}
              </div>
            </Row>
          )}

          {req.setup.sudoers && (
            <Row label="Sudoers">
              <span className={sudoersMissing ? "text-amber" : "text-phos"}>
                {sudoersMissing ? "Not installed" : "Installed"}
              </span>
              {req.setup.sudoers_file && (
                <code className="ml-2 font-mono text-ink-muted">
                  {req.setup.sudoers_file}
                </code>
              )}
            </Row>
          )}

          {req.setup.platforms.length < 3 && (
            <Row label="Platforms">
              <span className={platformBad ? "text-amber" : "text-ink-primary"}>
                {req.setup.platforms.join(" · ")}
              </span>
            </Row>
          )}

          <Row label="What this finds">
            <span className="text-ink-primary">{req.expected_output}</span>
          </Row>

          {req.notes && (
            <Row label="Notes">
              <span className="text-ink-muted">{req.notes}</span>
            </Row>
          )}

          <div className="pt-1">
            <button
              onClick={refetch}
              className="text-[10px] text-ink-dim hover:text-ink-primary transition
                         border border-divider rounded px-2 py-0.5"
            >
              Re-check
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-24 shrink-0 text-ink-dim uppercase tracking-wider text-[10px] pt-0.5">
        {label}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function summarizeMissing(_req: ToolRequirement, r: { missing: { binaries: string[]; api_keys: string[]; sudoers: boolean; platform: boolean } } | null): string {
  if (!r) return "";
  const parts: string[] = [];
  if (r.missing.binaries.length) parts.push(`bin: ${r.missing.binaries.join(", ")}`);
  if (r.missing.api_keys.length) parts.push(`key: ${r.missing.api_keys.join(", ")}`);
  if (r.missing.sudoers) parts.push("sudoers");
  if (r.missing.platform) parts.push("wrong OS");
  return parts.join(" · ");
}
