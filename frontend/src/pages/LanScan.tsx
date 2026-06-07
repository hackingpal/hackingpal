import { useEffect, useRef, useState } from "react";
import { fetchLanInfo, openWs, type LanEvent, type LanInfo } from "../api";
import EmptyStateComponent from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";

type Host = { ip: string; hostname: string; mac: string; isSelf: boolean };

function ipKey(ip: string) {
  return ip.split(".").map((s) => parseInt(s, 10).toString().padStart(3, "0")).join(".");
}

export default function LanScan() {
  const [info,     setInfo]     = useState<LanInfo | null>(null);
  const [scanning, setScanning] = useState(false);
  const [stopped,  setStopped]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [hosts,    setHosts]    = useState<Host[]>([]);
  const [done,     setDone]     = useState(0);
  const [total,    setTotal]    = useState(0);
  const [elapsed,  setElapsed]  = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetchLanInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  function start() {
    if (scanning) return;
    setScanning(true); setStopped(false); setError(null);
    setHosts([]); setDone(0); setTotal(0); setElapsed(null);

    const ws = openWs("/ws/lan-scan");
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({}));

    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data) as LanEvent;
      switch (ev.type) {
        case "started":
          setTotal(ev.total_hosts);
          break;
        case "host":
          setHosts((h) => [
            ...h,
            { ip: ev.ip, hostname: ev.hostname, mac: ev.mac, isSelf: ev.is_self },
          ].sort((a, b) => ipKey(a.ip).localeCompare(ipKey(b.ip))));
          break;
        case "mac_update":
          setHosts((h) => h.map((x) => x.ip === ev.ip ? { ...x, mac: ev.mac } : x));
          break;
        case "progress":
          setDone(ev.done); setTotal(ev.total);
          break;
        case "done":
          setElapsed(ev.elapsed); setStopped(ev.stopped);
          setScanning(false); ws.close();
          break;
        case "error":
          setError(ev.detail); setScanning(false); ws.close();
          break;
      }
    };

    ws.onerror = () => { setError("WebSocket error"); setScanning(false); };
    ws.onclose = () => { if (scanning) setScanning(false); };
  }

  function stop() {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "stop" }));
    }
  }

  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
              Discovery
            </div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              LAN Scan
            </h2>
          </div>

          <div className="flex-1 flex items-end gap-4">
            <InfoChip label="Local IP" value={info?.local_ip ?? "—"} />
            <InfoChip label="Subnet"   value={info?.network ?? "—"} />
            <InfoChip label="Hosts"    value={info ? String(info.total_hosts) : "—"} />
            <div className="flex-1" />
            {!scanning ? (
              <button
                onClick={start}
                disabled={!info}
                className="bg-accent hover:bg-accentDim active:translate-y-px
                           text-white text-xs font-bold tracking-wide
                           px-3.5 py-1.5 rounded transition border border-accent/60
                           disabled:opacity-50"
              >
                ▶ Scan LAN
              </button>
            ) : (
              <button
                onClick={stop}
                className="bg-danger/10 hover:bg-danger/20 active:translate-y-px
                           text-danger text-xs font-bold tracking-wide
                           px-3.5 py-1.5 rounded transition border border-danger/60"
              >
                ■ Stop
              </button>
            )}
          </div>
        </div>

        {(scanning || elapsed !== null) && (
          <div className="mt-3 space-y-1">
            <div className="h-1 rounded bg-bg-card overflow-hidden">
              <div className="h-full bg-accent transition-[width] duration-100"
                   style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] tracking-widest text-ink-dim font-mono">
              <span>{info?.network ?? "—"}</span>
              <span>
                {done}/{total} · {pct}% · {hosts.length} found
                {elapsed !== null && ` · ${elapsed}s`}
                {stopped && " · STOPPED"}
              </span>
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono mb-4">
            Error — {error}
          </div>
        )}

        {hosts.length === 0 && !scanning && !error && (
          <EmptyStateComponent
            icon="🏠"
            title="LAN Scan"
            description="Enumerate hosts on your local subnet with TCP probe, reverse DNS, and ARP MAC enrichment."
            hint="No external traffic — only the subnet you're on."
          />
        )}

        {(hosts.length > 0 || scanning) && (
          <HostsTable
            hosts={hosts}
            scanning={scanning}
            elapsed={elapsed}
            stopped={stopped}
          />
        )}
      </div>
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</div>
      <div className="text-xs font-mono text-ink-primary mt-0.5">{value}</div>
    </div>
  );
}

function HostsTable({
  hosts, scanning, elapsed, stopped,
}: { hosts: Host[]; scanning: boolean; elapsed: number | null; stopped: boolean }) {
  return (
    <section className="border border-divider rounded-md overflow-hidden bg-bg-card">
      <div className="grid grid-cols-[40px_140px_1fr_180px_60px] gap-3 px-3 py-1.5
                      bg-bg-panel border-b border-divider text-[10px]
                      uppercase tracking-[0.2em] text-ink-dim">
        <span>#</span><span>IP Address</span><span>Hostname</span><span>MAC Address</span><span></span>
      </div>
      <div className="font-mono text-xs">
        {hosts.map((h, i) => (
          <div
            key={h.ip}
            style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
            className={
              "group grid grid-cols-[40px_140px_1fr_180px_60px] gap-3 px-3 py-1 mhp-result-in" +
              (h.isSelf ? " bg-accent/10" : i % 2 === 0 ? " bg-bg-card" : " bg-bg-row-alt")
            }
          >
            <span className="text-ink-dim tabular-nums">{i + 1}</span>
            <span className={h.isSelf ? "text-accent" : "text-ink-primary"}>
              {h.ip}{h.isSelf && <span className="ml-1 text-accent">★</span>}
            </span>
            <span className="text-ink-muted truncate">{h.hostname || "—"}</span>
            <span className="text-ink-primary tabular-nums">{h.mac || "—"}</span>
            <span className="flex justify-end">
              <CopyButton text={`${h.ip}\t${h.hostname || ""}\t${h.mac || ""}`} />
            </span>
          </div>
        ))}
      </div>
      <StatsBar
        total={hosts.length}
        elapsed={elapsed ?? undefined}
        running={scanning}
        extra={stopped ? "stopped" : undefined}
      />
    </section>
  );
}
