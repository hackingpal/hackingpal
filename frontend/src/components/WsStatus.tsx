// Inline state pill for WebSocket / scan lifecycles. Drop into a header or
// stats bar to show the user whether anything is in flight.
//
//   connecting  — yellow pulse
//   scanning    — green pulse
//   complete    — green static
//   error       — red static
//   stopped     — grey static
//   idle        — muted dot

export type WsState =
  | "idle"
  | "connecting"
  | "scanning"
  | "complete"
  | "error"
  | "stopped";

type Props = {
  state: WsState;
  /** Override the label text. */
  label?: string;
  className?: string;
};

const COLOR: Record<WsState, { dot: string; text: string; pulse?: string }> = {
  idle:        { dot: "var(--text-muted)",  text: "var(--text-muted)" },
  connecting:  { dot: "var(--medium)",      text: "var(--medium)",  pulse: "connecting" },
  scanning:    { dot: "var(--success)",     text: "var(--success)", pulse: "scanning" },
  complete:    { dot: "var(--success)",     text: "var(--success)" },
  error:       { dot: "var(--critical)",    text: "var(--critical)" },
  stopped:     { dot: "var(--text-muted)",  text: "var(--text-muted)" },
};

const DEFAULT_LABEL: Record<WsState, string> = {
  idle:       "Idle",
  connecting: "Connecting",
  scanning:   "Scanning",
  complete:   "Complete",
  error:      "Error",
  stopped:    "Stopped",
};

export default function WsStatus({ state, label, className = "" }: Props) {
  const c = COLOR[state];
  return (
    <span
      className={"inline-flex items-center gap-1.5 " + className}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: c.text,
      }}
    >
      <span
        className={c.pulse ?? ""}
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: c.dot,
          display: "inline-block",
        }}
        aria-hidden
      />
      <span>{label ?? DEFAULT_LABEL[state]}</span>
    </span>
  );
}
