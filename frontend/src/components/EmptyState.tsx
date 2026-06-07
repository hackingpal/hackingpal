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
  // Optional secondary line (e.g. "Press ▶ Start to scan")
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
      className={
        "h-full min-h-[260px] flex items-center justify-center " + className
      }
    >
      <div className="max-w-md text-center px-6">
        <div className="text-5xl mb-3 select-none" aria-hidden>
          {icon}
        </div>
        <div className="text-sm font-bold tracking-wide text-ink-primary">
          {title}
        </div>
        <div className="mt-1 text-xs text-ink-muted leading-relaxed">
          {description}
        </div>
        {exampleTarget && (
          <div className="mt-4 text-[11px] text-ink-dim">
            Try{" "}
            {onExample ? (
              <button
                onClick={() => onExample(exampleTarget)}
                className="font-mono text-accent hover:text-accentDim underline
                           underline-offset-2 decoration-dotted"
              >
                {exampleTarget}
              </button>
            ) : (
              <span className="font-mono text-accent">{exampleTarget}</span>
            )}
          </div>
        )}
        {hint && (
          <div className="mt-3 text-[10px] text-ink-dim leading-relaxed">
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
