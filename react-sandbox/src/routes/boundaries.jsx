import { Component, useState, Suspense, lazy } from 'react';
import { useRenderCount } from '../lib/instrument.js';

/**
 * Error boundaries: fail a widget, not the page.
 *
 * The default in React is brutal and deliberate — an uncaught render error unmounts the WHOLE
 * tree, so a page with one broken widget shows a blank screen. That is a design decision on
 * React's part (a half-rendered UI can be worse than none), and it means boundaries are not
 * optional in any app with third-party or optional content.
 */

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, count: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // This is where the error goes to your reporter. Without it, a boundary silently swallows
    // failures and you find out from users — the most common mistake with boundaries.
    // eslint-disable-next-line no-console
    console.error(`[boundary:${this.props.name}]`, error, info.componentStack);
    this.props.onError?.({ name: this.props.name, error, stack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return this.props.fallback({
        error: this.state.error,
        retry: () => this.setState((s) => ({ error: null, count: s.count + 1 })),
      });
    }
    return <div key={this.state.count}>{this.props.children}</div>;
  }
}

function Broken({ mode }) {
  useRenderCount('Broken');
  if (mode === 'render') throw new Error('threw during render');
  if (mode === 'undefined-prop') {
    const data = undefined;
    return <p>{data.value.deep}</p>;         // the classic
  }
  return <p>this widget is fine</p>;
}

/** An async failure: NOT caught by an error boundary. This surprises everyone. */
function AsyncBroken() {
  const [, setState] = useState(0);
  return (
    <div>
      <p>this widget throws asynchronously</p>
      <button onClick={() => { setTimeout(() => { throw new Error('thrown in a timeout'); }, 0); }}>
        throw in setTimeout
      </button>
      <button onClick={() => { Promise.reject(new Error('unhandled rejection')); }}>
        reject a promise
      </button>
      <button onClick={() => { setState(() => { throw new Error('thrown in an updater'); }); }}>
        throw in a state updater (this one IS caught)
      </button>
    </div>
  );
}

const LazyWidget = lazy(() => new Promise((resolve, reject) =>
  setTimeout(() => (Math.random() > 0.5
    ? resolve({ default: () => <p>the lazy widget loaded</p> })
    : reject(new Error('chunk failed to load'))), 800)));

export function Boundaries() {
  useRenderCount('Boundaries');
  const [mode, setMode] = useState('ok');
  const [reported, setReported] = useState([]);
  const [showLazy, setShowLazy] = useState(false);

  const fallback = (name) => ({ error, retry }) => (
    <div style={{ border: '1px solid #5c2b2b', borderRadius: 8, padding: 10, color: '#ffb3b3' }}>
      <b>{name} is unavailable.</b> <span className="hint">{error.message}</span>
      <div><button onClick={retry}>retry</button></div>
    </div>
  );

  return (
    <>
      <div className="panel">
        <h2>granularity: where you put the boundary is the design</h2>
        <div className="toolbar">
          {['ok', 'render', 'undefined-prop'].map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</button>
          ))}
          <button onClick={() => setShowLazy((s) => !s)}>toggle the lazy widget</button>
        </div>
        <p className="hint">
          Three widgets, three boundaries. Break one and the other two keep working — and the page
          shell, the navigation and the rest of the app are untouched. Remove the boundaries and a
          single undefined property blanks the entire page.
        </p>
      </div>

      <div className="panel">
        <h2>widgets</h2>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <ErrorBoundary name="recommendations" fallback={fallback('Recommendations')} onError={(e) => setReported((r) => [...r, e])}>
            <Broken mode={mode} />
          </ErrorBoundary>

          <ErrorBoundary name="reviews" fallback={fallback('Reviews')} onError={(e) => setReported((r) => [...r, e])}>
            <p>reviews widget: always fine</p>
          </ErrorBoundary>

          <ErrorBoundary name="async" fallback={fallback('Async widget')} onError={(e) => setReported((r) => [...r, e])}>
            <AsyncBroken />
          </ErrorBoundary>

          {showLazy && (
            <ErrorBoundary name="lazy" fallback={fallback('Lazy widget')} onError={(e) => setReported((r) => [...r, e])}>
              <Suspense fallback={<p className="pending">loading the chunk…</p>}>
                <LazyWidget />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>what a boundary does NOT catch</h2>
        <ul className="hint">
          <li>errors in event handlers (use try/catch, or a state update that throws)</li>
          <li><code>setTimeout</code> / <code>requestAnimationFrame</code> callbacks — use <code>window.onerror</code></li>
          <li>unhandled promise rejections — use <code>unhandledrejection</code></li>
          <li>errors during server rendering (a different mechanism)</li>
          <li>errors thrown inside the boundary&apos;s own fallback (that one takes the page down)</li>
        </ul>
        <p className="hint">
          Try the async buttons above and watch the console: the boundary never fires. A complete
          error strategy is boundaries <em>plus</em> global handlers, and both must report to the
          same place.
        </p>
      </div>

      <div className="panel">
        <h2>reported to your error tracker ({reported.length})</h2>
        <div className="rows" style={{ maxHeight: 160 }}>
          {reported.map((r, i) => (
            <div className="row" key={i} style={{ gridTemplateColumns: '160px 1fr' }}>
              <span>{r.name}</span><span>{r.error.message}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
