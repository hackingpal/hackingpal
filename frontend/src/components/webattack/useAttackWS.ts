/** WebSocket helper for the WEB EXPLOIT routers.
 *
 * All routers share the same envelope: open WS, send a single init object,
 * receive a stream of typed events, optionally send `{action:"stop"}`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_URL } from "../../api";
import { record } from "../../lib/sessionLog";
import { recordResultIfActive } from "../../lib/engagement";

const WS_URL = BACKEND_URL.replace(/^http/, "ws");

export type WSStatus = "idle" | "connecting" | "running" | "done" | "error";

type EventHandler<E> = (event: E) => void;

export function useAttackWS<E>(
  wsPath: string,
  onEvent: EventHandler<E>,
  sessionLogCategory: string,
): {
  status: WSStatus;
  error: string;
  start: (init: unknown) => void;
  stop: () => void;
} {
  const [status, setStatus] = useState<WSStatus>("idle");
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

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
    setError("");
    setStatus("connecting");
    summaryRef.current = { findings: 0, done: 0, total: 0 };
    initRef.current = init;

    const ws = new WebSocket(`${WS_URL}${wsPath}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("running");
      ws.send(JSON.stringify(init));
    };
    ws.onmessage = (m) => {
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
        }
        if (evt.type === "done") {
          setStatus("done");
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
      }
    };
    ws.onerror = () => {
      setError("WebSocket error — backend reachable?");
      setStatus("error");
    };
    ws.onclose = () => {
      setStatus((s) => (s === "running" ? "done" : s));
      wsRef.current = null;
    };
  }, [wsPath, sessionLogCategory]);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    try { ws.send(JSON.stringify({ action: "stop" })); } catch { /* ignore */ }
  }, []);

  return { status, error, start, stop };
}
