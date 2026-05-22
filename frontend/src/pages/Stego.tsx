import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeStego, embedStego, extractStego,
  fetchStegoCapacity, stripStegoMetadata,
  type StegoAnalyzeResp, type StegoCapacity, type StegoEmbedResult,
  type StegoExtractResp,
} from "../api";

type Mode = "embed" | "extract" | "analyze";

const SEV: Record<string, { dot: string; text: string; bg: string }> = {
  clean: { dot: "bg-phos",   text: "text-phos",   bg: "bg-phos/10 border-phos/40" },
  warn:  { dot: "bg-amber",  text: "text-amber",  bg: "bg-amber/10 border-amber/40" },
  high:  { dot: "bg-danger", text: "text-danger", bg: "bg-danger/10 border-danger/40" },
};

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function Stego() {
  const [mode, setMode] = useState<Mode>("embed");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Forensics</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Steganography
            </h2>
          </div>
          <div className="flex-1 text-[11px] text-ink-muted leading-relaxed">
            Hide / extract data in PNG, BMP, WAV via LSB. Detect via chi-square + appended-data + EXIF.
          </div>
          <ModeToggle mode={mode} setMode={setMode} />
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4 border border-danger/40 bg-danger/10 text-danger
                        rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
      )}

      <main className="flex-1 overflow-auto p-6">
        {mode === "embed"   && <EmbedTab   onError={setError} />}
        {mode === "extract" && <ExtractTab onError={setError} />}
        {mode === "analyze" && <AnalyzeTab onError={setError} />}
      </main>
    </div>
  );
}


// ── EMBED ────────────────────────────────────────────────────────────────────

