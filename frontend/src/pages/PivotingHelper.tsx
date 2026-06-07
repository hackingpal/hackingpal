/**
 * Pivoting Helper — pure-frontend SSH/tunnel command builder.
 *
 * Five modes: local forward (-L), remote forward (-R), dynamic SOCKS (-D),
 * sshuttle (VPN-over-SSH), autossh (persistent reverse). Each renders the
 * command + an ASCII chain diagram so it's obvious which side is which.
 */
import { useState } from "react";
import CopyButton from "../components/CopyButton";

type Mode = "local" | "remote" | "socks" | "sshuttle" | "autossh";

const MODES: { id: Mode; label: string; description: string }[] = [
  { id: "local",    label: "SSH Local Forward (-L)",
    description: "Bind a local port on your machine, traffic sent to a remote host:port via SSH." },
  { id: "remote",   label: "SSH Remote Forward (-R)",
    description: "Bind a port on the remote SSH server, traffic sent back to a host:port on your side. Reverse tunnel." },
  { id: "socks",    label: "Dynamic SOCKS Proxy (-D)",
    description: "Start a local SOCKS proxy that tunnels via SSH. Point browsers / curl / proxychains at it." },
  { id: "sshuttle", label: "sshuttle (transparent VPN)",
    description: "Tunnels arbitrary TCP traffic for chosen subnets through an SSH connection. Acts like a poor-man's VPN." },
  { id: "autossh",  label: "autossh (persistent)",
    description: "Wrap any of the above in autossh for keep-alive + auto-reconnect. Good for long-lived reverse tunnels." },
];

