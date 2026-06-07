import { useEffect, useState } from "react";
import { api } from "../api";
import AuthorizationGate from "../components/AuthorizationGate";
import { useAttackWS } from "../components/webattack/useAttackWS";
import EmptyState from "../components/EmptyState";
import CopyButton from "../components/CopyButton";

type Tool = { installed: boolean; path: string; description: string };
type Iface = { device: string; name: string; mac: string; is_wifi: boolean; is_usb: boolean };
type StatusResp = {
  tools: Record<string, Tool>;
  interfaces: Iface[];
  macos_note: string;
};

type RunEvent =
  | { type: "started"; cmd: string[] }
  | { type: "line"; text: string }
  | { type: "done"; rc: number; stopped: boolean }
  | { type: "error"; detail: string };

const PRESETS: { label: string; argv: string[]; description: string }[] = [
  {
    label: "airodump — scan all",
    argv: ["airodump-ng", "wlan0mon"],
    description: "List nearby networks and clients. Needs `wlan0mon` (monitor-mode iface).",
  },
  {
    label: "airodump — capture handshake",
    argv: ["airodump-ng", "-c", "6", "--bssid", "AA:BB:CC:DD:EE:FF", "-w", "/tmp/handshake", "wlan0mon"],
    description: "Capture a specific BSSID on channel 6 to /tmp/handshake-*.cap. Edit args first.",
  },
  {
    label: "aireplay — deauth (trigger reconnect)",
    argv: ["aireplay-ng", "-0", "5", "-a", "AA:BB:CC:DD:EE:FF", "wlan0mon"],
    description: "Send 5 deauth frames to force a client reconnect (handshake will follow).",
  },
  {
    label: "hcxdumptool — PMKID",
    argv: ["hcxdumptool", "-i", "wlan0mon", "-o", "/tmp/pmkid.pcapng", "--enable_status=1"],
    description: "Capture PMKID without needing a connected client.",
  },
  {
    label: "hcxpcapngtool — convert capture",
    argv: ["hcxpcapngtool", "-o", "/tmp/handshake.22000", "/tmp/handshake-01.cap"],
    description: "Convert .pcap/.cap to hashcat mode 22000 format.",
  },
  {
    label: "aircrack-ng — crack from wordlist",
    argv: ["aircrack-ng", "-w", "/usr/share/wordlists/rockyou.txt", "/tmp/handshake-01.cap"],
    description: "Try to crack a captured handshake from a wordlist.",
  },
];

