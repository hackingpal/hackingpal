import { useEffect, useState } from "react";
import { api } from "../api";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";
import PromoteToFindingButton from "../components/PromoteToFindingButton";

type BtDevice = {
  address: string;
  name: string;
  manufacturer: string;
  minor_type: string;
  vendor_id: string;
  product_id: string;
  firmware: string;
  battery: string | number;
  rssi: string | number;
  connected: boolean;
  last_seen: string;
  services: string[];
};

type Controller = {
  address: string;
  state: string;
  discoverable: boolean;
  firmware: string;
  manufacturer: string;
  vendor_id: string;
  product_id: string;
};

type StatusResp = { controllers: Controller[] };
type DevicesResp = {
  connected: BtDevice[];
  paired: BtDevice[];
  not_paired: BtDevice[];
  summary: { connected: number; paired: number; not_paired: number };
};

export default function BtRecon() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [devices, setDevices] = useState<DevicesResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [s, d] = await Promise.all([
        api<StatusResp>("/bt/status"),
        api<DevicesResp>("/bt/devices"),
      ]);
      setStatus(s); setDevices(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="flex items-center mb-3 gap-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">BLUETOOTH RECON</h2>
        <span className="text-[11px] text-ink-dim">
          {devices ? `${devices.summary.connected} connected, ${devices.summary.paired} paired, ${devices.summary.not_paired} recent` : ""}
        </span>
        <span className="flex-1" />
        <button onClick={load} disabled={loading}
                className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold disabled:opacity-40">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error && <div className="text-[12px] text-danger mb-2">⚠ {error}</div>}

      {status?.controllers.map((c, i) => (
        <div key={i} className="bg-bg-card border border-divider rounded p-3 mb-3 text-[12px]">
          <div className="text-[10px] text-ink-muted tracking-wider mb-1">CONTROLLER #{i + 1}</div>
          <div className="grid grid-cols-2 gap-3">
            <div>Address: <span className="font-mono text-accent">{c.address}</span></div>
            <div>State: <span className={c.state === "attrib_On" ? "text-phos" : "text-ink-muted"}>{c.state.replace("attrib_", "")}</span></div>
            <div>Manufacturer: <span className="text-ink-primary">{c.manufacturer}</span></div>
            <div>Discoverable: <span className={c.discoverable ? "text-amber" : "text-ink-dim"}>{c.discoverable ? "yes" : "no"}</span></div>
          </div>
        </div>
      ))}

      {!devices && !loading && !error && (
        <EmptyState
          icon="🔵"
          title="Bluetooth recon"
          description="Local controller info + connected / paired / recent devices, OUI manufacturer lookup."
        />
      )}

      {devices && (
        <>
          <StatsBar
            total={devices.summary.connected + devices.summary.paired + devices.summary.not_paired}
            extra={`${devices.summary.connected} connected · ${devices.summary.paired} paired · ${devices.summary.not_paired} recent`}
            className="mb-3"
          />
          {(["connected", "paired", "not_paired"] as const).map((group) => {
            const list = devices[group];
            if (list.length === 0) return null;
            return (
              <div key={group} className="mb-4">
                <h3 className="text-[11px] text-ink-muted tracking-wider mb-1 uppercase">
                  {group.replace("_", " ")} ({list.length})
                </h3>
                <div className="bg-bg-card border border-divider rounded overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-bg-panel border-b border-divider text-ink-muted text-[10px] tracking-wider">
                      <tr>
                        <th className="text-left px-3 py-1.5">NAME</th>
                        <th className="text-left px-3 py-1.5">ADDRESS</th>
                        <th className="text-left px-3 py-1.5">MANUFACTURER</th>
                        <th className="text-left px-3 py-1.5">TYPE</th>
                        <th className="text-right px-3 py-1.5 w-16">RSSI</th>
                        <th className="text-right px-3 py-1.5 w-16">BATT</th>
                        <th className="text-left px-3 py-1.5">LAST SEEN</th>
                        <th className="px-3 py-1.5 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((d, i) => {
                        const copyText = `${d.name || "(no name)"} ${d.address} · ${d.manufacturer} · ${d.minor_type}`;
                        return (
                          <tr
                            key={i}
                            style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                            className="mhp-result-in group border-b border-divider hover:bg-bg-nav-hover"
                          >
                            <td className="px-3 py-1 font-mono text-ink-primary">{d.name || <span className="text-ink-dim italic">(no name)</span>}</td>
                            <td className="px-3 py-1 font-mono text-accent">{d.address}</td>
                            <td className="px-3 py-1 text-ink-muted">{d.manufacturer}</td>
                            <td className="px-3 py-1 text-ink-muted">{d.minor_type}</td>
                            <td className="px-3 py-1 font-mono text-right tabular-nums">{d.rssi || "—"}</td>
                            <td className="px-3 py-1 font-mono text-right tabular-nums">{d.battery || "—"}</td>
                            <td className="px-3 py-1 text-ink-dim">{d.last_seen}</td>
                            <td className="px-3 py-1">
                              <span className="flex items-center gap-1 justify-end">
                                <CopyButton text={copyText} />
                                <PromoteToFindingButton
                                  variant="compact"
                                  seed={{
                                    tool: "bt-recon",
                                    target: d.address,
                                    title: `Bluetooth device${group === "connected" ? " (connected)" : ""}: ${d.name || "(no name)"}${d.manufacturer ? ` · ${d.manufacturer}` : ""}`,
                                    severity: group === "connected" ? "medium" : "info",
                                    evidence: JSON.stringify(
                                      { address: d.address, name: d.name,
                                        manufacturer: d.manufacturer, type: d.minor_type,
                                        group, rssi: d.rssi, last_seen: d.last_seen },
                                      null, 2,
                                    ),
                                  }}
                                />
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
