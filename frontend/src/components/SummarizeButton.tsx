// SummarizeButton — "✨ Summarize results" CTA that sits below a tool's
// results panel. Click → POST /summarize/stream, render the streamed AI
// summary inline as a violet-accented card with bullets + next-steps.
//
// Caches by (tool, target, sha-of-raw) so flipping tabs or re-rendering
// doesn't re-fire the call. When an engagement is active, the backend
// persists the summary into the engagement so the generated report can
// embed it.

import { useEffect, useMemo, useRef, useState } from "react";

import { authFetch } from "../api";
import { useActiveEngagementId } from "../lib/engagement";

type Props = {
  tool: string;
  target?: string;
  raw: unknown;
  /** Override the button styling — defaults to the standard accent pill. */
  className?: string;
  /** Override the label. Defaults to "✨ Summarize results". */
  label?: string;
};

// Module-level cache survives component unmount so navigating away and
// back doesn't lose the summary (or re-bill the API).
const summaryCache = new Map<string, string>();

async function digestKey(
  tool: string, target: string, rawJson: string,
): Promise<string> {
  try {
    const enc = new TextEncoder();
    const bytes = enc.encode(`${tool}${target}${rawJson}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest),
      (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
  } catch {
    return `${tool}:${target}:${rawJson.length}`;
  }
}

export default function SummarizeButton({
  tool, target = "", raw, className, label,
}: Props): JSX.Element {
  const activeEngagementId = useActiveEngagementId();

  // Stable serialization so a fresh-object-on-every-render `raw` doesn't
  // re-fire the cache lookup or the abort cleanup.
  const rawJson = useMemo(() => {
    try { return JSON.stringify(raw); } catch { return ""; }
  }, [raw]);

  const [state, setState] = useState<"idle" | "streaming" | "done" | "error">("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [cacheKey, setCacheKey] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("idle");
    setText("");
    setError("");
    setCacheKey("");
    digestKey(tool, target, rawJson).then((key) => {
      if (cancelled) return;
      setCacheKey(key);
      const cached = summaryCache.get(key);
      if (cached) {
        setText(cached);
        setState("done");
      }
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [tool, target, rawJson]);

  async function start() {
    if (state === "streaming") return;
    setState("streaming");
    setText("");
    setError("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let res: Response;
    try {
      res = await authFetch("/summarize/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool,
          target,
          raw,
          engagement_id: activeEngagementId || null,
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
      return;
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        detail = (typeof j.detail === "string" ? j.detail : j.error) || detail;
      } catch { /* ignore */ }
      setError(detail);
      setState("error");
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      setState("done");
      return;
    }
    const decoder = new TextDecoder();
    let buf = "";
    let acc = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          let evt: { type?: string; text?: string; detail?: string };
          try { evt = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
          if (evt.type === "text_delta" && typeof evt.text === "string") {
            acc += evt.text;
            setText(acc);
          } else if (evt.type === "error") {
            setError(evt.detail ?? "stream error");
            setState("error");
            return;
          }
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
        return;
      }
    }

    if (acc && cacheKey) summaryCache.set(cacheKey, acc);
    setState("done");
  }

  if (state === "idle") {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={start}
          className={
            className ??
            "px-2.5 py-1 text-[11px] uppercase tracking-widest rounded " +
              "border border-accent/40 bg-accent/10 text-accent " +
              "hover:bg-accent/20 transition"
          }
          title="Ask Claude to summarize what this tool found + suggest next steps"
        >
          {label ?? "✨ Summarize results"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded border border-accent/30 bg-accent/5 p-3 text-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-widest text-accent flex items-center gap-2">
          ✨ AI Summary
          {state === "streaming" && (
            <span className="text-ink-muted normal-case animate-pulse">thinking…</span>
          )}
        </div>
        {state !== "streaming" && (
          <button
            type="button"
            onClick={start}
            className="text-[10px] text-ink-muted hover:text-accent uppercase tracking-widest"
            title="Re-run the summary"
          >
            ↻ Re-summarize
          </button>
        )}
      </div>
      {state === "error" ? (
        <div className="text-danger text-xs">{error || "Summary failed."}</div>
      ) : text ? (
        <Markdown text={text} />
      ) : (
        <div className="text-ink-muted text-xs italic">Waiting on AI…</div>
      )}
    </div>
  );
}

// ── Tiny markdown subset renderer ──────────────────────────────────────────
// Mirrors backend/routers/engagements.py _md_to_html: handles ## / ### / ####
// headers, - / * bullets, **bold**, *em*, `code`. Everything else is escaped.

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMd(text), [text]);
  return (
    <div
      className="text-ink-primary leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;",
  );
}

function inlineMd(s: string): string {
  let r = escapeHtml(s);
  r = r.replace(/`([^`\n]+)`/g,
    '<code class="px-1 py-0.5 rounded bg-bg-base text-accent text-[12px]">$1</code>');
  r = r.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  r = r.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  return r;
}

function renderMd(md: string): string {
  if (!md) return "";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inUl = false;
  const closeUl = () => { if (inUl) { out.push("</ul>"); inUl = false; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { closeUl(); continue; }
    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) {
      closeUl();
      const level = Math.min(h[1].length + 1, 5);
      out.push(
        `<h${level} class="text-[11px] uppercase tracking-widest text-accent ` +
          `mt-2 mb-1">${inlineMd(h[2])}</h${level}>`,
      );
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (!inUl) {
        out.push('<ul class="list-disc pl-5 space-y-0.5 my-1">');
        inUl = true;
      }
      out.push(`<li>${inlineMd(li[1])}</li>`);
      continue;
    }
    closeUl();
    out.push(`<p class="my-1">${inlineMd(line)}</p>`);
  }
  closeUl();
  return out.join("");
}
