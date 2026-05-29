/** WebSocket helper for the WEB EXPLOIT routers.
 *
 * All routers share the same envelope: open WS, send a single init object,
 * receive a stream of typed events, optionally send `{action:"stop"}`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { openWs, watchWsLiveness } from "../../api";
import { record } from "../../lib/sessionLog";
import { recordResultIfActive, useActiveEngagementId } from "../../lib/engagement";

export type WSStatus = "idle" | "connecting" | "running" | "done" | "error";
export type WSTimeoutPhase = "connect" | "idle";

type EventHandler<E> = (event: E) => void;

export function useAttackWS<E>(
  wsPath: string,
  onEvent: EventHandler<E>,
  sessionLogCategory: string,
): {
  status: WSStatus;
  error: string;
  timedOut: WSTimeoutPhase | null;
  start: (init: unknown) => void;
  stop: () => void;
} {
  const [status, setStatus] = useState<WSStatus>("idle");
  const [error, setError] = useState("");
  const [timedOut, setTimedOut] = useState<WSTimeoutPhase | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const watchRef = useRef<ReturnType<typeof watchWsLiveness> | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  // Active engagement id is auto-merged into every WS init below so the
  // backend can attach the audit_log row to the right engagement and run
  // its scope check. Pages don't need to pass it explicitly. Captured via
  // a ref so the start() callback doesn't have to re-create on every change.
  const engagementId = useActiveEngagementId();
  const engagementIdRef = useRef(engagementId);
  engagementIdRef.current = engagementId;

  const summaryRef = useRef<{ findings: number; done: number; total: number }>({
    findings: 0, done: 0, total: 0,
  });

  // Clean up on unmount
  useEffect(() => () => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const initRef = useRef<unknown>(null);

  const start = useCallback((init: unknown) => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
    }
    watchRef.current?.stop();
    setError("");
    setTimedOut(null);
    setStatus("connecting");
    summaryRef.current = { findings: 0, done: 0, total: 0 };
    initRef.current = init;

    const ws = openWs(wsPath);
    wsRef.current = ws;

    // Liveness watch: surface a distinct "timed out" phase if the WS never
    // opens (connect) or stops sending frames mid-scan (idle).
    watchRef.current = watchWsLiveness(ws, {
      connectMs: 5_000,
      idleMs: 60_000,
      onTimeout: (phase) => {
        setTimedOut(phase);
        setStatus("error");
        try { ws.close(); } catch { /* ignore */ }
      },
    });

    ws.onopen = () => {
      setStatus("running");
      // Merge active engagement id into the init payload so the backend can
      // attach this scan to the right engagement + scope-check the target.
      // Per-page init wins if the caller set engagement_id explicitly.
      const merged = (typeof init === "object" && init !== null)
        ? { engagement_id: engagementIdRef.current ?? undefined, ...(init as object) }
        : init;
      ws.send(JSON.stringify(merged));
    };
    ws.onmessage = (m) => {
      watchRef.current?.touch();
      try {
        const evt = JSON.parse(m.data) as E & { type?: string; findings?: number; done?: number; total?: number };
        if (evt.type === "finding" && typeof evt.findings !== "number") {
          summaryRef.current.findings++;
        }
        if (typeof evt.findings === "number") summaryRef.current.findings = evt.findings;
        if (typeof evt.done === "number") summaryRef.current.done = evt.done;
        if (typeof evt.total === "number") summaryRef.current.total = evt.total;
        if (evt.type === "error" && (evt as any).detail) {
          setError(String((evt as any).detail));
          setStatus("error");
          watchRef.current?.stop();
        }
        if (evt.type === "done") {
          setStatus("done");
          watchRef.current?.stop();
          const summary = {
            findings: summaryRef.current.findings,
            done: summaryRef.current.done,
            total: summaryRef.current.total,
            ...(evt as any),
          };
          record(sessionLogCategory, summary);
          // Also auto-record to the active engagement, if any.
          const target = (initRef.current as any)?.url ?? (initRef.current as any)?.domain ?? "";
          void recordResultIfActive(
            sessionLogCategory, String(target),
            `${summary.findings ?? 0} findings, ${summary.done ?? 0}/${summary.total ?? 0} payloads`,
            summary,
          );
        }
        handlerRef.current(evt as E);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
        watchRef.current?.stop();
      }
    };
    ws.onerror = () => {
      setError("WebSocket error — backend reachable?");
      setStatus("error");
      watchRef.current?.stop();
    };
    ws.onclose = () => {
      setStatus((s) => (s === "running" ? "done" : s));
      watchRef.current?.stop();
      wsRef.current = null;
    };
  }, [wsPath, sessionLogCategory]);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    try { ws.send(JSON.stringify({ action: "stop" })); } catch { /* ignore */ }
  }, []);

  return { status, error, timedOut, start, stop };
}
