// 44px breadcrumb bar that sits at the top of every tool page (inside the
// main content area, to the right of the sidebar). Shows section / tool
// name on the left, an active-scan spinner + version badge on the right.
//
// The theme toggle lives in App.tsx's top strip, so it isn't duplicated here.

import { WibblingSpinner } from "performative-ui";

export type Crumb = { label: string; onClick?: () => void };

type Props = {
  breadcrumb: Crumb[];
  /** When true, shows the green "Scanning" pulse on the right. */
  scanning?: boolean;
  /** Extra right-aligned content (rare — defaults are enough). */
  rightExtra?: React.ReactNode;
};

export default function TopBar({ breadcrumb, scanning = false, rightExtra }: Props) {
  return (
    <div
      className="flex items-center justify-between px-6 shrink-0"
      style={{
        height: 44,
        background: "var(--bg-base)",
        borderBottom: "1px solid var(--border)",
        fontFamily: "var(--font-mono)",
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {breadcrumb.map((c, i) => {
          const last = i === breadcrumb.length - 1;
          return (
            <span key={i} className="flex items-center gap-1.5 min-w-0">
              {c.onClick && !last ? (
                <button
                  onClick={c.onClick}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}
                  className="hover:!text-[color:var(--text-primary)] transition truncate"
                >
                  {c.label}
                </button>
              ) : (
                <span
                  style={{
                    fontSize: last ? 13 : 11,
                    fontWeight: last ? 500 : 600,
                    letterSpacing: last ? 0 : "0.08em",
                    textTransform: last ? "none" : "uppercase",
                    color: last ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                  className="truncate"
                >
                  {c.label}
                </span>
              )}
              {!last && (
                <span
                  style={{ color: "var(--text-muted)", fontSize: 11 }}
                  aria-hidden
                >
                  /
                </span>
              )}
            </span>
          );
        })}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {scanning && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--success)",
            }}
            title="A scan is currently running"
          >
            <WibblingSpinner />
          </span>
        )}
        {rightExtra}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--text-secondary)",
            border: "1px solid var(--border-bright)",
            borderRadius: 3,
            padding: "2px 6px",
            letterSpacing: "0.06em",
          }}
        >
          v0.1
        </span>
      </div>
    </div>
  );
}
