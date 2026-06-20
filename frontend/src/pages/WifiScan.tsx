import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";
import { playNamed, getToolEffect } from "../lib/dopamine";
import EffectPicker from "../components/EffectPicker";

type Network = {
  ssid: string | null;
  bssid: string | null;
  rssi: number;
  noise: number;
  channel: number;
  band: number;       // 1 = 2.4 GHz, 2 = 5 GHz
  width: number;
  security: string;
  security_id: number;
  country: string | null;
  beacon_interval: number;
  oui: string;
  is_hidden: boolean;
};

type ScanResponse = {
  interface: string;
  current_ssid?: string | null;
  current_bssid?: string | null;
  networks: Network[];
  permission_hint: string | null;
};

function rssiBars(rssi: number): string {
  if (rssi > -50) return "▁▃▅▇";
  if (rssi > -65) return "▁▃▅ ";
  if (rssi > -75) return "▁▃  ";
  if (rssi > -85) return "▁   ";
  return "    ";
}

function bandLabel(b: number): string {
  if (b === 1) return "2.4";
  if (b === 2) return "5";
  if (b === 3) return "6";
  return "?";
}

function securityColor(sec: string): string {
  if (sec === "None") return "text-danger";
  if (sec.startsWith("WPA3")) return "text-phos";
  if (sec.startsWith("WPA2")) return "text-accent";
  if (sec.startsWith("WPA")) return "text-amber";
  if (sec === "WEP") return "text-danger";
  return "text-ink-muted";
}

export default function WifiScan() {
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const scanBtnRef = useRef<HTMLButtonElement | null>(null);

  async function scan(opts?: { withEffect?: boolean }) {
    setLoading(true); setError("");
    // Fire the user's chosen effect for this tool, anchored on the Rescan
    // button. Suppressed on the initial mount load + the silent auto-refresh
    // tick so the user only sees the effect when they pressed the button.
    if (opts?.withEffect) {
      void playNamed(getToolEffect("wifi"), scanBtnRef.current ?? undefined);
    }
    try {
      setResult(await api<ScanResponse>("/wifi-scan/scan"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void scan(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => void scan(), 5000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="flex items-center mb-3 gap-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">WIFI SCAN</h2>
        <span className="text-[11px] text-ink-dim">
          {result ? `${result.networks.length} networks on ${result.interface}` : ""}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer text-ink-muted">
          <input type="checkbox" checked={autoRefresh}
                 onChange={(e) => setAutoRefresh(e.target.checked)} />
          auto-refresh every 5s
        </label>
        <EffectPicker toolKey="wifi" />
        <button ref={scanBtnRef} onClick={() => scan({ withEffect: true })} disabled={loading}
                className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                           disabled:opacity-40">
          {loading ? "Scanning…" : "Rescan"}
        </button>
      </header>

      {error && <div className="text-[12px] text-danger mb-2">⚠ {error}</div>}

      {result?.permission_hint === "location-required" && (
        <div className="bg-amber/10 border border-amber/30 rounded p-3 mb-3 text-[12px]">
          <div className="text-amber font-bold mb-1">⚠ Location Services permission required</div>
          <p className="text-ink-muted">
            macOS Sequoia masks SSID/BSSID unless the app has Location access.
            Scan still runs (you can see signal strength and channels) but networks
            appear unnamed. To unmask:
          </p>
          <ol className="text-ink-muted list-decimal pl-5 mt-1 space-y-0.5">
            <li>Open <b>System Settings → Privacy &amp; Security → Location Services</b>.</li>
            <li>Find <b>HackingPal</b> in the list and enable it.</li>
            <li>Click Rescan above.</li>
          </ol>
        </div>
      )}

      {result?.current_ssid && (
        <div className="bg-bg-card border border-divider rounded p-3 mb-3 text-[12px]">
          <span className="text-[10px] text-ink-muted tracking-wider mr-2">CONNECTED:</span>
          <span className="text-accent font-mono">{result.current_ssid}</span>
          {result.current_bssid && <span className="text-ink-dim font-mono ml-2">({result.current_bssid})</span>}
        </div>
      )}

      {!result && !loading && !error && (
        <EmptyState
          icon="📡"
          title="WiFi scan"
          description="Enumerate visible 2.4 / 5 / 6 GHz networks with RSSI, channel, security."
          hint="Auto-refresh every 5s to watch RSSI shift."
        />
      )}

      {result && (
        <>
          <StatsBar
            total={result.networks.length}
            critical={result.networks.filter((n) => n.security === "None" || n.security === "WEP").length}
            medium={result.networks.filter((n) => n.security.startsWith("WPA") && !n.security.startsWith("WPA2") && !n.security.startsWith("WPA3")).length}
            extra={`interface: ${result.interface}`}
            className="mb-2"
          />
          <div className="bg-bg-card border border-divider rounded overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-bg-panel border-b border-divider text-ink-muted text-[10px] tracking-wider">
                <tr>
                  <th className="text-left px-3 py-1.5">SIGNAL</th>
                  <th className="text-left px-3 py-1.5">SSID</th>
                  <th className="text-left px-3 py-1.5">BSSID</th>
                  <th className="text-right px-3 py-1.5 w-12">RSSI</th>
                  <th className="text-right px-3 py-1.5 w-12">CH</th>
                  <th className="text-left px-3 py-1.5 w-12">BAND</th>
                  <th className="text-left px-3 py-1.5">SECURITY</th>
                  <th className="text-left px-3 py-1.5 w-12">CC</th>
                  <th className="px-3 py-1.5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {result.networks.map((n, i) => {
                  const insecure = n.security === "None" || n.security === "WEP";
                  const copyText = `${n.ssid ?? "(hidden)"} · ${n.bssid ?? "—"} · ${n.rssi}dBm · ch${n.channel} · ${bandLabel(n.band)}G · ${n.security}`;
                  return (
                    <tr
                      key={i}
                      style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                      className={"mhp-result-in group border-b border-divider hover:bg-bg-nav-hover " +
                                 (insecure ? "mhp-critical-pulse" : "")}
                    >
                      <td className="px-3 py-1 font-mono text-phos">{rssiBars(n.rssi)}</td>
                      <td className="px-3 py-1 font-mono text-ink-primary">
                        {n.ssid ?? <span className="text-ink-dim italic">(hidden)</span>}
                      </td>
                      <td className="px-3 py-1 font-mono text-ink-muted">{n.bssid ?? "—"}</td>
                      <td className="px-3 py-1 font-mono tabular-nums">{n.rssi}</td>
                      <td className="px-3 py-1 font-mono tabular-nums">{n.channel}</td>
                      <td className="px-3 py-1 text-ink-muted">{bandLabel(n.band)}G</td>
                      <td className={"px-3 py-1 " + securityColor(n.security)}>{n.security}</td>
                      <td className="px-3 py-1 text-ink-dim uppercase">{n.country ?? ""}</td>
                      <td className="px-3 py-1"><CopyButton text={copyText} /></td>
                    </tr>
                  );
                })}
                {result.networks.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-ink-dim italic">
                    No networks found.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