export default function PivotingHelper() {
  const [mode, setMode] = useState<Mode>("local");

  // Common fields
  const [sshUser, setSshUser] = useState("ubuntu");
  const [sshHost, setSshHost] = useState("jump.example.com");
  const [sshPort, setSshPort] = useState(22);
  const [keyFile, setKeyFile] = useState("");

  // Local / Remote forward
  const [bindAddr, setBindAddr] = useState("127.0.0.1");
  const [bindPort, setBindPort] = useState(8080);
  const [targetHost, setTargetHost] = useState("internal.local");
  const [targetPort, setTargetPort] = useState(8080);

  // SOCKS
  const [socksPort, setSocksPort] = useState(1080);

  // sshuttle
  const [subnets, setSubnets] = useState("10.0.0.0/8 192.168.0.0/16");

  // autossh inner mode
  const [autosshInner, setAutosshInner] = useState<Mode>("remote");

  const cmd = buildCommand({
    mode, sshUser, sshHost, sshPort, keyFile,
    bindAddr, bindPort, targetHost, targetPort,
    socksPort, subnets, autosshInner,
  });

  const diagram = buildDiagram({
    mode, sshUser, sshHost,
    bindAddr, bindPort, targetHost, targetPort, socksPort,
    subnets, autosshInner,
  });

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">PIVOTING HELPER</h2>
        <p className="text-[11px] text-ink-dim">
          Build SSH tunnel / SOCKS / sshuttle commands without remembering the flag-soup.
          Everything happens client-side — copy the result to your terminal.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 mb-4">
        {MODES.map((m) => (
          <button key={m.id} onClick={() => setMode(m.id)}
                  className={
                    "px-3 py-1.5 rounded text-[12px] uppercase tracking-wider " +
                    (mode === m.id
                      ? "bg-accent text-white font-bold"
                      : "bg-bg-base border border-divider text-ink-primary hover:bg-bg-nav-hover")
                  }>
            {m.label}
          </button>
        ))}
      </div>

      <div className="text-[11px] text-ink-muted italic mb-4">
        {MODES.find((m) => m.id === mode)?.description}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Left: form */}
        <div className="bg-bg-card border border-divider rounded p-3 space-y-3">
          <div>
            <div className="text-[10px] text-ink-muted tracking-wider mb-1">SSH JUMP HOST</div>
            <div className="grid grid-cols-3 gap-2">
              <input value={sshUser} onChange={(e) => setSshUser(e.target.value)}
                     placeholder="user"
                     className="bg-bg-base border border-divider rounded px-2 py-1
                                text-[12px] font-mono focus:outline-none focus:border-accent" />
              <input value={sshHost} onChange={(e) => setSshHost(e.target.value)}
                     placeholder="host"
                     className="col-span-2 bg-bg-base border border-divider rounded px-2 py-1
                                text-[12px] font-mono focus:outline-none focus:border-accent" />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input type="number" value={sshPort}
                     onChange={(e) => setSshPort(parseInt(e.target.value) || 22)}
                     placeholder="port"
                     className="bg-bg-base border border-divider rounded px-2 py-1
                                text-[12px] font-mono focus:outline-none focus:border-accent" />
              <input value={keyFile} onChange={(e) => setKeyFile(e.target.value)}
                     placeholder="-i ~/.ssh/id_rsa (optional)"
                     className="bg-bg-base border border-divider rounded px-2 py-1
                                text-[12px] font-mono focus:outline-none focus:border-accent" />
            </div>
          </div>

          {(mode === "local" || mode === "remote") && (
            <>
              <div>
                <div className="text-[10px] text-ink-muted tracking-wider mb-1">
                  {mode === "local" ? "BIND (LOCAL SIDE)" : "BIND (REMOTE SIDE)"}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={bindAddr} onChange={(e) => setBindAddr(e.target.value)}
                         className="bg-bg-base border border-divider rounded px-2 py-1
                                    text-[12px] font-mono focus:outline-none focus:border-accent" />
                  <input type="number" value={bindPort}
                         onChange={(e) => setBindPort(parseInt(e.target.value) || 0)}
                         className="bg-bg-base border border-divider rounded px-2 py-1
                                    text-[12px] font-mono focus:outline-none focus:border-accent" />
                </div>
              </div>
              <div>
                <div className="text-[10px] text-ink-muted tracking-wider mb-1">
                  {mode === "local" ? "TARGET (REACHABLE FROM REMOTE)" : "TARGET (REACHABLE FROM LOCAL)"}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={targetHost} onChange={(e) => setTargetHost(e.target.value)}
                         className="bg-bg-base border border-divider rounded px-2 py-1
                                    text-[12px] font-mono focus:outline-none focus:border-accent" />
                  <input type="number" value={targetPort}
                         onChange={(e) => setTargetPort(parseInt(e.target.value) || 0)}
                         className="bg-bg-base border border-divider rounded px-2 py-1
                                    text-[12px] font-mono focus:outline-none focus:border-accent" />
                </div>
              </div>
            </>
          )}

          {mode === "socks" && (
            <div>
              <div className="text-[10px] text-ink-muted tracking-wider mb-1">
                LOCAL SOCKS PORT
              </div>
              <input type="number" value={socksPort}
                     onChange={(e) => setSocksPort(parseInt(e.target.value) || 1080)}
                     className="w-32 bg-bg-base border border-divider rounded px-2 py-1
                                text-[12px] font-mono focus:outline-none focus:border-accent" />
            </div>
          )}

          {mode === "sshuttle" && (
            <div>
              <div className="text-[10px] text-ink-muted tracking-wider mb-1">
                SUBNETS (space-separated CIDRs)
              </div>
              <input value={subnets} onChange={(e) => setSubnets(e.target.value)}
                     className="w-full bg-bg-base border border-divider rounded px-2 py-1
                                text-[12px] font-mono focus:outline-none focus:border-accent" />
            </div>
          )}

          {mode === "autossh" && (
            <div>
              <div className="text-[10px] text-ink-muted tracking-wider mb-1">
                INNER TUNNEL TYPE
              </div>
              <select value={autosshInner}
                      onChange={(e) => setAutosshInner(e.target.value as Mode)}
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1
                                 text-[12px] focus:outline-none focus:border-accent">
                <option value="local">Local Forward (-L)</option>
                <option value="remote">Remote Forward (-R)</option>
                <option value="socks">Dynamic SOCKS (-D)</option>
              </select>
              {autosshInner === "local" || autosshInner === "remote" ? (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input value={bindAddr} onChange={(e) => setBindAddr(e.target.value)}
                         className="bg-bg-base border border-divider rounded px-2 py-1
                                    text-[12px] font-mono focus:outline-none focus:border-accent"
                         placeholder="bind-addr" />
                  <input type="number" value={bindPort}
                         onChange={(e) => setBindPort(parseInt(e.target.value) || 0)}
                         className="bg-bg-base border border-divider rounded px-2 py-1
                                    text-[12px] font-mono focus:outline-none focus:border-accent"
                         placeholder="bind-port" />
                  <input value={targetHost} onChange={(e) => setTargetHost(e.target.value)}
                         className="bg-bg-base border border-divider rounded px-2 py-1
                                    text-[12px] font-mono focus:outline-none focus:border-accent"
                         placeholder="target-host" />
                  <input type="number" value={targetPort}
                         onChange={(e) => setTargetPort(parseInt(e.target.value) || 0)}
                         className="bg-bg-base border border-divider rounded px-2 py-1
                                    text-[12px] font-mono focus:outline-none focus:border-accent"
                         placeholder="target-port" />
                </div>
              ) : (
                <input type="number" value={socksPort}
                       onChange={(e) => setSocksPort(parseInt(e.target.value) || 1080)}
                       placeholder="socks-port"
                       className="mt-2 w-32 bg-bg-base border border-divider rounded px-2 py-1
                                  text-[12px] font-mono focus:outline-none focus:border-accent" />
              )}
            </div>
          )}
        </div>

        {/* Right: command + diagram */}
        <div className="space-y-3">
          <div className="bg-bg-card border border-divider rounded p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] text-ink-muted tracking-wider">COMMAND</div>
              <CopyButton text={cmd} label="Copy" alwaysVisible />
            </div>
            <pre className="text-[12px] font-mono text-phos whitespace-pre-wrap break-all">
              {cmd}
            </pre>
          </div>

          <div className="bg-bg-card border border-divider rounded p-3">
            <div className="text-[10px] text-ink-muted tracking-wider mb-2">DIAGRAM</div>
            <pre className="text-[11px] font-mono text-ink-primary whitespace-pre">
              {diagram}
            </pre>
          </div>
        </div>
      </div>

      {/* Tips */}
      <details className="bg-bg-card border border-divider rounded p-3 text-[11px] text-ink-muted">
        <summary className="cursor-pointer text-ink-primary">Common pitfalls</summary>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li><b>Remote-forward bind on all interfaces:</b> needs <code>GatewayPorts yes</code> in the server's sshd_config; otherwise binds to 127.0.0.1 even if you specify 0.0.0.0.</li>
          <li><b>Add <code>-N -f</code></b> to run in the background and skip remote shell. Combined with <code>-q</code> to silence motd.</li>
          <li><b>Multi-hop:</b> chain with <code>ProxyJump</code> (<code>-J user1@host1,user2@host2</code>) — much simpler than nested <code>ssh ssh</code>.</li>
          <li><b>autossh keepalive:</b> set <code>AUTOSSH_GATETIME=0</code> + <code>AUTOSSH_POLL=60</code> for short reconnect windows.</li>
        </ul>
      </details>
    </div>
  );
}

