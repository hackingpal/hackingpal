// Per-page error boundary. Wrap the active page in App.tsx with this so a
// render-time exception in one tool doesn't whitescreen the whole app — the
// user can still see the sidebar, navigate to a working page, and (optionally)
// retry the broken one.
//
// React doesn't have a hook form for error boundaries yet, so this stays a
// class. The `resetKey` prop is set to the active page id from the parent —
// when the user navigates away, the boundary's state resets automatically.

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  resetKey: string;
  children: ReactNode;
};

type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console-only — there's no remote error reporter wired up here.
    console.error("[ErrorBoundary]", this.props.resetKey, error, info.componentStack);
  }

  retry = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const { error } = this.state;
    return (
      <div className="h-full p-6 flex items-start justify-center overflow-auto">
        <div className="max-w-2xl w-full bg-bg-card border border-danger/40 rounded p-4">
          <div className="text-[11px] font-bold tracking-widest text-danger mb-2">
            PAGE CRASHED
          </div>
          <div className="text-[13px] text-ink-primary mb-2">
            <code className="text-amber">{error.name}</code>: {error.message}
          </div>
          <div className="text-[11px] text-ink-dim mb-3">
            This page hit an uncaught error. The rest of the app is still fine —
            switch to another tool from the sidebar, or retry below.
          </div>
          <details className="text-[11px] mb-3">
            <summary className="cursor-pointer text-ink-muted hover:text-ink-primary">
              Stack trace
            </summary>
            <pre className="mt-2 p-2 bg-bg-base border border-divider rounded overflow-auto
                            text-[10px] text-ink-dim font-mono whitespace-pre-wrap">
              {error.stack ?? "(no stack)"}
            </pre>
          </details>
          <button
            onClick={this.retry}
            className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}
