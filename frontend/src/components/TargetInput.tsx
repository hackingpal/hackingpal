// Labelled target field used by every page that takes a single target
// (host, URL, IP, domain, hash). The label is the small uppercase
// "TARGET" tag; the placeholder differs per tool.
import { forwardRef } from "react";

type Props = {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Right-aligned content rendered inside the field (e.g. a clear button). */
  trailing?: React.ReactNode;
  className?: string;
  /** Optional id for label/aria-labelledby linking. */
  id?: string;
  /** Optional help text below the field. */
  hint?: string;
};

const TargetInput = forwardRef<HTMLInputElement, Props>(function TargetInput(
  { label = "Target", value, onChange, onEnter, placeholder,
    disabled = false, trailing, className = "", id, hint },
  ref,
) {
  return (
    <label className={"block " + className} htmlFor={id}>
      <span
        style={{
          display: "block",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter && !e.shiftKey) {
              e.preventDefault();
              onEnter();
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          style={{
            width: "100%",
            height: 40,
            background: "var(--bg-base)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: trailing ? "0 88px 0 14px" : "0 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: "var(--text-primary)",
            outline: "none",
            transition: "border-color 150ms ease, box-shadow 150ms ease",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-dim)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        {trailing && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {trailing}
          </div>
        )}
      </div>
      {hint && (
        <p
          style={{
            margin: "6px 0 0 0",
            fontFamily: "var(--font-sans)",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          {hint}
        </p>
      )}
    </label>
  );
});

export default TargetInput;
