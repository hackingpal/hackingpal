type Props = { name: string };

export default function Placeholder({ name }: Props) {
  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
          Not ported yet
        </div>
        <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
          {name}
        </h2>
      </header>

      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md">
          <pre className="text-ink-dim text-[11px] leading-tight select-none">
{`       ╔══════════════════╗
       ║   ☐  PENDING     ║
       ║   migration...   ║
       ╚══════════════════╝`}
          </pre>
          <div className="mt-4 text-xs text-ink-muted">
            This feature lives in the legacy Python app while we migrate it.
          </div>
        </div>
      </div>
    </div>
  );
}