// ── Command builder ────────────────────────────────────────────────────────

function buildCommand(p: {
  mode: Mode; sshUser: string; sshHost: string; sshPort: number; keyFile: string;
  bindAddr: string; bindPort: number; targetHost: string; targetPort: number;
  socksPort: number; subnets: string; autosshInner: Mode;
}): string {
  const sshTarget = `${p.sshUser}@${p.sshHost}`;
  const port = p.sshPort !== 22 ? ` -p ${p.sshPort}` : "";
  const key = p.keyFile.trim() ? ` -i ${p.keyFile.trim()}` : "";
  const common = `${key}${port}`;

  switch (p.mode) {
    case "local":
      return `ssh -N -L ${p.bindAddr}:${p.bindPort}:${p.targetHost}:${p.targetPort}${common} ${sshTarget}`;
    case "remote":
      return `ssh -N -R ${p.bindAddr}:${p.bindPort}:${p.targetHost}:${p.targetPort}${common} ${sshTarget}`;
    case "socks":
      return `ssh -N -D ${p.socksPort}${common} ${sshTarget}\n\n` +
             `# Then use:\n# curl --proxy socks5h://127.0.0.1:${p.socksPort} https://example.internal/\n` +
             `# Or set browser proxy → SOCKS5 → 127.0.0.1:${p.socksPort}`;
    case "sshuttle":
      return `sshuttle -r ${sshTarget}${common.replace(" -p ", ":")} ${p.subnets}`;
    case "autossh": {
      const inner =
        p.autosshInner === "local"
          ? `-L ${p.bindAddr}:${p.bindPort}:${p.targetHost}:${p.targetPort}`
        : p.autosshInner === "remote"
          ? `-R ${p.bindAddr}:${p.bindPort}:${p.targetHost}:${p.targetPort}`
          : `-D ${p.socksPort}`;
      return `AUTOSSH_GATETIME=0 autossh -M 0 -N ${inner}` +
             ` -o "ServerAliveInterval=30" -o "ServerAliveCountMax=3"${common} ${sshTarget}`;
    }
  }
}

