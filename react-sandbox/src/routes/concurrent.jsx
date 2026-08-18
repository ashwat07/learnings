import { useState, useTransition, useDeferredValue, Suspense, lazy, useSyncExternalStore, useEffect, memo } from 'react';
import { useRenderCount, burn } from '../lib/instrument.js';
import { makeRows } from '../lib/data.js';

/**
 * Concurrent React. The theme: React can now RENDER SOMETHING AND THROW IT AWAY, which changes what
 * "a render" means and introduces one genuinely new bug (tearing).
 */

const ALL = makeRows(3000);

const ExpensiveList = memo(function ExpensiveList({ query }) {
  useRenderCount('ExpensiveList');
  burn(12);                                       // this render is deliberately expensive
  const rows = ALL.filter((r) => !query || r.name.includes(query)).slice(0, 30);
  return (
    <div className="rows">
      {rows.map((r) => <div className="row" key={r.id}><span>{r.id}</span><span>{r.name}</span><span>{r.team}</span></div>)}
    </div>
  );
});

// ---------------------------------------------------------------------------
// 1. Urgent vs non-urgent.
// ---------------------------------------------------------------------------

function Transitions() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('none');
  const [isPending, startTransition] = useTransition();
  const deferred = useDeferredValue(query);
  const effective = mode === 'deferred' ? deferred : query;

  const onChange = (e) => {
    const next = e.target.value;
    if (mode === 'transition') {
      setQuery(next);                             // urgent: the input must update immediately
      startTransition(() => setQuery(next));      // and the expensive consequence is interruptible
    } else {
      setQuery(next);
    }
  };

  return (
    <div className="panel">
      <h2>1. transitions &amp; deferred values</h2>
      <div className="toolbar">
        <input value={query} onChange={onChange} placeholder="type fast…" />
        <button onClick={() => setMode('none')} aria-pressed={mode === 'none'}>no scheduling</button>
        <button onClick={() => setMode('deferred')} aria-pressed={mode === 'deferred'}>useDeferredValue</button>
        <button onClick={() => setMode('transition')} aria-pressed={mode === 'transition'}>useTransition</button>
        {isPending && <span className="badge-count">pending</span>}
      </div>
      <p className="hint">
        Type quickly in each mode. Nothing here is <b>faster</b> — the list still costs 12ms to
        render. What changes is <b>what the user waits for</b>: with scheduling, the input value
        paints immediately and the expensive render happens at a lower priority, interrupted and
        restarted if you keep typing.
      </p>
      <p className="hint">
        Which one: <code>useTransition</code> when you own the setter (wrap the <b>update</b>);
        <code>useDeferredValue</code> when you receive a value as a prop (defer the <b>value</b>).
        Both need the expensive child to be memoised, or React re-renders it anyway.
      </p>
      <ExpensiveList query={effective} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Suspense.
// ---------------------------------------------------------------------------

const LazyPanel = lazy(() => new Promise((resolve) => {
  setTimeout(() => resolve({
    default: function Loaded() {
      return <div className="panel" style={{ margin: 0 }}><h3>Lazy panel</h3><p className="hint">Loaded after 1.2s.</p></div>;
    },
  }), 1200);
}));

function SuspensePanel() {
  const [show, setShow] = useState(false);
  return (
    <div className="panel">
      <h2>2. Suspense</h2>
      <div className="toolbar">
        <button onClick={() => setShow((s) => !s)}>{show ? 'unmount' : 'load a lazy component'}</button>
      </div>
      {show && (
        <Suspense fallback={<p className="hint">Suspense fallback — the boundary caught the pending import</p>}>
          <LazyPanel />
        </Suspense>
      )}
      <p className="hint">
        A Suspense boundary catches anything below it that is <b>not ready</b> — a lazy chunk, or a
        promise thrown by a data library. Placement is the design: a boundary around the whole page
        means the whole page blanks; a boundary per widget means each shows its own skeleton, which
        is the same tiering decision as resilience lab 03.
      </p>
      <p className="hint">
        The trap worth knowing: a fallback appears whenever a boundary <b>suspends again</b>, so an
        already-visible list can be replaced by a spinner on the next fetch. That is what
        <code>useTransition</code> prevents — an update marked as a transition keeps the old UI
        visible instead of falling back.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Tearing — the bug concurrency introduces.
// ---------------------------------------------------------------------------

const external = {
  value: 0,
  listeners: new Set(),
  subscribe(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); },
  set(v) { this.value = v; for (const l of this.listeners) l(); },
};

const ReaderCorrect = memo(function ReaderCorrect({ label }) {
  const v = useSyncExternalStore(external.subscribe.bind(external), () => external.value);
  burn(3);
  return <span className="stat">{label} <b>{v}</b></span>;
});

const ReaderNaive = memo(function ReaderNaive({ label }) {
  // The pattern that tears: read during render, subscribe in an effect.
  const [v, setV] = useState(external.value);
  useEffect(() => external.subscribe(() => setV(external.value)), []);
  burn(3);
  return <span className="stat">{label} <b>{v}</b></span>;
});

function TearingPanel() {
  const [, force] = useState(0);
  const [isPending, startTransition] = useTransition();
  const churn = () => {
    // Mutate the external store DURING a low-priority render pass.
    startTransition(() => { force((n) => n + 1); });
    for (let i = 1; i <= 5; i++) setTimeout(() => external.set(external.value + 1), i * 4);
  };
  return (
    <div className="panel">
      <h2>3. tearing</h2>
      <div className="toolbar">
        <button onClick={churn}>mutate the store during a transition</button>
        <button onClick={() => external.set(0)}>reset</button>
        {isPending && <span className="badge-count">pending</span>}
      </div>
      <div>
        {['A', 'B', 'C', 'D'].map((l) => <ReaderCorrect key={l} label={`sync:${l}`} />)}
      </div>
      <div>
        {['A', 'B', 'C', 'D'].map((l) => <ReaderNaive key={l} label={`naive:${l}`} />)}
      </div>
      <p className="hint">
        <b>Tearing</b> is two components rendering DIFFERENT values of the same source in ONE commit.
        It became possible when rendering became interruptible: React can render half a tree, yield
        to the browser, and finish later — and if the source changed in between, the two halves
        disagree.
      </p>
      <p className="hint">
        <code>useSyncExternalStore</code> exists exactly for this. It forces a synchronous
        re-render when the store changes mid-pass, so every consumer in a commit sees one value.
        Every store library (Redux, Zustand, Jotai) rewrote its subscription layer to use it — which
        is why &quot;just use useState + useEffect to subscribe&quot; is wrong in React 18+.
      </p>
    </div>
  );
}

export function Concurrent() {
  useRenderCount('ConcurrentRoute');
  return (
    <>
      <Transitions />
      <SuspensePanel />
      <TearingPanel />
    </>
  );
}
