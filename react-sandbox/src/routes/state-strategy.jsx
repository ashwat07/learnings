import { createContext, useContext, useState, useMemo, useCallback, useSyncExternalStore, memo } from 'react';
import { useRenderCount, burn } from '../lib/instrument.js';
import { makeRows, api } from '../lib/data.js';

/**
 * Five kinds of state, four mechanisms, and the cost of putting each in the wrong place.
 *
 * The thing this route makes visible: a Context provider re-renders EVERY consumer when its
 * value changes, so "just put it in Context" turns a keystroke into a full-tree render. A store
 * with a selector re-renders only the components that read the part that changed.
 */

// ---------------------------------------------------------------------------
// 1. Context — one value, every consumer re-renders when it changes
// ---------------------------------------------------------------------------

const FilterContext = createContext(null);

function ContextProvider({ children }) {
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState('dark');
  // A new object identity on every render: every consumer re-renders even if it only reads
  // `theme` and only `query` changed. useMemo narrows this a little; splitting the context
  // properly is the actual fix.
  const value = useMemo(() => ({ query, setQuery, theme, setTheme }), [query, theme]);
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

const ContextConsumerA = memo(function ContextConsumerA() {
  const { query } = useContext(FilterContext);
  useRenderCount('ctx:reads-query');
  return <span className="stat">reads query <b>{query || '—'}</b></span>;
});

const ContextConsumerB = memo(function ContextConsumerB() {
  const { theme } = useContext(FilterContext);
  useRenderCount('ctx:reads-theme-only');
  return <span className="stat">reads theme <b>{theme}</b></span>;
});

// ---------------------------------------------------------------------------
// 2. An external store with selectors — the Zustand/Redux model in 25 lines
// ---------------------------------------------------------------------------

function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    setState(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      for (const l of listeners) l();
    },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
  };
}

const store = createStore({ query: '', theme: 'dark', selected: null });

/**
 * useSyncExternalStore with a SELECTOR: the component only re-renders when the slice it reads
 * changes. That is the entire difference between a store and Context, and it is why every
 * store library exposes selectors.
 */