function EmbedTab({ onError }: { onError: (e: string | null) => void }) {
  const [carrier, setCarrier] = useState<File | null>(null);
  const [capacity, setCapacity] = useState<StegoCapacity | null>(null);
  const [payloadKind, setPayloadKind] = useState<"text" | "file">("text");
  const [payloadText, setPayloadText] = useState("");
  const [payloadFile, setPayloadFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [compress, setCompress] = useState(true);
  const [keepFilename, setKeepFilename] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StegoEmbedResult | null>(null);
  const downloadUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
  }, []);

  async function onCarrierChange(f: File | null) {
    setCarrier(f); setCapacity(null); setResult(null); onError(null);
    if (!f) return;
    try { setCapacity(await fetchStegoCapacity(f)); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  }

  const payloadSize = payloadKind === "text"
    ? new Blob([payloadText]).size
    : payloadFile?.size ?? 0;

  const overheadEstimate = useMemo(() => {
    let n = 12;                    // header
    if (keepFilename && payloadKind === "file") n += 1 + 255;
    if (password) n += 16 + 12 + 16; // salt + nonce + gcm tag
    return n;
  }, [keepFilename, payloadKind, password]);

  const fits = capacity
    ? payloadSize + overheadEstimate <= capacity.capacity_bytes_raw
    : true;

  async function run() {
    if (!carrier) { onError("Choose a carrier file first."); return; }
    onError(null); setBusy(true); setResult(null);
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = null;
    }
    try {
      const r = await embedStego({
        carrier,
        payloadText:  payloadKind === "text" ? payloadText : undefined,
        payloadFile:  payloadKind === "file" ? payloadFile ?? undefined : undefined,
        password:     password || undefined,
        compress,
        keepFilename,
      });
      setResult(r);
      downloadUrlRef.current = URL.createObjectURL(r.blob);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const canRun = !!carrier && !busy && fits &&
    (payloadKind === "text" ? payloadText.length > 0 : !!payloadFile);

  return (
    <div className="space-y-4 max-w-3xl">
      <Card title="Carrier image / audio">
        <FilePicker
          accept=".png,.bmp,.wav,image/png,image/bmp,audio/wav"
          file={carrier}
          onPick={onCarrierChange}
          hint="PNG, BMP, or WAV. JPEG can't carry LSB payloads — use it on the Analyze tab."
        />
        {capacity && (
          <div className="mt-2 grid grid-cols-3 gap-3 text-[11px]">
            <KV k="Format" v={capacity.format.toUpperCase()} />
            {capacity.width != null && <KV k="Dimensions" v={`${capacity.width} × ${capacity.height} (${capacity.mode})`} />}
            {capacity.frame_rate != null && <KV k="Audio" v={`${capacity.frame_rate} Hz · ${capacity.channels}ch · ${capacity.sample_width_bytes}B`} />}
            <KV k="Capacity" v={`${humanBytes(capacity.capacity_bytes_raw)} (raw)`} />
          </div>
        )}
      </Card>

      <Card title="Payload">
        <div className="flex gap-1 mb-2 text-[10px] tracking-widest">
          {(["text", "file"] as const).map((k) => (
            <button key={k} onClick={() => setPayloadKind(k)}
              className={
                "px-2.5 py-1 rounded border " +
                (payloadKind === k
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-divider text-ink-muted hover:text-ink-primary")
              }>{k.toUpperCase()}</button>
          ))}
        </div>

        {payloadKind === "text" ? (
          <textarea value={payloadText} onChange={(e) => setPayloadText(e.target.value)}
            rows={5} placeholder="Secret message…"
            spellCheck={false}
            className="w-full bg-bg-base border border-divider rounded
                       px-2 py-1.5 text-[11px] font-mono text-ink-primary placeholder:text-ink-dim
                       focus:outline-none focus:border-accent resize-y" />
        ) : (
          <FilePicker file={payloadFile} onPick={(f) => { setPayloadFile(f); onError(null); }}
            hint="Any file — image, document, archive. Will be zipped + AES-encrypted if you enable those options." />
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">
              Password (optional → AES-GCM)
            </div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="leave blank for plaintext"
              className="w-full bg-bg-base border border-divider rounded
                         px-2 py-1.5 text-[11px] font-mono text-ink-primary placeholder:text-ink-dim
                         focus:outline-none focus:border-accent" />
          </label>
          <div className="flex items-end gap-3 text-[11px]">
            <Toggle on={compress} setOn={setCompress} label="Compress (zlib)" />
            {payloadKind === "file" &&
              <Toggle on={keepFilename} setOn={setKeepFilename} label="Keep filename" />}
          </div>
        </div>
      </Card>

      <div className="rounded-md border border-divider bg-bg-card p-3 flex items-center gap-4">
        <div className="flex-1 text-[11px] font-mono">
          <div>Payload: <span className="text-ink-primary">{humanBytes(payloadSize)}</span>
            <span className="text-ink-dim"> + {overheadEstimate} B overhead</span></div>
          {capacity && (
            <div className={fits ? "text-phos" : "text-danger"}>
              {fits
                ? `Fits — ${Math.round((payloadSize + overheadEstimate) / capacity.capacity_bytes_raw * 100)}% of capacity used`
                : `Too large — exceeds capacity by ${humanBytes(payloadSize + overheadEstimate - capacity.capacity_bytes_raw)}`}
            </div>
          )}
        </div>
        <button onClick={run} disabled={!canRun}
          className="bg-accent hover:bg-accentDim active:translate-y-px
                     text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                     disabled:opacity-50 border border-accent/60">
          {busy ? "Embedding…" : "▶ Embed"}
        </button>
      </div>

      {result && downloadUrlRef.current && (
        <Card title="Stego file ready">
          <div className="text-[11px] space-y-1.5">
            <div>Payload: <span className="text-ink-primary">{result.payloadBytes} B</span> → Container: <span className="text-ink-primary">{result.containerBytes} B</span></div>
            <a href={downloadUrlRef.current} download={result.filename}
              className="inline-block mt-1 bg-phos/15 hover:bg-phos/25 text-phos border border-phos/40
                         text-xs font-bold tracking-wide px-3 py-1.5 rounded">
              ↓ Download {result.filename}
            </a>
          </div>
        </Card>
      )}
    </div>
  );
}


// ── EXTRACT ──────────────────────────────────────────────────────────────────

function ExtractTab({ onError }: { onError: (e: string | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StegoExtractResp | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); }, [downloadUrl]);

  async function run() {
    if (!file) { onError("Choose a stego file."); return; }
    onError(null); setBusy(true); setResult(null);
    if (downloadUrl) { URL.revokeObjectURL(downloadUrl); setDownloadUrl(null); }
    try {
      const r = await extractStego(file, password || undefined);
      setResult(r);
      // Build downloadable blob from base64 payload
      const bytes = Uint8Array.from(atob(r.payload_b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      setDownloadUrl(URL.createObjectURL(blob));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Card title="Stego file">
        <FilePicker
          accept=".png,.bmp,.wav,image/png,image/bmp,audio/wav"
          file={file}
          onPick={(f) => { setFile(f); setResult(null); onError(null); }}
          hint="Provide a PNG, BMP, or WAV that was created with this tool." />
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">
            Password (only if encrypted)
          </div>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-bg-base border border-divider rounded
                       px-2 py-1.5 text-[11px] font-mono text-ink-primary placeholder:text-ink-dim
                       focus:outline-none focus:border-accent"
            placeholder="leave blank if not encrypted" />
        </div>
        <div className="mt-3 flex justify-end">
          <button onClick={run} disabled={!file || busy}
            className="bg-accent hover:bg-accentDim active:translate-y-px
                       text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                       disabled:opacity-50 border border-accent/60">
            {busy ? "Extracting…" : "▶ Extract"}
          </button>
        </div>
      </Card>

      {result && (
        <Card title="Recovered payload">
          <div className="grid grid-cols-4 gap-3 mb-3">
            <KV k="Size" v={humanBytes(result.size)} />
            <KV k="Encrypted" v={result.encrypted ? "yes" : "no"}
                tone={result.encrypted ? "text-phos" : "text-ink-muted"} />
            <KV k="Compressed" v={result.compressed ? "yes" : "no"} />
            <KV k="Filename" v={result.filename ?? "—"} />
          </div>
          {result.is_text ? (
            <pre className="bg-bg-base border border-divider rounded p-2 text-[11px]
                            whitespace-pre-wrap break-all max-h-80 overflow-auto text-ink-primary">
              {result.text}
            </pre>
          ) : (
            <div className="text-[11px] text-ink-muted">Binary payload — use download below.</div>
          )}
          {downloadUrl && (
            <a href={downloadUrl} download={result.filename ?? "payload.bin"}
              className="inline-block mt-3 bg-phos/15 hover:bg-phos/25 text-phos border border-phos/40
                         text-xs font-bold tracking-wide px-3 py-1.5 rounded">
              ↓ Download {result.filename ?? "payload.bin"}
            </a>
          )}
        </Card>
      )}
    </div>
  );
}


// ── ANALYZE ──────────────────────────────────────────────────────────────────

function AnalyzeTab({ onError }: { onError: (e: string | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [stripBusy, setStripBusy] = useState(false);
  const [result, setResult] = useState<StegoAnalyzeResp | null>(null);
  const [stripUrl, setStripUrl] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => () => { if (stripUrl) URL.revokeObjectURL(stripUrl.url); }, [stripUrl]);

  async function run() {
    if (!file) { onError("Choose a file to analyze."); return; }
    onError(null); setBusy(true); setResult(null);
    if (stripUrl) { URL.revokeObjectURL(stripUrl.url); setStripUrl(null); }
    try { setResult(await analyzeStego(file)); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function strip() {
    if (!file) return;
    onError(null); setStripBusy(true);
    try {
      const r = await stripStegoMetadata(file);
      if (stripUrl) URL.revokeObjectURL(stripUrl.url);
      setStripUrl({ url: URL.createObjectURL(r.blob), name: r.filename });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally { setStripBusy(false); }
  }

  const sev = result?.verdict.severity ?? "clean";

  return (
    <div className="space-y-4">
      <Card title="File">
        <FilePicker file={file} onPick={(f) => { setFile(f); setResult(null); onError(null); }}
          accept=".png,.bmp,.jpg,.jpeg,.wav,image/*,audio/wav"
          hint="PNG, BMP, JPEG, or WAV. Runs chi-square LSB test + appended-data scan + EXIF dump." />
        <div className="mt-3 flex justify-end gap-2">
          {file && <button onClick={strip} disabled={stripBusy}
            className="border border-divider hover:border-ink-muted text-ink-muted hover:text-ink-primary
                       text-xs tracking-wide px-3 py-1.5 rounded">
            {stripBusy ? "Stripping…" : "Strip metadata"}
          </button>}
          <button onClick={run} disabled={!file || busy}
            className="bg-accent hover:bg-accentDim active:translate-y-px
                       text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                       disabled:opacity-50 border border-accent/60">
            {busy ? "Analyzing…" : "▶ Analyze"}
          </button>
        </div>
      </Card>

      {stripUrl && (
        <div className="rounded-md border border-phos/40 bg-phos/10 px-3 py-2 text-[11px] flex items-center gap-3">
          <span className="text-phos">Metadata stripped.</span>
          <a href={stripUrl.url} download={stripUrl.name}
            className="text-phos underline decoration-dotted">↓ {stripUrl.name}</a>
        </div>
      )}

      {result && (
        <>
          <div className={"rounded-md border-l-4 border " + SEV[sev].bg + " px-4 py-3"}>
            <div className="flex items-center gap-2">
              <span className={"inline-block w-2 h-2 rounded-full " + SEV[sev].dot} />
              <span className={"text-[10px] uppercase tracking-[0.25em] " + SEV[sev].text}>
                Verdict · {sev}
              </span>
            </div>
            {result.verdict.signals.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-[11px] font-mono text-ink-primary">
                {result.verdict.signals.map((s, i) => <li key={i}>· {s}</li>)}
              </ul>
            ) : (
              <div className="mt-2 text-[11px] text-ink-muted">No stego signals detected.</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card title="File">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <KV k="Format" v={result.format.toUpperCase()} />
                <KV k="Size" v={humanBytes(result.size_bytes)} />
                {result.width != null && <KV k="Dimensions" v={`${result.width} × ${result.height}`} />}
                {result.mode && <KV k="Pixel mode" v={result.mode} />}
                {result.frame_rate != null && <KV k="Sample rate" v={`${result.frame_rate} Hz`} />}
                {result.channels != null && <KV k="Channels" v={String(result.channels)} />}
                {result.capacity_bytes != null && <KV k="LSB capacity" v={humanBytes(result.capacity_bytes)} />}
                {result.ntsteg_magic_detected !== undefined &&
                  <KV k="NTSTEG header" v={result.ntsteg_magic_detected ? "FOUND" : "not present"}
                      tone={result.ntsteg_magic_detected ? "text-danger" : "text-ink-muted"} />}
              </div>
            </Card>

            {result.chi_square && (
              <Card title="Chi-square (Westfeld-Pfitzmann)">
                <div className="grid grid-cols-3 gap-2 text-[11px] mb-3">
                  <KV k="χ²" v={result.chi_square.chi_square.toFixed(2)} />
                  <KV k="dof" v={String(result.chi_square.dof)} />
                  <KV k="p-value"
                      v={result.chi_square.p_value.toFixed(4)}
                      tone={result.chi_square.p_value > 0.9 ? "text-danger"
                          : result.chi_square.p_value > 0.5 ? "text-amber"
                          : "text-phos"} />
                </div>
                <div className="text-[10px] text-ink-dim leading-snug">
                  Low p-value = natural image. High p-value (≈1) = LSBs look uniform,
                  consistent with steganography.
                </div>
              </Card>
            )}
          </div>

          {result.block_analysis && result.block_analysis.length > 0 && (
            <Card title="Block analysis — sequential chi² across the carrier">
              <div className="flex items-end gap-0.5 h-24">
                {result.block_analysis.map((b) => {
                  const h = Math.max(2, Math.round(b.p_value * 100));
                  const color = b.p_value > 0.9 ? "bg-danger"
                              : b.p_value > 0.5 ? "bg-amber"
                              : "bg-phos";
                  return (
                    <div key={b.block} className="flex-1 flex flex-col items-stretch"
                         title={`Block ${b.block}: p=${b.p_value.toFixed(3)}`}>
                      <div className="flex-1" />
                      <div className={"transition-all " + color} style={{ height: `${h}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-ink-dim">
                <span>block 1 (start of file)</span>
                <span>p-value scale: 0 → 1 (top)</span>
                <span>block {result.block_analysis.length} (end)</span>
              </div>
            </Card>
          )}

          {result.appended_data?.detected && (
            <Card title={`Appended data — ${result.appended_data.length} bytes after end-of-file marker`}>
              <div className="text-[11px] mb-2">
                <KV k="Offset" v={`0x${(result.appended_data.offset ?? 0).toString(16)}`} />
              </div>
              <pre className="bg-bg-base border border-divider rounded p-2 text-[10px]
                              font-mono break-all whitespace-pre-wrap text-ink-primary">
                {result.appended_data.preview_hex}
              </pre>
              {result.appended_data.printable && (
                <div className="mt-1 text-[10px] text-ink-muted font-mono">
                  ascii: <span className="text-ink-primary">{result.appended_data.printable}</span>
                </div>
              )}
            </Card>
          )}

          {result.exif?.present && (
            <Card title={`EXIF — ${result.exif.count ?? Object.keys(result.exif.tags).length} tag(s)`}>
              <div className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-[11px] font-mono">
                {Object.entries(result.exif.tags).map(([k, v]) => (
                  <div key={k} className="contents">
                    <div className="text-ink-dim">{k}</div>
                    <div className="text-ink-primary break-all">{v}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}


// ── Reusable bits ────────────────────────────────────────────────────────────

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const opts: Mode[] = ["embed", "extract", "analyze"];
  return (
    <div className="flex gap-0.5 text-[10px] tracking-widest">
      {opts.map((m) => (
        <button key={m} onClick={() => setMode(m)}
          className={
            "px-3 py-1.5 rounded border " +
            (mode === m
              ? "border-accent bg-accent/15 text-accent"
              : "border-divider text-ink-muted hover:text-ink-primary")
          }>{m.toUpperCase()}</button>
      ))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md overflow-hidden border border-divider">
      <header className="text-[10px] uppercase tracking-[0.2em] py-1.5 px-3
                         text-ink-dim border-b border-divider bg-bg-panel">{title}</header>
      <div className="bg-bg-card p-3 text-xs">{children}</div>
    </section>
  );
}

function KV({ k, v, tone = "text-ink-primary" }:
            { k: string; v: string; tone?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-ink-dim">{k}</div>
      <div className={"font-mono " + tone}>{v}</div>
    </div>
  );
}

function Toggle({ on, setOn, label }:
                { on: boolean; setOn: (b: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)}
        className="accent-accent w-3.5 h-3.5" />
      <span className="text-[11px] text-ink-muted">{label}</span>
    </label>
  );
}

function FilePicker({ file, onPick, accept, hint }:
  { file: File | null; onPick: (f: File | null) => void; accept?: string; hint?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onPick(f);
      }}
      className={
        "border border-dashed rounded px-3 py-3 transition " +
        (drag ? "border-accent bg-accent/5" : "border-divider")
      }>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <div className="flex items-center gap-3">
        <button onClick={() => ref.current?.click()}
          className="border border-divider hover:border-ink-muted text-ink-muted hover:text-ink-primary
                     text-[11px] tracking-wide px-2.5 py-1 rounded">
          Choose file
        </button>
        <div className="flex-1 text-[11px] font-mono text-ink-primary truncate">
          {file ? `${file.name}  ·  ${humanBytes(file.size)}` :
                  <span className="text-ink-dim">drop a file here or browse</span>}
        </div>
        {file && (
          <button onClick={() => onPick(null)}
            className="text-[10px] text-ink-dim hover:text-ink-primary">clear</button>
        )}
      </div>
      {hint && <div className="mt-2 text-[10px] text-ink-dim">{hint}</div>}
    </div>
  );
}