export default function WpaCapture() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [args, setArgs] = useState<string>(PRESETS[0].argv.join(" "));
  const [lines, setLines] = useState<string[]>([]);
  const [doneText, setDoneText] = useState("");
  const [authorized, setAuthorized] = useState(false);

  const { status: wsStatus, error, start, stop } = useAttackWS<RunEvent>(
    "/wpa-capture/ws/run",
    (ev) => {
      if (ev.type === "started") { setLines([`$ ${ev.cmd.join(" ")}`]); setDoneText(""); }
      else if (ev.type === "line") setLines((l) => l.slice(-1000).concat(ev.text));
      else if (ev.type === "done") setDoneText(`exit code ${ev.rc}${ev.stopped ? " (stopped)" : ""}`);
    },
    "/wpa-capture/run",
  );

  const running = wsStatus === "connecting" || wsStatus === "running";

  useEffect(() => {
    api<StatusResp>("/wpa-capture/status").then(setStatus).catch(() => {});
  }, []);

  function go() {
    const argv = args.trim().split(/\s+/).filter(Boolean);
    if (argv.length) start({ argv, confirm_auth: true });
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">
          WPA HANDSHAKE / PMKID
        </h2>
        <p className="text-[11px] text-ink-dim">
          Wrapper around aircrack-ng / hcxdumptool. macOS doesn't expose
          monitor mode on the built-in WiFi card — for real captures you'll
          want an external adapter on Kali Linux.
        </p>
      </header>

      {status?.macos_note && (
        <div className="bg-amber/10 border border-amber/30 rounded p-2 mb-3 text-[11px] text-ink-muted">
          {status.macos_note}
        </div>
      )}

      {/* Tool status */}
      {status && (
        <div className="bg-bg-card border border-divider rounded p-3 mb-3">
          <div className="text-[10px] text-ink-muted tracking-wider mb-2">TOOL DETECTION</div>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            {Object.entries(status.tools).map(([name, t]) => (
              <div key={name} className="flex items-start gap-2">
                <span className={"font-mono w-3 " + (t.installed ? "text-phos" : "text-danger")}>
                  {t.installed ? "✓" : "✗"}
                </span>
                <div className="flex-1">
                  <span className="font-mono text-ink-primary">{name}</span>
                  {t.installed && <span className="text-ink-dim text-[10px] ml-2">{t.path}</span>}
                  <div className="text-ink-dim text-[10px]">{t.description}</div>
                </div>
              </div>
            ))}
          </div>
          <details className="mt-2 text-[11px]">
            <summary className="text-ink-muted cursor-pointer">Install missing tools</summary>
            <pre className="bg-bg-base border border-divider rounded p-2 mt-1 text-[11px] text-phos">
{`brew install aircrack-ng hcxdumptool hcxtools hashcat`}
            </pre>
          </details>
        </div>
      )}

      {/* Interfaces */}
      {status && status.interfaces.length > 0 && (
        <div className="bg-bg-card border border-divider rounded p-3 mb-3">
          <div className="text-[10px] text-ink-muted tracking-wider mb-2">INTERFACES</div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {status.interfaces.map((iface) => (
              <div key={iface.device} className="flex items-center gap-2">
                <span className={"inline-block w-1.5 h-1.5 rounded-full " +
                  (iface.is_usb ? "bg-phos" : iface.is_wifi ? "bg-amber" : "bg-ink-dim")} />
                <span className="font-mono text-ink-primary">{iface.device}</span>
                <span className="text-ink-muted text-[10px]">{iface.name}</span>
                {iface.is_usb && <span className="text-phos text-[10px]">USB</span>}
                {iface.is_wifi && !iface.is_usb && <span className="text-amber text-[10px]">internal</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Command runner */}
      <div className="bg-bg-card border border-divider rounded p-3 mb-3 space-y-2">
        <div className="text-[10px] text-ink-muted tracking-wider">PRESET</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.label}
                    onClick={() => setArgs(p.argv.join(" "))}
                    title={p.description}
                    className="text-[10px] px-2 py-0.5 rounded bg-bg-base border border-divider
                               text-ink-muted hover:text-ink-primary hover:border-accent">
              {p.label}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-[10px] text-ink-muted tracking-wider mb-1">COMMAND</label>
          <textarea value={args} onChange={(e) => setArgs(e.target.value)}
                    rows={2} disabled={running}
                    className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                               text-[12px] font-mono focus:outline-none focus:border-accent" />
        </div>

        <AuthorizationGate authorized={authorized} setAuthorized={setAuthorized}
                           toolName="WPA capture / deauth" disabled={running} />
        <div className="flex items-center gap-2">
          {!running ? (
            <button onClick={go} disabled={!args.trim() || !authorized}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              Run
            </button>
          ) : (
            <button onClick={stop}
                    className="px-3 py-1.5 rounded bg-bg-base border border-danger text-danger text-[12px]">
              Stop
            </button>
          )}
          {doneText && <span className="text-[11px] text-ink-dim">{doneText}</span>}
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      {/* Output */}
      {lines.length === 0 && !running && !error && (
        <EmptyState
          icon="🛜"
          title="WPA capture / PMKID"
          description="Wrapper around aircrack-ng / hcxdumptool. Run a preset above, or edit the command."
          hint="macOS doesn't expose monitor mode on internal WiFi — use an external USB adapter on Linux."
        />
      )}
      {lines.length > 0 && (
        <div className="bg-bg-panel border border-divider rounded">
          <div className="flex items-center gap-2 px-2 py-1 border-b border-divider">
            <span className="text-[10px] text-ink-muted tracking-wider">OUTPUT</span>
            <CopyButton text={lines.join("\n")} label="Copy log" alwaysVisible className="ml-auto" />
          </div>
          <pre className="p-2 text-[11px] font-mono text-phos whitespace-pre-wrap max-h-96 overflow-y-auto">
            {lines.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}