// ── ASCII diagram ──────────────────────────────────────────────────────────

function buildDiagram(p: {
  mode: Mode; sshUser: string; sshHost: string;
  bindAddr: string; bindPort: number; targetHost: string; targetPort: number;
  socksPort: number; subnets: string; autosshInner: Mode;
}): string {
  const ssh = `${p.sshUser}@${p.sshHost}`;
  const target = `${p.targetHost}:${p.targetPort}`;

  switch (p.mode) {
    case "local":
      return [
        `   [you]                 [jump]                [target]`,
        `   ─────                 ───────               ───────`,
        ` ${p.bindAddr}:${p.bindPort}  →→  ssh tunnel  →→  ${ssh}  →→  ${target}`,
        ``,
        `Local clients hit ${p.bindAddr}:${p.bindPort}; SSH ferries the bytes to ${target}.`,
      ].join("\n");
    case "remote":
      return [
        `   [you]                 [jump]                [your-side]`,
        `   ─────                 ───────               ──────────`,
        ` ${target}  ←←  ssh tunnel  ←←  ${ssh}  ←←  ${p.bindAddr}:${p.bindPort}`,
        ``,
        `Clients on the jump host hit ${p.bindAddr}:${p.bindPort} *there*; SSH ferries those`,
        `bytes back to your machine, which forwards on to ${target}.`,
      ].join("\n");
    case "socks":
      return [
        `   [you]                 [jump]                [internet/internal]`,
        `   ─────                 ───────               ───────────────────`,
        ` 127.0.0.1:${p.socksPort}  →→  ssh -D  →→  ${ssh}  →→  any TCP`,
        ``,
        `Browser/curl points at SOCKS5 ${`127.0.0.1`}:${p.socksPort}.`,
        `Every DNS+TCP request is resolved & connected on ${p.sshHost}'s side.`,
      ].join("\n");
    case "sshuttle":
      return [
        `   [you]                 [jump]                [internal nets]`,
        `   ─────                 ───────               ──────────────`,
        ` <all TCP>  →→  ssh tunnel  →→  ${ssh}  →→  ${p.subnets}`,
        ``,
        `sshuttle hijacks routes for the listed subnets and tunnels them over SSH.`,
        `Acts as a VPN without needing root on the remote side (uses pf/iptables locally).`,
      ].join("\n");
    case "autossh":
      return [
        `Same as the inner tunnel (${p.autosshInner}), but wrapped in autossh:`,
        ``,
        `   autossh ──monitors──→ ssh ──tunnel──→ ${ssh}`,
        `                │`,
        `                └─ reconnects automatically if SSH drops`,
        ``,
        `Survives flaky networks; good for long-running reverse callbacks.`,
      ].join("\n");
  }
}
