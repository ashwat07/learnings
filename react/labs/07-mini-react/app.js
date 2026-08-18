// Lab 07 — a todo app running on the mini React, plus the demonstrations.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';
import { h, render, useState, useReducer, useEffect, useRef, useMemo, trace } from './mini-react.js';

const log = new Log('#log');
const out = $('out');

// ---------------------------------------------------------------------------
// A real app, on the real mini renderer. Written with h() because there is no build step —
// this is exactly what JSX would compile to.
// ---------------------------------------------------------------------------

let nextId = 4;
const initialTodos = [
  { id: 1, text: 'read mini-react.js', done: true },
  { id: 2, text: 'break it on purpose', done: false },
  { id: 3, text: 'explain fibers to someone', done: false },
];

function todosReducer(state, action) {
  switch (action.type) {
    case 'add': return [...state, { id: nextId++, text: action.text, done: false }];
    case 'toggle': return state.map((t) => (t.id === action.id ? { ...t, done: !t.done } : t));
    case 'remove': return state.filter((t) => t.id !== action.id);
    case 'shuffle': return [...state].reverse();
    default: return state;
  }
}

function Todo({ todo, onToggle, onRemove }) {
  // Local state per item, so reconciliation mistakes are VISIBLE: this note belongs to the row,
  // and if keys are wrong it will follow the position instead.
  const [note, setNote] = useState('');
  const mounts = useRef(0);
  useEffect(() => { mounts.current += 1; }, []);
  return h('div', { className: `todo${todo.done ? ' done' : ''}` },
    h('input', { type: 'checkbox', checked: todo.done, onClick: () => onToggle(todo.id) }),
    h('span', null, todo.text),
    h('input', { type: 'text', value: note, placeholder: 'a note…', size: 10,
      oninput: (e) => setNote(e.target.value) }),
    h('span', { className: 'hint' }, ` mounts: ${mounts.current}`),
    h('button', { onClick: () => onRemove(todo.id) }, '×'),
  );
}

function App() {
  const [todos, dispatch] = useReducer(todosReducer, initialTodos);
  const [draft, setDraft] = useState('');
  const [useIndexKeys, setUseIndexKeys] = useState(false);
  const remaining = useMemo(() => todos.filter((t) => !t.done).length, [todos]);

  useEffect(() => {
    document.title = `${remaining} left — mini React`;
    return () => { document.title = 'Lab 07 — Write a mini React'; };
  }, [remaining]);

  return h('div', null,
    h('h3', null, `todos (${remaining} left)`),
    h('div', { className: 'toolbar' },
      h('input', { type: 'text', value: draft, placeholder: 'new todo',
        oninput: (e) => setDraft(e.target.value) }),
      h('button', { onClick: () => { if (draft.trim()) { dispatch({ type: 'add', text: draft }); setDraft(''); } } }, 'add'),
      h('button', { onClick: () => dispatch({ type: 'shuffle' }) }, 'reverse the list'),
      h('label', null,
        h('input', { type: 'checkbox', checked: useIndexKeys, onClick: () => setUseIndexKeys(!useIndexKeys) }),
        ' use index as key'),
    ),
    ...todos.map((todo, i) => h(Todo, {
      key: useIndexKeys ? i : todo.id,
      todo,
      onToggle: (id) => dispatch({ type: 'toggle', id }),
      onRemove: (id) => dispatch({ type: 'remove', id }),
    })),
  );
}

render(h(App, null), $('#app'));
log.ok('mini React mounted a todo app — type in it, then press "trace a render"');

// ---------------------------------------------------------------------------