function useStoreSlice(selector) {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

const StoreConsumerA = memo(function StoreConsumerA() {
  const query = useStoreSlice((s) => s.query);
  useRenderCount('store:reads-query');
  return <span className="stat">reads query <b>{query || '—'}</b></span>;
});

const StoreConsumerB = memo(function StoreConsumerB() {
  const theme = useStoreSlice((s) => s.theme);
  useRenderCount('store:reads-theme-only');
  return <span className="stat">reads theme <b>{theme}</b></span>;
});

// ---------------------------------------------------------------------------
// 3. Server state — a 60-line query cache with staleness, dedup and revalidation
// ---------------------------------------------------------------------------

const queryCache = new Map();          // key -> { data, error, status, storedAt, promise, listeners }

function useQuery(key, fetcher, { staleMs = 5000 } = {}) {
  const entry = queryCache.get(key) ?? { status: 'idle', listeners: new Set() };
  if (!queryCache.has(key)) queryCache.set(key, entry);

  const snapshot = useSyncExternalStore(
    (cb) => { entry.listeners.add(cb); return () => entry.listeners.delete(cb); },
    () => entry.version ?? 0,
  );

  const notify = () => { entry.version = (entry.version ?? 0) + 1; for (const l of entry.listeners) l(); };

  const isStale = !entry.storedAt || Date.now() - entry.storedAt > staleMs;

  if (entry.status === 'idle' || (isStale && !entry.promise)) {
    // Deduplication: one in-flight request per key, however many components ask.
    entry.status = entry.data ? 'stale' : 'loading';
    entry.promise = fetcher()
      .then((data) => { entry.data = data; entry.status = 'success'; entry.storedAt = Date.now(); })
      .catch((error) => { entry.error = error; entry.status = 'error'; })
      .finally(() => { entry.promise = null; notify(); });
  }

  return { data: entry.data, status: entry.status, error: entry.error, version: snapshot,
    refetch: () => { entry.storedAt = 0; notify(); } };
}

const ServerState = memo(function ServerState() {
  useRenderCount('server-state');
  const a = useQuery('rows', () => api.slow('rows', 400));
  const b = useQuery('rows', () => api.slow('rows', 400));   // same key: deduplicated
  return (
    <div>
      <span className="stat">status <b>{a.status}</b></span>
      <span className="stat">server hits <b>{a.data?.serverHits ?? '—'}</b></span>
      <span className="stat">second consumer sees <b>{b.data?.serverHits ?? '—'}</b></span>
      <button onClick={a.refetch}>refetch</button>
    </div>
  );
});

// ---------------------------------------------------------------------------
// 4. The expensive list — the victim of whichever mechanism you chose
// ---------------------------------------------------------------------------

const ROWS = makeRows(300);

const ExpensiveList = memo(function ExpensiveList({ query }) {
  useRenderCount('list');
  burn(6);                                   // pretend this list is expensive to render
  const rows = ROWS.filter((r) => !query || r.name.includes(query)).slice(0, 40);
  return (
    <div className="rows">
      <div className="row head"><span>id</span><span>name</span><span>team</span><span>status</span><span>score</span></div>
      {rows.map((r) => (
        <div className="row" key={r.id}>
          <span>{r.id}</span><span>{r.name}</span><span>{r.team}</span><span>{r.status}</span><span>{r.score}</span>
        </div>
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------

export function StateStrategy() {
  useRenderCount('StateStrategy');
  const [local, setLocal] = useState('');
  const [urlState, setUrlState] = useState(() => new URLSearchParams(location.search).get('team') ?? '');

  const setTeam = useCallback((team) => {
    setUrlState(team);
    const url = new URL(location.href);
    if (team) url.searchParams.set('team', team); else url.searchParams.delete('team');
    history.replaceState(null, '', url);      // URL as state: shareable, restorable, free
  }, []);

  return (
    <>
      <div className="panel">
        <h2>1. local state — the default, and usually correct</h2>
        <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="type here" />
        <span className="stat">value <b>{local || '—'}</b></span>
        <p className="hint">
          Nothing outside this component needs to know. Watch the tally: typing re-renders this
          component and the memoised list only if its props changed.
        </p>
      </div>

      <div className="panel">
        <h2>2. Context — every consumer re-renders when the value changes</h2>
        <ContextProvider>
          <ContextControls />
        </ContextProvider>
        <p className="hint">
          Change the theme and watch <code>ctx:reads-query</code> re-render even though the query
          did not change. One context object = one invalidation unit.
        </p>
      </div>

      <div className="panel">
        <h2>3. external store + selectors — only what changed re-renders</h2>
        <input
          onChange={(e) => store.setState({ query: e.target.value })}
          placeholder="query (store)"
        />
        <button onClick={() => store.setState((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }))}>
          toggle theme
        </button>
        <StoreConsumerA />
        <StoreConsumerB />
        <p className="hint">
          Toggle the theme: <code>store:reads-query</code> does <strong>not</strong> re-render.
          That is the selector doing its job.
        </p>
      </div>

      <div className="panel">
        <h2>4. server state — cached, deduplicated, revalidated</h2>
        <ServerState />
        <p className="hint">
          Two components ask for the same key; the server is hit once. This is the 60-line version
          of what TanStack Query does — read <code>useQuery</code> in this file.
        </p>
      </div>

      <div className="panel">
        <h2>5. URL state — shareable and restorable, and free</h2>
        <select value={urlState} onChange={(e) => setTeam(e.target.value)}>
          <option value="">all teams</option>
          {['core', 'infra', 'ui', 'data'].map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="stat">?team= <b>{urlState || '—'}</b></span>
        <p className="hint">Reload the page: the selection survives. No store required.</p>
      </div>

      <ExpensiveList query={local} />
    </>
  );
}

function ContextControls() {
  const { query, setQuery, theme, setTheme } = useContext(FilterContext);
  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="query (context)" />
      <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>toggle theme</button>
      <ContextConsumerA />
      <ContextConsumerB />
    </>
  );
}
