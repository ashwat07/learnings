import { useState, useMemo, useCallback, useDeferredValue, useTransition, memo, useRef, useEffect } from 'react';
import { useRenderCount, burn } from '../lib/instrument.js';
import { makeRows } from '../lib/data.js';

/**
 * Render performance, with the four questions in order:
 *
 *   1. Is it rendering more than it needs to?      → memo, keys, context shape
 *   2. Is each render expensive?                    → useMemo, virtualization, less work
 *   3. Is the work blocking input?                  → transitions, deferred values
 *   4. Is memoising costing more than it saves?     → measure, because it often is
 */

const ALL = makeRows(5000);

// ---------------------------------------------------------------------------
// A row, memoised. The memo only pays off if its props are stable — which is what the
// "unstable callback" toggle demonstrates.
// ---------------------------------------------------------------------------

const Row = memo(function Row({ row, selected, onSelect, cost }) {
  useRenderCount('Row');
  if (cost) burn(cost);
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => onSelect(row.id)}>
      <span>{row.id}</span>
      <span>{row.name}</span>
      <span>{row.team}</span>
      <span>{row.status}</span>
      <span>{row.score}</span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Virtualization: render the rows in the viewport, not the 5,000 in the array.
// ---------------------------------------------------------------------------

function Virtualized({ rows, rowHeight = 27, height = 420, render }) {
  const [scrollTop, setScrollTop] = useState(0);
  const total = rows.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
  const visible = Math.ceil(height / rowHeight) + 10;
  const slice = rows.slice(start, start + visible);

  return (
    <div className="rows" style={{ height, overflow: 'auto' }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: total, position: 'relative' }}>
        <div style={{ transform: `translateY(${start * rowHeight}px)` }}>
          {slice.map(render)}
        </div>
      </div>
    </div>
  );
}

export function RenderPerf() {
  useRenderCount('RenderPerf');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [count, setCount] = useState(500);
  const [rowCost, setRowCost] = useState(0);
  const [useMemoisation, setUseMemoisation] = useState(true);
  const [stableCallback, setStableCallback] = useState(true);
  const [virtualize, setVirtualize] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const [isPending, startTransition] = useTransition();

  // The whole point of the toggle: an inline arrow is a NEW function every render, so every
  // memoised Row sees a changed prop and re-renders. memo() plus an unstable prop is memo()
  // plus overhead and no benefit — the most common way React memoisation is wasted.
  const stable = useCallback((id) => setSelected(id), []);
  const onSelect = stableCallback ? stable : (id) => setSelected(id);

  // useDeferredValue lets the input stay responsive while the expensive list catches up.
  const deferredQuery = useDeferredValue(query);
  const effectiveQuery = deferred ? deferredQuery : query;

  const filtered = useMemo(() => {
    burn(4);                                    // the filter is deliberately not free
    return ALL.slice(0, count).filter((r) => !effectiveQuery || r.name.includes(effectiveQuery));
  }, [effectiveQuery, count]);

  const renderRow = (row) => (useMemoisation
    ? <Row key={row.id} row={row} selected={row.id === selected} onSelect={onSelect} cost={rowCost} />
    : <UnmemoisedRow key={row.id} row={row} selected={row.id === selected} onSelect={onSelect} cost={rowCost} />);

  return (
    <>
      <div className="panel">
        <h2>controls</h2>
        <div className="toolbar">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="filter…" />
          <label>rows
            <select value={count} onChange={(e) => startTransition(() => setCount(Number(e.target.value)))}>
              {[100, 500, 2000, 5000].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label>ms per row
            <select value={rowCost} onChange={(e) => setRowCost(Number(e.target.value))}>
              {[0, 0.2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className="toolbar">
          <label><input type="checkbox" checked={useMemoisation} onChange={(e) => setUseMemoisation(e.target.checked)} /> memo() the rows</label>
          <label><input type="checkbox" checked={stableCallback} onChange={(e) => setStableCallback(e.target.checked)} /> stable onSelect (useCallback)</label>
          <label><input type="checkbox" checked={virtualize} onChange={(e) => setVirtualize(e.target.checked)} /> virtualize</label>
          <label><input type="checkbox" checked={deferred} onChange={(e) => setDeferred(e.target.checked)} /> useDeferredValue</label>
          {isPending && <span className="badge-count">transition pending…</span>}
        </div>
        <p className="hint">
          Watch the <b>Row</b> count in the tally. Uncheck “stable onSelect” with memo() still on:
          every row re-renders on every keystroke, because the callback prop is a new function each
          time. That is memo() paying its cost and buying nothing.
        </p>
      </div>

      <div className="panel">
        <h2>{filtered.length} rows {virtualize ? '(virtualized)' : '(all mounted)'}</h2>
        <div className="row head"><span>id</span><span>name</span><span>team</span><span>status</span><span>score</span></div>
        {virtualize
          ? <Virtualized rows={filtered} render={renderRow} />
          : <div className="rows">{filtered.map(renderRow)}</div>}
      </div>

      <KeyDemo />
    </>
  );
}

const UnmemoisedRow = function UnmemoisedRow({ row, selected, onSelect, cost }) {
  useRenderCount('Row(unmemoised)');
  if (cost) burn(cost);
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => onSelect(row.id)}>
      <span>{row.id}</span><span>{row.name}</span><span>{row.team}</span>
      <span>{row.status}</span><span>{row.score}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Keys: the correctness bug that looks like a rendering bug.
// ---------------------------------------------------------------------------

function KeyDemo() {
  const [items, setItems] = useState(() => makeRows(5));
  const [useIndexKeys, setUseIndexKeys] = useState(true);

  const prepend = () => setItems((prev) => [{ ...makeRows(1)[0], id: Date.now(), name: `new-${prev.length}` }, ...prev]);

  return (
    <div className="panel">
      <h2>keys</h2>
      <div className="toolbar">
        <button onClick={prepend}>prepend a row</button>
        <label><input type="checkbox" checked={useIndexKeys} onChange={(e) => setUseIndexKeys(e.target.checked)} /> use array index as key</label>
      </div>
      <p className="hint">
        Type into a row’s input, then prepend. With index keys the text stays with the POSITION
        rather than the row — React reuses the component instance and only patches the props it
        thinks changed. With stable ids it follows the row, which is what you meant.
      </p>
      <div className="rows">
        {items.map((row, i) => (
          <KeyRow key={useIndexKeys ? i : row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function KeyRow({ row }) {
  const [note, setNote] = useState('');
  const mounted = useRef(0);
  useEffect(() => { mounted.current++; }, []);
  return (
    <div className="row">
      <span>{row.id}</span>
      <span>{row.name}</span>
      <span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="type…" size={8} /></span>
      <span>{row.team}</span>
      <span className="hint">mounts: {mounted.current}</span>
    </div>
  );
}
