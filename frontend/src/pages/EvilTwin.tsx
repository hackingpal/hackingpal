import { useState } from "react";
import { useAttackWS } from "../components/webattack/useAttackWS";

type Sample = {
  bssid: string;
  round: number;
  rssi: number;
  security: string;
  channel: number;
  oui: string;
  rounds_seen: number;
};

type Finding = {
  ssid: string;
  bssids: string[];
  samples: Sample[];
  reasons: string[];
  severity: "critical" | "high" | "medium" | "low" | "info";
};

type EvilTwinEvent =
  | { type: "scan_start"; round: number; total: number }
  | { type: "observation"; ssid: string; bssid: string; rssi: number; security: string; round: number }
  | ({ type: "finding" } & Finding)
  | { type: "done"; total_unique: number; groups: number; stopped: boolean }
  | { type: "error"; detail: string };

const SEV: Record<string, string> = {
  high:   "text-danger border-danger/40 bg-danger/10",
  medium: "text-amber border-amber/40 bg-amber/10",
  low:    "text-accent border-accent/40 bg-accent/10",
  info:   "text-ink-muted border-divider",
};

export default function EvilTwin() {
  const [rounds, setRounds] = useState(3);
  const [interval, setInterval] = useState(2);
  const [target, setTarget] = useState("");

  const [findings, setFindings] = useState<Finding[]>([]);
  const [progress, setProgress] = useState({ round: 0, total: 0 });
  const [obsCount, setObsCount] = useState(0);
  const [doneText, setDoneText] = useState("");

  const { status, error, start, stop } = useAttackWS<EvilTwinEvent>(
    "/ws/evil-twin",
    (ev) => {
      if (ev.type === "scan_start") {
        if (ev.round === 1) {
          setFindings([]); setObsCount(0); setDoneText("");
        }
        setProgress({ round: ev.round, total: ev.total });
      } else if (ev.type === "observation") {
        setObsCount((c) => c + 1);
      } else if (ev.type === "finding") {
        const f = { ...(ev as Finding) };
        setFindings((prev) => [...prev, f]);
      } else if (ev.type === "done") {
        setDoneText(`${ev.total_unique} unique APs, ${ev.groups} suspicious group(s)${ev.stopped ? " (stopped)" : ""}`);
      }
    },
    "/evil-twin/scan",
  );

  const running = status === "connecting" || status === "running";

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">EVIL TWIN DETECTOR</h2>
        <p className="text-[11px] text-ink-dim">
          Repeated WiFi scans, correlated. Flags multiple BSSIDs claiming the
          same SSID — especially when security types or vendor OUIs differ.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 mb-4 space-y-3">
        <div className="grid grid-cols-3 gap-3 text-[12px]">
          <label>scans <input type="number" min={1} max={10} value={rounds}
                 onChange={(e) => setRounds(parseInt(e.target.value) || 3)}
                 disabled={running}
                 className="ml-1 w-16 bg-bg-base border border-divider rounded px-1.5 py-0.5
                            font-mono focus:outline-none focus:border-accent" /></label>
          <label>interval <input type="number" min={0.5} max={30} step={0.5} value={interval}
                 onChange={(e) => setInterval(parseFloat(e.target.value) || 2)}
                 disabled={running}
                 className="ml-1 w-16 bg-bg-base border border-divider rounded px-1.5 py-0.5
                            font-mono focus:outline-none focus:border-accent" />s</label>
          <label>target SSID
                 <input value={target} onChange={(e) => setTarget(e.target.value)}
                        disabled={running} placeholder="(any)"
                        className="ml-1 w-32 bg-bg-base border border-divider rounded px-1.5 py-0.5
                                   font-mono focus:outline-none focus:border-accent" /></label>
        </div>
        <div className="flex items-center gap-2">
          {!running ? (
            <button onClick={() => start({
              scans: rounds, interval_sec: interval, target_ssid: target || undefined,
            })}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold">
              Start Scan
            </button>
          ) : (
            <button onClick={stop}
                    className="px-3 py-1.5 rounded bg-bg-base border border-danger text-danger text-[12px]">
              Stop
            </button>
          )}
          {progress.total > 0 && (
            <span className="text-[11px] text-ink-dim">
              round {progress.round}/{progress.total} · {obsCount} observations · {findings.length} suspicious
            </span>
          )}
          {doneText && <span className="text-[11px] text-ink-dim">{doneText}</span>}
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      {findings.length === 0 && !running && progress.total > 0 && (
        <div className="text-[12px] text-phos italic">
          ✓ No suspicious SSID groups in this scan.
        </div>
      )}

      <div className="space-y-2">
        {findings.map((f, i) => (
          <div key={i} className={"border rounded p-3 " + SEV[f.severity]}>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-bold uppercase tracking-wider text-[11px]">{f.severity}</span>
              <span className="text-ink-primary text-[13px] font-mono">{f.ssid}</span>
              <span className="text-ink-dim text-[10px]">{f.bssids.length} BSSIDs</span>
            </div>
            <ul className="text-[11px] text-ink-muted list-disc pl-5 mb-2 space-y-0.5">
              {f.reasons.map((r, j) => <li key={j}>{r}</li>)}
            </ul>
            <table className="w-full text-[11px]">
              <thead className="text-[10px] text-ink-dim tracking-wider">
                <tr>
                  <th className="text-left">BSSID</th>
                  <th className="text-left">SECURITY</th>
                  <th className="text-right">CH</th>
                  <th className="text-right">RSSI</th>
                  <th className="text-left">OUI</th>
                  <th className="text-right">SEEN</th>
                </tr>
              </thead>
              <tbody>
                {f.samples.map((s, j) => (
                  <tr key={j} className="border-t border-divider/40">
                    <td className="font-mono text-ink-primary">{s.bssid}</td>
                    <td className="text-ink-muted">{s.security}</td>
                    <td className="text-right font-mono tabular-nums">{s.channel}</td>
                    <td className="text-right font-mono tabular-nums">{s.rssi}</td>
                    <td className="font-mono text-ink-dim">{s.oui}</td>
                    <td className="text-right font-mono tabular-nums">{s.rounds_seen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
