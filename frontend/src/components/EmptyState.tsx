// Default "no results yet" state for every tool page.
// Click an example target to drop it into the page's input.
import type { ReactNode } from "react";

type Props = {
  icon: ReactNode;            // emoji or small inline node
  title: string;
  description: string;
  exampleTarget?: string;     // safe example (e.g. "scanme.nmap.org")
  onExample?: (target: string) => void;
  className?: string;
  hint?: ReactNode;
};

export default function EmptyState({
  icon,
  title,
  description,
  exampleTarget,
  onExample,
  className = "",
  hint,
}: Props) {
  return (
    <div
      className={"flex items-center justify-center " + className}
      style={{ minHeight: 260 }}
    >
      <div className="max-w-md text-center px-6">
        <div
          aria-hidden
          style={{
            fontSize: 48,
            lineHeight: 1,
            color: "var(--text-muted)",
            marginBottom: 16,
            userSelect: "none",
          }}
        >
          {icon}
        </div>
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
            marginTop: 6,
          }}
        >
          {description}
        </div>
        {exampleTarget && (
          <div
            style={{
              marginTop: 16,
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              color: "var(--text-muted)",
            }}
          >
            Try{" "}
            {onExample ? (
              <button
                onClick={() => onExample(exampleTarget)}
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--accent-bright)",
                  background: "var(--accent-dim)",
                  border: "1px solid var(--border-accent)",
                  borderRadius: 6,
                  padding: "2px 8px",
                  cursor: "pointer",
                  fontSize: 12,
                }}
                className="hover:!bg-[color:var(--accent-glow)]"
              >
                {exampleTarget}
              </button>
            ) : (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--accent-bright)",
                }}
              >
                {exampleTarget}
              </span>
            )}
          </div>
        )}
        {hint && (
          <div
            style={{
              marginTop: 12,
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
