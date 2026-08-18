import { useState, useReducer, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useId, useSyncExternalStore } from 'react';
import { useRenderCount } from '../lib/instrument.js';

/**
 * Hooks in depth. Each panel isolates ONE thing people get wrong, and shows the number that
 * proves it rather than asserting it.
 */

// ---------------------------------------------------------------------------
// 1. Batching, and functional updates.
// ---------------------------------------------------------------------------

function Batching() {
  const renders = useRenderCount('Batching');
  const [count, setCount] = useState(0);
  const [log, setLog] = useState([]);

  const threeDirect = () => {
    // Three setState calls with the SAME stale `count`. All three say "set it to count + 1".
    setCount(count + 1); setCount(count + 1); setCount(count + 1);
    setLog((l) => [...l, 'setCount(count + 1) x3 → +1']);
  };
  const threeFunctional = () => {
    // Three UPDATERS, each applied to the result of the previous one.
    setCount((c) => c + 1); setCount((c) => c + 1); setCount((c) => c + 1);
    setLog((l) => [...l, 'setCount(c => c + 1) x3 → +3']);
  };
  const insideTimeout = () => {
    // React 18+ batches here too — in React 17 this produced three renders.
    setTimeout(() => {
      setCount((c) => c + 1); setCount((c) => c + 1);
      setLog((l) => [...l, 'inside setTimeout → still ONE render (automatic batching)']);
    }, 0);
  };

  return (
    <div className="panel">
      <h2>1. batching &amp; functional updates</h2>
      <div className="toolbar">
        <button onClick={threeDirect}>setCount(count + 1) × 3</button>
        <button onClick={threeFunctional}>setCount(c =&gt; c + 1) × 3</button>
        <button onClick={insideTimeout}>× 2 inside setTimeout</button>
        <button onClick={() => { setCount(0); setLog([]); }}>reset</button>
      </div>
      <span className="stat">count <b>{count}</b></span>
      <span className="stat">renders <b className="render-count">{renders}</b></span>
      <p className="hint">
        The first button adds <b>1</b>, not 3: all three calls close over the same <code>count</code>.
        The second adds 3, because each updater receives the pending value. Both cause <b>one</b>
        render — state updates are batched, and since React 18 that includes timeouts, promises and
        native event handlers.
      </p>
      <div className="rows">{log.slice(-4).map((l, i) => <div className="row" key={i}><span>{l}</span></div>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Effect timing: useEffect vs useLayoutEffect.
// ---------------------------------------------------------------------------

function EffectTiming() {
  const [runs, setRuns] = useState([]);
  const [width, setWidth] = useState(0);
  const boxRef = useRef(null);
  const [mode, setMode] = useState('effect');

  // useLayoutEffect runs BEFORE the browser paints, so a measure-then-adjust never flickers.
  // useEffect runs AFTER paint, so the user can see the intermediate frame.
  const measure = () => { if (boxRef.current) setWidth(Math.round(boxRef.current.getBoundingClientRect().width)); };
  useEffect(() => { if (mode === 'effect') { measure(); setRuns((r) => [...r, 'useEffect ran (after paint)']); } }, [mode]);
  useLayoutEffect(() => { if (mode === 'layout') { measure(); setRuns((r) => [...r, 'useLayoutEffect ran (before paint)']); } }, [mode]);

  return (
    <div className="panel">
      <h2>2. effect timing</h2>
      <div className="toolbar">
        <button onClick={() => { setRuns([]); setMode('effect'); }} aria-pressed={mode === 'effect'}>useEffect</button>
        <button onClick={() => { setRuns([]); setMode('layout'); }} aria-pressed={mode === 'layout'}>useLayoutEffect</button>
      </div>
      <div ref={boxRef} style={{ background: '#1f3a52', padding: 10, borderRadius: 8, maxWidth: 420 }}>
        measured width: <b>{width}px</b>
      </div>
      <p className="hint">
        Order per commit: React mutates the DOM → <b>useLayoutEffect</b> (synchronously, blocking
        paint) → the browser paints → <b>useEffect</b>. Use layout effects only to measure or to fix
        up the DOM before it is seen; everything else belongs in useEffect, because a layout effect
        blocks the frame. In SSR, useLayoutEffect does not run at all and warns.
      </p>
      <div className="rows">{runs.slice(-3).map((r, i) => <div className="row" key={i}><span>{r}</span></div>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. The stale closure — the most common hook bug there is.
// ---------------------------------------------------------------------------

function StaleClosure() {
  const [count, setCount] = useState(0);
  const [stale, setStale] = useState(null);
  const [fixed, setFixed] = useState(null);
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    // Empty deps: this callback captures `count` from the FIRST render, forever.
    const id = setInterval(() => setStale(count), 1000);
    return () => clearInterval(id);
  }, []);                                     // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // A ref is a mutable box that survives renders, so the interval reads the CURRENT value.
    const id = setInterval(() => setFixed(countRef.current), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel">
      <h2>3. the stale closure</h2>
      <div className="toolbar"><button onClick={() => setCount((c) => c + 1)}>count++</button></div>
      <span className="stat">count <b>{count}</b></span>
      <span className="stat">interval sees (stale) <b className="render-count">{String(stale)}</b></span>
      <span className="stat">interval sees (ref) <b>{String(fixed)}</b></span>
      <p className="hint">
        Click a few times and wait. The first interval is stuck at <b>0</b> — it closed over the
        first render&apos;s <code>count</code> and the empty dependency array means it is never
        recreated. This is the same mechanism as javascript lab 01: a closure captures its
        environment, and each render has a different one.
      </p>
      <p className="hint">
        Three fixes, in order of preference: a <b>functional update</b> (<code>setX(x =&gt; …)</code>)
        when you only need the previous value; a <b>ref</b> when you need to read the latest value
        from a long-lived callback; and <b>correct dependencies</b> plus re-creating the interval,
        when the effect genuinely depends on the value.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. useReducer, and why it beats several useStates.
// ---------------------------------------------------------------------------

const initial = { status: 'idle', data: null, error: null, retries: 0 };
function reducer(state, action) {
  switch (action.type) {
    case 'fetch': return { ...state, status: 'loading', error: null };
    case 'resolve': return { status: 'success', data: action.data, error: null, retries: state.retries };
    case 'reject': return { ...state, status: 'error', error: action.error, retries: state.retries + 1 };
    case 'reset': return initial;
    default: return state;
  }
}

function ReducerPanel() {
  const [state, dispatch] = useReducer(reducer, initial);
  const renders = useRenderCount('Reducer');
  return (
    <div className="panel">
      <h2>4. useReducer</h2>
      <div className="toolbar">
        <button onClick={() => dispatch({ type: 'fetch' })}>fetch</button>
        <button onClick={() => dispatch({ type: 'resolve', data: [1, 2, 3] })}>resolve</button>
        <button onClick={() => dispatch({ type: 'reject', error: 'boom' })}>reject</button>
        <button onClick={() => dispatch({ type: 'reset' })}>reset</button>
      </div>
      <span className="stat">status <b>{state.status}</b></span>
      <span className="stat">retries <b>{state.retries}</b></span>
      <span className="stat">renders <b className="render-count">{renders}</b></span>
      <p className="hint">
        Four related fields in ONE atomic update. With four <code>useState</code>s you can express
        &quot;loading and error and data&quot; simultaneously, which is a state that should not
        exist — see typescript lab 06. The reducer also makes the transitions testable without
        React, and gives you one place to log every change.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. useSyncExternalStore — subscribing to something outside React.
// ---------------------------------------------------------------------------

const online = {
  subscribe(cb) {
    addEventListener('online', cb); addEventListener('offline', cb);
    return () => { removeEventListener('online', cb); removeEventListener('offline', cb); };
  },
  get: () => navigator.onLine,
};

function ExternalStore() {
  const isOnline = useSyncExternalStore(online.subscribe, online.get, () => true);
  const id = useId();
  return (
    <div className="panel">
      <h2>5. useSyncExternalStore &amp; useId</h2>
      <span className="stat">navigator.onLine <b>{String(isOnline)}</b></span>
      <span className="stat">useId <b>{id}</b></span>
      <p className="hint">
        The correct way to read anything that lives outside React — a browser API, a store, a
        WebSocket. The third argument is the <b>server snapshot</b>, used during SSR and hydration.
        Doing this with useState + useEffect instead produces <b>tearing</b> under concurrent
        rendering: two components reading the same external value in one render pass can see
        different values.
      </p>
      <p className="hint">
        <code>useId</code> generates an id that is <b>stable across server and client</b>, which is
        what makes <code>htmlFor</code>/<code>aria-describedby</code> work in SSR. Never use
        Math.random() for this — it is a guaranteed hydration mismatch.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. The dependency array, and what it actually compares.
// ---------------------------------------------------------------------------

function Deps() {
  const [n, setN] = useState(0);
  const [effectRuns, setEffectRuns] = useState({ object: 0, memoised: 0, primitive: 0 });

  const unstableObject = { key: 'constant' };            // a NEW object every render
  const stableObject = useMemo(() => ({ key: 'constant' }), []);
  const primitive = 'constant';

  useEffect(() => { setEffectRuns((r) => ({ ...r, object: r.object + 1 })); }, [unstableObject]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEffectRuns((r) => ({ ...r, memoised: r.memoised + 1 })); }, [stableObject]);
  useEffect(() => { setEffectRuns((r) => ({ ...r, primitive: r.primitive + 1 })); }, [primitive]);

  return (
    <div className="panel">
      <h2>6. the dependency array</h2>
      <div className="toolbar"><button onClick={() => setN(n + 1)}>re-render ({n})</button></div>
      <span className="stat">dep = a new object <b className="render-count">{effectRuns.object}</b></span>
      <span className="stat">dep = useMemo object <b>{effectRuns.memoised}</b></span>
      <span className="stat">dep = a string <b>{effectRuns.primitive}</b></span>
      <p className="hint">
        Dependencies are compared with <code>Object.is</code>, one by one. An object literal in the
        array is a new reference on every render, so the effect runs every time — and if that effect
        sets state, you have an infinite loop. This is the number-one cause of &quot;my effect runs
        forever&quot;.
      </p>
      <p className="hint">
        The fix is almost never <code>useMemo</code>. It is: depend on the <b>primitive fields</b>
        you actually use (<code>[user.id]</code>, not <code>[user]</code>), or move the object
        creation inside the effect, or lift it out of the component entirely.
      </p>
    </div>
  );
}

export function Hooks() {
  useRenderCount('HooksRoute');
  const noop = useCallback(() => {}, []);
  void noop;
  return (
    <>
      <Batching />
      <EffectTiming />
      <StaleClosure />
      <ReducerPanel />
      <ExternalStore />
      <Deps />
    </>
  );
}
