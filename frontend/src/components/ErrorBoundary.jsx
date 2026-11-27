import { Component } from 'react';

/**
 * Custom 500 page. If a page crashes while rendering, this shows a friendly
 * message instead of a blank screen or a stack trace. Going to another page
 * (a new `resetKey`) clears it.
 */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section role="alert" className="grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">
        <h3 className="m-0 text-base font-bold text-slate-700">500 · Something went wrong</h3>
        <p className="m-0 mt-1 text-sm">This page ran into a problem. Please try again.</p>
        <div className="mt-4 flex gap-4 text-sm font-bold">
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-bold text-brand" onClick={() => window.location.reload()}>
            Reload page
          </button>
          <a href="/dashboard" className="text-brand no-underline">Back to dashboard →</a>
        </div>
      </section>
    );
  }
}