on('trace', () => {
  renderTable('#results', trace.map((t, i) => ({ '#': i + 1, work: t })), { columns: ['#', 'work'] });
  out.textContent =
    'That is the work list from the LAST render — every component re-rendered and every fiber\n' +
    'created, updated or deleted.\n\n' +
    'Do something in the app and press this again. Two things to notice:\n\n' +
    '  · A STATE CHANGE ANYWHERE IN <App> RE-RENDERS EVERY CHILD. There is no memo in this\n' +
    '    implementation, so every Todo function is called again — exactly like real React without\n' +
    '    React.memo. "Re-render" means "the function ran", not "the DOM changed".\n' +
    '  · MOST OF THOSE ARE "update", NOT "create". Reconciliation matched the old fiber and reused\n' +
    '    its DOM node and its hook state; only the changed attributes were written. That gap between\n' +
    '    "the component re-rendered" and "the DOM was touched" is the whole point of a virtual DOM.\n\n' +
    'The two phases are separate in the code: performUnitOfWork builds the entire tree and touches\n' +
    'nothing, then commitRoot writes to the DOM in one pass. That separation is what makes\n' +
    'interruptible rendering possible in real React — you can abandon a half-built tree because\n' +
    'nothing has been committed yet.';
});

on('keys', () => {
  out.textContent =
    'DO THIS, in order:\n' +
    '  1. Type a note into the FIRST todo.\n' +
    '  2. Leave "use index as key" UNCHECKED and press "reverse the list".\n' +
    '     → the note follows its row. Reconciliation matched by key, so the fiber (and its useState)\n' +
    '       moved with the item.\n' +
    '  3. Now CHECK "use index as key" and reverse again.\n' +
    '     → the note stays in position 1 and now belongs to a different todo. The fiber at index 0\n' +
    '       was matched to the element at index 0, so its hook state stayed put while its props\n' +
    '       changed underneath it.\n\n' +
    'Read reconcileChildren() in mini-react.js — it is 40 lines and the key handling is four of\n' +
    'them:\n\n' +
    '  if (element.key != null) match = oldByKey.get(element.key);   // matched by KEY\n' +
    '  else if (oldFiber?.key == null) match = oldFiber;             // matched by POSITION\n\n' +
    'That is the entire mechanism behind every keys bug you have seen. A key is not an optimisation\n' +
    'hint; it is the IDENTITY of the element, and it decides which fiber — and therefore which state\n' +
    'and which DOM node — the element continues.\n\n' +
    'Also notice the "mounts" counter never increments on reorder in either mode: the component was\n' +
    'REUSED, not remounted. That is why index keys corrupt state instead of resetting it, which is\n' +
    'much harder to notice.';
});

on('hooks', () => {
  renderTable('#results', [
    { fact: 'hooks live on the fiber', detail: 'wipFiber.hooks is an array — see updateFunctionComponent' },
    { fact: 'hookIndex resets to 0 per render', detail: 'so the Nth call reads the Nth slot' },
    { fact: 'there are no names', detail: 'nothing associates a hook with a variable — only its POSITION' },
    { fact: 'a conditional hook shifts every later slot', detail: 'useState reads useEffect\'s state and vice versa' },
    { fact: 'the lint rule is load-bearing', detail: 'react-hooks/rules-of-hooks is not style advice' },
  ], { columns: ['fact', 'detail'] });
  out.textContent =
    'THE RULES OF HOOKS ARE NOT A CONVENTION — they are a consequence of the data structure.\n\n' +
    'Look at useReducer in mini-react.js:\n\n' +
    '  const old = wipFiber.alternate?.hooks?.[hookIndex];   // read slot N\n' +
    '  wipFiber.hooks.push(hook);                            // write slot N\n' +
    '  hookIndex++;\n\n' +
    'The ONLY thing linking a hook call to its stored state is the counter. There is no name, no\n' +
    'key, no identity. So:\n\n' +
    '  if (props.enabled) { const [a] = useState(1); }   // slot 0 exists on some renders only\n' +
    '  const [b] = useState(2);                          // slot 0 or 1, depending\n\n' +
    'On the render where the condition flips, `b` reads the state that belonged to `a`. Real React\n' +
    'detects the count changing and throws "Rendered fewer hooks than expected", which is a much\n' +
    'better outcome than the silent corruption this implementation would give you.\n\n' +
    'And it explains two more things:\n' +
    '  · WHY CUSTOM HOOKS COMPOSE FOR FREE. A custom hook is just a function that calls hooks, so\n' +
    '    its slots are allocated inline in the caller\'s list. Nothing special is needed.\n' +
    '  · WHY YOU CANNOT CALL A HOOK FROM A CALLBACK OR AN EVENT HANDLER. wipFiber is only set during\n' +
    '    a render; outside one there is no fiber to store the slot on.';
});

