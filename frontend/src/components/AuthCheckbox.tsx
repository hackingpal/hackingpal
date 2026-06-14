// Authorization gate used on every active-attack page (XSS, SQLi, etc.).
// Disables the run button until the user explicitly confirms they have
// written authorization to test the target.
import { useRef } from "react";
import { inkConfirm } from "../lib/dopamine";

type Props = {
  checked: boolean;
  onChange: (b: boolean) => void;
  /** Override the default message. */
  message?: string;
  className?: string;
};

export default function AuthCheckbox({
  checked,
  onChange,
  message = "I confirm I have written authorization to test this target.",
  className = "",
}: Props) {
  const ref = useRef<HTMLLabelElement>(null);

  function handleChange(next: boolean) {
    onChange(next);
    if (next && !checked) {
      // Off → on transition fires a single serene ink stroke. No-op for
      // on → off (uncheck is just dismissal, no need to celebrate).
      inkConfirm(ref.current ?? undefined);
    }
  }

  return (
    <label
      ref={ref}
      className={"flex items-start gap-3 cursor-pointer " + className}
      style={{
        padding: "12px 16px",
        borderRadius: 8,
        background: checked ? "var(--success-dim)" : "var(--high-dim)",
        border: `1px solid ${checked ? "var(--success)" : "var(--high)"}`,
        transition: "background 200ms ease, border-color 200ms ease",
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: 16,
          lineHeight: 1.2,
          marginTop: 1,
          color: checked ? "var(--success)" : "var(--high)",
        }}
      >
        {checked ? "✓" : "⚠"}
      </span>

      {/* Visually styled checkbox over a real input for keyboard a11y */}
      <span className="relative flex items-center mt-0.5" style={{ width: 16, height: 16 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => handleChange(e.target.checked)}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            cursor: "pointer",
            margin: 0,
          }}
        />
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: `1.5px solid ${checked ? "var(--success)" : "var(--high)"}`,
            background: checked ? "var(--success)" : "transparent",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 150ms ease, border-color 150ms ease",
          }}
        >
          {checked && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                 stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
      </span>

      <span
        style={{
          flex: 1,
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          lineHeight: 1.5,
          color: checked ? "var(--text-primary)" : "var(--text-primary)",
        }}
      >
        {message}
      </span>
    </label>
  );
}
