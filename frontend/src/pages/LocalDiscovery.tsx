import { useEffect, useRef, useState } from "react";
import { openWs, type LocalDiscoveryEvent } from "../api";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";

type Finding = LocalDiscoveryEvent extends infer T
  ? T extends { type: "found" } ? T : never
  : never;

const PROTO_TINT: Record<string, string> = {
  mdns:  "text-accent",
  ssdp:  "text-phos",
  llmnr: "text-amber",
};

export default function LocalDiscovery() {
  const [duration, setDuration] = useState(8);
  const [protocols, setProtocols] = useState<("mdns" | "ssdp" | "llmnr")[]>(["mdns","ssdp","llmnr"]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  function toggleProto(p: "mdns"|"ssdp"|"llmnr") {
    setProtocols((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);
  }

  function start() {
    if (protocols.length === 0) return;
    setRunning(true); setError(null);
    setFindings([]); setCounts({}); setElapsed(null);
    setStartedAt(Date.now());
    const ws = openWs("/ws/local-discovery");
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ protocols, duration }));
    ws.onmessage = (msg) => {
      const ev = JSON.parse(msg.data) as LocalDiscoveryEvent;
      if (ev.type === "found") {
        setFindings((f) => [...f, ev as Finding]);
      } else if (ev.type === "done") {
        setCounts(ev.counts); setElapsed(ev.elapsed); setRunning(false);
      } else if (ev.type === "error") {
        setError(ev.detail); setRunning(false);
      }
    };
    ws.onerror = () => { setError("WebSocket error"); setRunning(false); };
    ws.onclose  = () => setRunning(false);
  }

  const mdns  = findings.filter((f) => f.proto === "mdns");
  const ssdp  = findings.filter((f) => f.proto === "ssdp");
  const llmnr = findings.filter((f) => f.proto === "llmnr");

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6 flex-wrap">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Discovery</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Local Discovery
            </h2>
          </div>

          <div className="flex gap-3 items-center">
            {(["mdns","ssdp","llmnr"] as const).map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-ink-muted cursor-pointer">
                <input type="checkbox" checked={protocols.includes(p)}
                       onChange={() => toggleProto(p)} disabled={running} />
                <span className={PROTO_TINT[p]}>{p}</span>
              </label>
            ))}
          </div>

          <label className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-ink-muted">
            duration
            <input type="number" min={2} max={30} value={duration} disabled={running}
                   onChange={(e) => setDuration(parseInt(e.target.value) || 8)}
                   className="w-16 bg-bg-card border border-divider rounded px-2 py-1 text-sm font-mono text-ink-primary" />
            s
          </label>

          <button onClick={start} disabled={running || protocols.length === 0}
            className="bg-accent hover:bg-accentDim active:translate-y-px
                       text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                       disabled:opacity-50 border border-accent/60">
            {running ? "Listening…" : "▶ Discover"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
        )}

        {(findings.length > 0 || running || elapsed != null) && (
          <StatsBar
            total={findings.length}
            critical={counts.llmnr ?? llmnr.length}
            startedAt={startedAt}
            running={running}
            extra={`mDNS: ${counts.mdns ?? mdns.length} · SSDP: ${counts.ssdp ?? ssdp.length}${elapsed != null ? ` · ${elapsed.toFixed(1)}s` : ""}`}
          />
        )}

        {mdns.length > 0 && (
          <Card title={`mDNS · ${mdns.length}`}>
            <div className="grid grid-cols-[1fr_2fr_auto] gap-x-3 gap-y-0.5">
              <span className="text-ink-dim text-[10px] uppercase tracking-wider">Service Type</span>
              <span className="text-ink-dim text-[10px] uppercase tracking-wider">Instance</span>
              <span></span>
              {mdns.map((f, i) => (
                <div
                  key={i}
                  style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                  className="mhp-result-in group col-span-3 grid grid-cols-[1fr_2fr_auto] gap-x-3"
                >
                  <span className="text-accent break-all">{f.service_type}</span>
                  <span className="text-ink-primary break-all">{f.instance}</span>
                  <CopyButton text={`${f.service_type} ${f.instance}`} />
                </div>
              ))}
            </div>
          </Card>
        )}

        {ssdp.length > 0 && (
          <Card title={`SSDP · ${ssdp.length}`}>
            <div className="grid grid-cols-[120px_1fr_2fr_auto] gap-x-3 gap-y-0.5">
              <span className="text-ink-dim text-[10px] uppercase tracking-wider">IP</span>
              <span className="text-ink-dim text-[10px] uppercase tracking-wider">Server</span>
              <span className="text-ink-dim text-[10px] uppercase tracking-wider">ST / Location</span>
              <span></span>
              {ssdp.map((f, i) => (
                <div
                  key={i}
                  style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                  className="mhp-result-in group col-span-4 grid grid-cols-[120px_1fr_2fr_auto] gap-x-3"
                >
                  <span className="text-phos">{f.ip}</span>
                  <span className="text-ink-primary break-all">{f.server}</span>
                  <span className="text-ink-muted break-all">
                    {f.st}{f.location && <div className="text-ink-dim">{f.location}</div>}
                  </span>
                  <CopyButton text={`${f.ip} ${f.server} ${f.st}${f.location ? ` ${f.location}` : ""}`} />
                </div>
              ))}
            </div>
          </Card>
        )}

        {llmnr.length > 0 && (
          <Card title={`LLMNR · ${llmnr.length}`}>
            <div className="text-ink-primary mhp-critical-pulse rounded">
              {llmnr.map((f, i) => (
                <div
                  key={i}
                  style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                  className="mhp-result-in group flex items-center gap-2"
                >
                  <span className="text-amber">{f.ip}</span>
                  <span className="text-ink-muted flex-1">responded ({f.bytes} bytes)</span>
                  <CopyButton text={`LLMNR responder ${f.ip} (${f.bytes} bytes)`} />
                </div>
              ))}
            </div>
            <div className="mt-2 text-ink-dim text-[11px]">
              Hosts on the LAN that respond to LLMNR queries — they can be
              used for poisoning attacks. Consider disabling LLMNR on each.
            </div>
          </Card>
        )}

        {!running && findings.length === 0 && !error && (
          <EmptyState
            icon="📡"
            title="Local discovery"
            description={`Listen ${duration}s for mDNS, SSDP & LLMNR traffic on this LAN.`}
            hint="LLMNR responders are highlighted — they enable Responder-style poisoning."
          />
        )}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md overflow-hidden border border-divider">
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel">{title}</header>
      <div className="bg-bg-card p-3 text-xs font-mono">{children}</div>
    </section>
  );
}
