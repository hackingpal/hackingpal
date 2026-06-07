// Hover-reveal copy button for a result row.
// Shows ✓ for 1.5s after a successful copy.
import { useState } from "react";

type Props = {
  text: string;
  className?: string;
  // When true, the button is always visible (default behaviour expects a
  // parent with `group` class so the button reveals on group-hover).
  alwaysVisible?: boolean;
  label?: string;
  title?: string;
};

export default function CopyButton({
  text,
  className = "",
  alwaysVisible = false,
  label,
  title = "Copy",
}: Props) {
  const [copied, setCopied] = useState(false);

  async function onCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for environments without async clipboard
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const visibility = alwaysVisible
    ? "opacity-70 hover:opacity-100"
    : "opacity-0 group-hover:opacity-100 focus:opacity-100";

  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? "Copied" : title}
      aria-label={copied ? "Copied" : title}
      className={
        `inline-flex items-center gap-1 rounded border border-divider
         bg-bg-card hover:bg-bg-row-alt text-ink-muted hover:text-ink-primary
         px-1.5 py-0.5 text-[10px] font-mono transition ${visibility} ${className}`
      }
    >
      <span aria-hidden>{copied ? "✓" : "⧉"}</span>
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}