on('effects', () => {
  out.textContent =
    'THE ORDER PER COMMIT, from the code:\n\n' +
    '  1. render phase   — every component function runs, building a new fiber tree. NOTHING is\n' +
    '                      written to the DOM. Effects are only QUEUED (see useEffect).\n' +
    '  2. commit phase   — deletions, then placements and updates. The DOM now matches the tree.\n' +
    '  3. effects        — for each changed effect: run the PREVIOUS cleanup, then the new effect.\n\n' +
    'Three consequences worth carrying into real React:\n\n' +
    '  · CLEANUP RUNS BEFORE THE NEXT EFFECT, not only on unmount. An effect with [query] in its\n' +
    '    deps cleans up the old subscription before subscribing to the new one — which is why\n' +
    '    returning a cleanup is the correct way to avoid a race, not an optional tidiness.\n' +
    '  · UNMOUNTING RUNS EVERY CLEANUP IN THE SUBTREE. See runCleanups() in commitDeletion: it walks\n' +
    '    the removed fibers depth-first. Delete a todo and its effect cleanup runs.\n' +
    '  · AN EFFECT CANNOT SEE THE DOM IT IS ABOUT TO CREATE, but it CAN see the DOM it just created.\n' +
    '    That is the difference between putting a measurement in the render body (wrong, and it\n' +
    '    forces a layout mid-render) and in an effect (right).\n\n' +
    'What this mini version does NOT model: useLayoutEffect (which would run inside step 2, before\n' +
    'the browser paints) and the double-invocation of effects in StrictMode, which exists precisely\n' +
    'to surface a missing cleanup.';
});

on('compare', () => {
  renderTable('#results', [
    { feature: 'elements, fibers, reconciliation by key', mini: 'yes', real: 'yes, plus a much cleverer diff' },
    { feature: 'two-phase render/commit', mini: 'yes', real: 'yes — and this is what enables the rest' },
    { feature: 'useState / useReducer / useRef / useMemo', mini: 'yes', real: 'yes' },
    { feature: 'useEffect with cleanup', mini: 'yes', real: 'yes, plus useLayoutEffect and useInsertionEffect' },
    { feature: 'batching', mini: 'one microtask', real: 'priority lanes' },
    { feature: 'interruptible rendering', mini: 'NO — the loop runs to completion', real: 'the scheduler yields between units of work' },
    { feature: 'priorities / transitions', mini: 'no', real: 'lanes: urgent, transition, idle' },
    { feature: 'Suspense & streaming SSR', mini: 'no', real: 'yes' },
    { feature: 'context, portals, error boundaries', mini: 'no', real: 'yes' },
    { feature: 'synthetic events & delegation', mini: 'raw addEventListener', real: 'one root listener, pooled semantics' },
    { feature: 'memo / bailout on unchanged props', mini: 'no — everything re-renders', real: 'yes' },
    { feature: 'concurrent-safe external stores', mini: 'n/a', real: 'useSyncExternalStore' },
  ], { columns: ['feature', 'mini', 'real'] });
  out.textContent =
    'The row that matters most is INTERRUPTIBLE RENDERING, because everything else in modern React\n' +
    'follows from it.\n\n' +
    'This implementation has `while (next) next = performUnitOfWork(next)` — a loop that cannot be\n' +
    'paused. Real React yields between units of work, which lets it:\n' +
    '  · keep the page responsive while rendering a large tree\n' +
    '  · ABANDON a half-built tree when a more urgent update arrives (that is what a transition is)\n' +
    '  · render at different priorities in the same tick\n\n' +
    'And it is also the source of the one genuinely new bug: TEARING. If rendering can pause, an\n' +
    'external value can change mid-pass and two components in one commit can see different values.\n' +
    'That is why useSyncExternalStore exists and why every store library rewrote its subscription\n' +
    'layer for React 18. See the #concurrent route of the React sandbox.\n\n' +
    'The point of building this is not that you now have a framework. It is that "why did this\n' +
    're-render", "why is my state wrong after a reorder", "why must hooks be unconditional" and\n' +
    '"why does my effect run twice" all have mechanical answers you can now point at in 260 lines.';
});

on('clear', () => log.clear());
