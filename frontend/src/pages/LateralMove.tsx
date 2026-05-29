import { useEffect, useState } from "react";
import AuthorizationGate from "../components/AuthorizationGate";
import { api, authFetch, isApiError } from "../api";

type Stats = { nodes: number; edges: number; by_kind: Record<string, number> };

type Node = { id: string; name: string; kind: string; edge?: string };
type Path = Node[];

type PathResp = {
  source: Node;
  targets: Node[];
  paths: Path[];
};

type Technique = {
  edge: string; name: string; summary: string; cmd?: string;
};

export default function LateralMove() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [maxHops, setMaxHops] = useState(6);
  const [pathResult, setPathResult] = useState<PathResp | null>(null);
  const [pathError, setPathError] = useState("");
  const [uploadTimedOut, setUploadTimedOut] = useState(false);
  const [pathTimedOut, setPathTimedOut] = useState(false);

  const [techniques, setTechniques] = useState<Technique[]>([]);
  const [authorized, setAuthorized] = useState(false);

  async function refresh() {
    try {
      const r = await api<{ loaded: boolean; stats: Stats }>("/lateral/status");
      setStats(r.stats);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    void refresh();
    api<{ techniques: Technique[] }>("/lateral/techniques")
      .then((r) => setTechniques(r.techniques)).catch(() => {});
  }, []);

  async function upload(file: File) {
    setUploading(true); setError(""); setUploadTimedOut(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("confirm_auth", "true");
      await api("/lateral/load", { method: "POST", body: fd });
      await refresh();
    } catch (e) {
      if (isApiError(e, "TIMEOUT")) setUploadTimedOut(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally { setUploading(false); }
  }

  async function findPath() {
    setLoading(true); setPathError(""); setPathTimedOut(false); setPathResult(null);
    try {
      const result = await api<PathResp>("/lateral/path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, target, max_hops: maxHops, confirm_auth: true }),
      });
      setPathResult(result);
    } catch (e) {
      if (isApiError(e, "TIMEOUT")) setPathTimedOut(true);
      else setPathError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  async function clearGraph() {
    if (!confirm("Clear loaded BloodHound data?")) return;
    await authFetch(`/lateral/clear`, { method: "POST" });
    setPathResult(null);
    await refresh();
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">LATERAL MOVEMENT PLANNER</h2>
        <p className="text-[11px] text-ink-dim">
          Upload a BloodHound ZIP (or individual JSON), build an in-memory graph,
          and find shortest attack paths via BFS. No Neo4j needed.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 mb-4">
        <AuthorizationGate
          authorized={authorized} setAuthorized={setAuthorized}
          toolName="lateral-movement analysis"
          disabled={uploading || loading}
        />
      </div>

      {/* Loaded state */}
      <div className="bg-bg-card border border-divider rounded p-3 mb-4">
        {stats && stats.nodes > 0 ? (
          <div className="flex items-center gap-4 text-[12px]">
            <span className="text-phos font-bold">✓ Loaded</span>
            <span className="text-ink-primary">
              {stats.nodes} nodes · {stats.edges} edges
            </span>
            <span className="text-[10px] text-ink-dim">
              {Object.entries(stats.by_kind).map(([k, v]) => `${k}=${v}`).join(", ")}
            </span>
            <button onClick={clearGraph}
                    className="ml-auto px-2 py-0.5 rounded border border-danger text-danger text-[11px]">
              Clear
            </button>
          </div>
        ) : (
          <div className="text-[12px] text-ink-dim italic">
            No graph loaded. Upload a BloodHound ZIP to begin.
          </div>
        )}
      </div>

      {/* Upload */}
      <div className="bg-bg-card border border-divider rounded p-3 mb-4">
        <div className="text-[11px] text-ink-muted tracking-wider mb-2">UPLOAD BLOODHOUND DATA</div>
        <input type="file" accept=".zip,.json"
               onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
               disabled={uploading || !authorized}
               className="block w-full text-[11px] text-ink-muted
                          file:mr-3 file:py-1 file:px-2 file:border file:border-divider
                          file:bg-bg-base file:text-accent file:rounded
                          file:cursor-pointer" />
        {uploading && <div className="text-[11px] text-ink-dim mt-1">Uploading…</div>}
        {uploadTimedOut && (
          <div className="text-[11px] text-amber mt-1">
            ⏱ Upload timed out — retry, or check connectivity.
          </div>
        )}
        {error && !uploadTimedOut && <div className="text-[11px] text-danger mt-1">⚠ {error}</div>}
        <p className="text-[10px] text-ink-dim mt-1">
          Accepts the ZIP produced by the BloodHound Ingestor, or individual
          <code className="text-amber"> *_users.json</code> / <code className="text-amber">*_groups.json</code> / etc.
        </p>
      </div>

      {/* Path query */}
      {stats && stats.nodes > 0 && (
        <div className="bg-bg-card border border-divider rounded p-3 mb-4">
          <div className="text-[11px] text-ink-muted tracking-wider mb-2">FIND ATTACK PATH</div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-[11px] text-ink-muted tracking-wider mb-1">SOURCE (principal)</label>
              <input value={source} onChange={(e) => setSource(e.target.value)}
                     placeholder="ALICE@CORP.LOCAL"
                     className="w-full bg-bg-base border border-divider rounded px-2 py-1
                                text-[12px] font-mono focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
                TARGET (empty = any Domain Admins-like group)
              </label>
              <input value={target} onChange={(e) => setTarget(e.target.value)}
                     placeholder="(any)"
                     className="w-full bg-bg-base border border-divider rounded px-2 py-1
                                text-[12px] font-mono focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block text-[11px] text-ink-muted tracking-wider mb-1">MAX HOPS</label>
              <input type="number" min={1} max={10} value={maxHops}
                     onChange={(e) => setMaxHops(parseInt(e.target.value) || 6)}
                     className="w-20 bg-bg-base border border-divider rounded px-2 py-1
                                text-[12px] font-mono focus:outline-none focus:border-accent" />
            </div>
          </div>
          <button onClick={findPath} disabled={loading || !source.trim() || !authorized}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? "Searching…" : "Find Path"}
          </button>
          {pathTimedOut && (
            <span className="text-[11px] text-amber ml-2">⏱ Search timed out — retry.</span>
          )}
          {pathError && !pathTimedOut && <span className="text-[11px] text-danger ml-2">⚠ {pathError}</span>}
        </div>
      )}

      {/* Results */}
      {pathResult && (
        <div className="mb-4">
          <div className="text-[11px] text-ink-muted tracking-wider mb-2">
            FROM <span className="text-accent font-mono">{pathResult.source.name}</span>
            {" → "}
            {pathResult.targets.map((t) => t.name).join(", ")}
            <span className="ml-3 text-ink-dim">{pathResult.paths.length} path(s)</span>
          </div>
          {pathResult.paths.length === 0 && (
            <div className="text-[12px] text-ink-dim italic">
              No path found within {maxHops} hops.
            </div>
          )}
          <div className="space-y-3">
            {pathResult.paths.map((p, i) => (
              <div key={i} className="border border-divider rounded p-3 bg-bg-card">
                <div className="text-[10px] text-ink-muted tracking-wider mb-2">
                  PATH #{i + 1} · {p.length - 1} hop(s)
                </div>
                <div className="space-y-1">
                  {p.map((node, j) => (
                    <div key={j} className="flex items-center gap-3 text-[12px]">
                      {j > 0 && (
                        <span className="text-amber font-mono text-[10px] uppercase
                                         border border-amber/40 rounded px-1.5 py-0.5">
                          {node.edge}
                        </span>
                      )}
                      <span className={
                        node.kind === "User" ? "text-accent"
                        : node.kind === "Group" ? "text-amber"
                        : node.kind === "Computer" ? "text-phos"
                        : "text-ink-primary"
                      }>{node.name}</span>
                      <span className="text-[10px] text-ink-dim">{node.kind}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Technique reference */}
      <details>
        <summary className="text-[11px] text-ink-muted tracking-wider cursor-pointer hover:text-ink-primary">
          ATTACK TECHNIQUES REFERENCE ({techniques.length})
        </summary>
        <div className="mt-2 space-y-2">
          {techniques.map((t) => (
            <div key={t.edge} className="border border-divider rounded p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-amber text-[10px] uppercase
                                 border border-amber/40 rounded px-1.5">
                  {t.edge}
                </span>
                <span className="text-[12px] text-ink-primary font-bold">{t.name}</span>
              </div>
              <div className="text-[12px] text-ink-muted">{t.summary}</div>
              {t.cmd && (
                <pre className="bg-bg-panel border border-divider rounded p-1.5 mt-1
                                text-[11px] font-mono text-phos">
                  {t.cmd}
                </pre>
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
