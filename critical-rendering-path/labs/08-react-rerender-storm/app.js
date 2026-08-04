// Lab 08 — React re-render storm.
//
// This file is deliberately full of realistic mistakes. Every one of them is something you
// will find in a real codebase written by competent people in a hurry.
//
// Your job: fix them ONE AT A TIME, measuring after each. The TODO list is at the bottom.

PerfHUD.start();

const { createElement: h, useState, useMemo, useCallback, memo, useRef, useEffect } = React;

const CARD_COUNT = 10000;

// ---------------------------------------------------------------------------
// Data — generated once, deterministic.
// ---------------------------------------------------------------------------
function seeded(i) { return ((i * 2654435761) % 100000) / 100000; }
const DATA = Array.from({ length: CARD_COUNT }, (_, i) => ({
  id: i,
  name: `service-${i.toString(36)}`,
  region: ['us-east', 'eu-west', 'ap-south', 'sa-east'][i % 4],
  latency: Math.round(seeded(i) * 400),
  errors: Math.round(seeded(i + 7) * 50),
}));

// ---------------------------------------------------------------------------
// A render counter, so the cost is visible without opening a panel.
// ---------------------------------------------------------------------------
const renders = { App: 0, CardList: 0, Card: 0, Toolbar: 0 };
function countRender(name) { renders[name]++; }

function RenderReadout() {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 400);
    return () => clearInterval(id);
  }, []);
  return h('pre', { className: 'readout' },
    `renders — App: ${renders.App}  Toolbar: ${renders.Toolbar}  ` +
    `CardList: ${renders.CardList}  Card: ${renders.Card.toLocaleString()}\n` +
    `cards mounted: ${CARD_COUNT.toLocaleString()}   ` +
    `worst frame: ${PerfHUD.stats.worstEver.toFixed(1)}ms   ` +
    `long tasks: ${PerfHUD.stats.longTasks}`);
}

// ---------------------------------------------------------------------------
// PROBLEM 1 — not memoized. Every App render re-runs this 10,000 times.
// PROBLEM 2 — inline style object: a fresh reference on every render, so React.memo
//             would be defeated even if you added it.
// PROBLEM 3 — inline arrow prop: same problem.
// ---------------------------------------------------------------------------
function Card({ item, query, onPick }) {
  countRender('Card');
  const hit = query && item.name.includes(query);
  return h('div', {
    className: 'card' + (hit ? ' hit' : ''),
    onClick: () => onPick(item.id),                       // PROBLEM 3
    style: { opacity: query && !hit ? 0.35 : 1 },         // PROBLEM 2
  },
    h('h3', null, item.name),
    h('div', { className: 'meta' }, `${item.region} · ${item.latency}ms · ${item.errors} err`),
    h('div', { className: 'bar', style: { width: item.latency / 2 + 'px' } })
  );
}

function CardList({ items, query, onPick }) {
  countRender('CardList');
  return h('div', { id: 'cards' },
    items.map(item => h(Card, { key: item.id, item, query, onPick })));
}

function Toolbar({ query, onQuery, sortKey, onSort, picked }) {
  countRender('Toolbar');
  return h('div', { className: 'controls' },
    h('label', null, 'search ',
      h('input', {
        type: 'search', value: query, placeholder: 'try typing "service-1"',
        onChange: e => onQuery(e.target.value),
      })),
    h('label', null, 'sort ',
      h('select', { value: sortKey, onChange: e => onSort(e.target.value) },
        h('option', { value: 'id' }, 'id'),
        h('option', { value: 'latency' }, 'latency'),
        h('option', { value: 'errors' }, 'errors'))),
    h('span', { className: 'hint' }, picked == null ? 'nothing picked' : `picked #${picked}`)
  );
}

function App() {
  countRender('App');

  // PROBLEM 4 — the query lives at the top of the tree, so every keystroke re-renders
  //             everything below it. This is the big one.
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('id');
  const [picked, setPicked] = useState(null);

  // PROBLEM 5 — an expensive derived value, recomputed on every render including
  //             every keystroke, even though `query` doesn't affect the sort at all.
  const sorted = [...DATA].sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : -1));

  return h('div', null,
    h(Toolbar, {
      query,
      onQuery: setQuery,
      sortKey,
      onSort: setSortKey,
      picked,
    }),
    h(RenderReadout),
    h(CardList, {
      items: sorted,
      query,
      onPick: id => setPicked(id),      // PROBLEM 3 again, at the top of the tree
    })
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
document.getElementById('out').textContent =
  'Type in the search box. Then read the TODO list at the bottom of app.js.';

// ---------------------------------------------------------------------------
// TODO — in this order, measuring after EACH step. Record the numbers in README.md.
//
// [ ] 1. Stable props. Hoist the inline style objects out (or derive a class instead of a
//        style), and wrap onPick in useCallback.
//        keystroke → paint before: ____ms   after: ____ms
//
// [ ] 2. useMemo the sort, keyed on sortKey only.
//        before: ____ms   after: ____ms
//
// [ ] 3. Wrap Card in React.memo. Then VERIFY with the Profiler that Card actually stopped
//        rendering. If it didn't, a prop is still unstable — find which one.
//        Card renders per keystroke before: ______  after: ______
//
// [ ] 4. State splitting. Move the search state into its own component so a keystroke
//        re-renders one subtree, not the app. Compare with step 3: which bought more?
//        before: ____ms   after: ____ms
//
// [ ] 5. Virtualize the list (reuse what you built in Lab 05). Now ask: do you still need
//        the React.memo from step 3? Delete it and measure. Be honest.
//
// [ ] 6. useDeferredValue for the filter, so the input never lags behind the list.
//        Then answer: did this make the WORK smaller, or just reorder it?
//
// [ ] 7. Remove every memoization that a measurement did not justify. List what you removed:
//        ________________________________________________
//
// [ ] 8. Finally: switch the CDN scripts to the production builds
//        (react.production.min.js / react-dom.production.min.js) and re-measure the
//        BROKEN version. How much of the original slowness was the dev build? This is why
//        you never quote absolute numbers from a development build.
// ---------------------------------------------------------------------------
