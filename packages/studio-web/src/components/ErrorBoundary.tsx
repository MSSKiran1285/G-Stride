import { Component } from 'react';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Without this, any uncaught render error unmounts the whole tree and leaves a
// silently blank page — exactly the failure mode that made an earlier bug (a
// response missing an expected field) invisible instead of debuggable.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel stack" style={{ margin: '1.5rem' }}>
          <p className="section-title">Something went wrong</p>
          <pre className="error-text log-tail">{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
