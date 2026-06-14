// Page wrapper used by every tool page that opts in to the new chrome.
//
// Renders: optional TopBar (breadcrumb) → page header (icon + title +
// optional badge + description + actions) → page body.
//
// Doesn't manage scrolling — the page body decides whether to scroll
// its own region or let the layout scroll the whole thing.
import type { ReactNode } from "react";
import TopBar, { type Crumb } from "./TopBar";

type Props = {
  title: string;
  icon?: ReactNode;
  badge?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Breadcrumb shown in the top bar (e.g. ["RECON", "Port Scanner"]) */
  breadcrumb?: Crumb[];
  /** Hide the inner header entirely (e.g. for pages that need full canvas). */
  bare?: boolean;
  /** When true, ws is open so TopBar can show the active-scan pulse. */
  scanning?: boolean;
  /** Set false to disable the outer max-width clamp. */
  contained?: boolean;
};

export default function Layout({
  title,
  icon,
  badge,
  description,
  actions,
  children,
  breadcrumb,
  bare = false,
  scanning = false,
  contained = true,
}: Props) {
  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-base)" }}>
      <TopBar
        breadcrumb={breadcrumb ?? [{ label: title }]}
        scanning={scanning}
      />

      <div className="flex-1 overflow-auto">
        <div
          className="mx-auto"
          style={{
            padding: bare ? 0 : 24,
            maxWidth: contained ? 1100 : "none",
          }}
        >
          {!bare && (
            <header
              className="flex items-start gap-4"
              style={{
                marginBottom: 24,
                paddingBottom: 20,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  {icon && (
                    <span
                      style={{
                        color: "var(--accent-bright)",
                        fontSize: 18,
                        lineHeight: 1,
                        display: "inline-flex",
                      }}
                    >
                      {icon}
                    </span>
                  )}
                  <h1
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: 18,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      letterSpacing: "-0.01em",
                      margin: 0,
                    }}
                  >
                    {title}
                  </h1>
                  {badge && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        fontWeight: 600,
                        background: "var(--accent-dim)",
                        color: "var(--accent-bright)",
                        border: "1px solid var(--border-accent)",
                        borderRadius: 999,
                        padding: "2px 8px",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                      }}
                    >
                      {badge}
                    </span>
                  )}
                </div>
                {description && (
                  <p
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: "var(--text-secondary)",
                      marginTop: 8,
                      marginBottom: 0,
                    }}
                  >
                    {description}
                  </p>
                )}
              </div>
              {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
            </header>
          )}

          {children}
        </div>
      </div>
    </div>
  );
}
