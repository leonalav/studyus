import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Stops one broken subtree from taking down the whole application.
 *
 * React unmounts the entire tree when a render throws and nothing catches it,
 * which is how a single malformed board block turned into a blank white screen
 * and a lost study session. Boundaries are placed so that a failure is
 * contained at the smallest honest unit: a widget, a board block, or at worst
 * the study room — never the window.
 *
 * The fallback deliberately says what broke and offers a way forward. A learner
 * mid-session needs their work to survive the failure, not a friendly apology.
 */

interface Props {
  children: ReactNode;
  /** Human-readable name of what failed, e.g. "Concept Card widget". */
  label: string;
  /** Rendered instead of the default card when provided. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Remount the subtree when this value changes (e.g. a new board id). */
  resetKey?: unknown;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: Props) {
    // A new board or session is a fresh chance to render; do not strand the
    // learner on a stale error card after they navigate away from the problem.
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack in the console for diagnosis. This is the only record of
    // the failure once the fallback replaces the subtree.
    console.error(`[${this.props.label}] render failed`, error, info.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div
        role="alert"
        className="rounded-lg border border-dashed px-3 py-2.5 text-[12px]"
        style={{ borderColor: "rgba(252,165,165,0.4)", background: "rgba(252,165,165,0.06)", color: "#fca5a5" }}
      >
        <div className="font-medium">{this.props.label} could not be displayed</div>
        <div className="mt-0.5 opacity-70">
          The rest of your session is unaffected.{" "}
          <button type="button" onClick={this.reset} className="underline underline-offset-2">
            Try again
          </button>
        </div>
      </div>
    );
  }
}
