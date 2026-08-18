/**
 * mini-react.js — a working React, small enough to read in one sitting.
 *
 * What is real here:
 *   · createElement and a virtual DOM of plain objects
 *   · a FIBER tree kept between renders (alternate/current), so state has somewhere to live
 *   · reconciliation by TYPE and KEY, with placement, update and deletion
 *   · a two-phase commit: build the whole tree, THEN touch the DOM once
 *   · hooks stored as a LIST on the fiber, which is why order matters
 *   · useState / useReducer / useEffect (with cleanup) / useRef / useMemo / useCallback
 *   · batching: several setState calls in one tick produce one render
 *
 * What is deliberately missing, and named at the bottom of the lab: concurrency and time-slicing,
 * priorities, Suspense, context, portals, error boundaries, event delegation, SSR, and about
 * fifteen years of edge cases.
 */

// ---------------------------------------------------------------------------
// 1. Elements. JSX compiles to exactly this.
// ---------------------------------------------------------------------------

export function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.flat(Infinity)
        .filter((c) => c !== null && c !== undefined && c !== false)
        .map((c) => (typeof c === 'object' ? c : createTextElement(c))),
    },
    key: props?.key ?? null,
  };
}

function createTextElement(text) {
  return { type: 'TEXT', props: { nodeValue: String(text), children: [] }, key: null };
}

/** `h('div', {}, 'hi')` — the same thing JSX produces, written by hand. */
export const h = createElement;

// ---------------------------------------------------------------------------
// 2. The fiber tree.
//
// A fiber is a node of work: the element, the DOM node it produced, its position in the tree, and
// — crucially — the HOOK STATE that survives between renders. `alternate` points at the fiber from
// the previous render, which is how state is carried forward.
// ---------------------------------------------------------------------------

let rootFiber = null;        // the fiber currently being built
let currentRoot = null;      // the last committed fiber tree
let deletions = null;        // fibers to remove during commit
export const trace = [];     // a log of what the renderer did, for the lab UI

export function render(element, container) {
  rootFiber = {
    dom: container,
    props: { children: [element] },
    alternate: currentRoot,
  };
  deletions = [];
  performWork();
}

let scheduled = false;
function scheduleRender() {
  // BATCHING: many setState calls in one tick collapse into a single render, because we only ever
  // queue one microtask. This is the whole of React's automatic batching, in four lines.
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    rootFiber = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    };
    deletions = [];
    performWork();
  });
}

function performWork() {
  trace.length = 0;
  let next = rootFiber;
  // The RENDER PHASE. Real React can pause here between units of work; we run it to completion.
  while (next) next = performUnitOfWork(next);
  commitRoot();
}

function performUnitOfWork(fiber) {
  if (fiber.type instanceof Function) updateFunctionComponent(fiber);
  else updateHostComponent(fiber);

  // Depth-first: child, then sibling, then back up to the parent's sibling.
  if (fiber.child) return fiber.child;
  let next = fiber;
  while (next) {
    if (next.sibling) return next.sibling;
    next = next.parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. Hooks. Stored as an ARRAY on the fiber, indexed by call order.
// ---------------------------------------------------------------------------

let wipFiber = null;
let hookIndex = 0;

function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;                       // THE reason hooks must be called unconditionally
  wipFiber.hooks = [];
  trace.push(`render <${fiber.type.name || 'Anonymous'}>`);
  const children = [fiber.type(fiber.props)];
  reconcileChildren(fiber, children);
}

function updateHostComponent(fiber) {
  if (!fiber.dom) fiber.dom = createDom(fiber);
  reconcileChildren(fiber, fiber.props.children);
}

export function useReducer(reducer, initialState) {
  const old = wipFiber.alternate?.hooks?.[hookIndex];
  const hook = { state: old ? old.state : initialState, queue: [] };

  // Apply everything dispatched since the last render, in order.
  for (const action of old ? old.queue : []) hook.state = reducer(hook.state, action);

  const dispatch = (action) => {
    hook.queue.push(action);
    scheduleRender();
  };

  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, dispatch];
}

export function useState(initial) {
  // useState IS useReducer with a reducer that applies a function or takes a value. That is not a
  // simplification for the lab — it is how React implements it.
  return useReducer((state, action) => (action instanceof Function ? action(state) : action),
    initial instanceof Function ? initial() : initial);
}

export function useRef(initial) {
  const old = wipFiber.alternate?.hooks?.[hookIndex];
  const hook = old ?? { current: initial };
  wipFiber.hooks.push(hook);
  hookIndex++;
  return hook;
}

export function useMemo(factory, deps) {
  const old = wipFiber.alternate?.hooks?.[hookIndex];
  const changed = !old || !deps || !old.deps || deps.some((d, i) => !Object.is(d, old.deps[i]));
  const hook = changed ? { value: factory(), deps } : { value: old.value, deps: old.deps };
  wipFiber.hooks.push(hook);
  hookIndex++;
  return hook.value;
}

export const useCallback = (fn, deps) => useMemo(() => fn, deps);

const pendingEffects = [];
export function useEffect(effect, deps) {
  const old = wipFiber.alternate?.hooks?.[hookIndex];
  const changed = !old || !deps || !old.deps || deps.some((d, i) => !Object.is(d, old.deps[i]));
  const hook = { effect, deps, cleanup: old?.cleanup };
  if (changed) {
    // Queued now, RUN AFTER COMMIT — that is the entire difference between useEffect and calling
    // the function during render.
    pendingEffects.push(hook);
  }
  wipFiber.hooks.push(hook);
  hookIndex++;
}

// ---------------------------------------------------------------------------
// 4. Reconciliation — the diff. Keys live here.
// ---------------------------------------------------------------------------

function reconcileChildren(wip, elements) {
  let index = 0;
  let oldFiber = wip.alternate?.child;
  let prevSibling = null;

  // Index the previous children by key, so a keyed child can be MATCHED wherever it moved to.
  const oldByKey = new Map();
  for (let f = oldFiber; f; f = f.sibling) if (f.key != null) oldByKey.set(f.key, f);

  while (index < elements.length || oldFiber) {
    const element = elements[index];
    let match = null;

    if (element?.key != null) {
      match = oldByKey.get(element.key) ?? null;         // matched BY KEY, regardless of position
      if (match) oldByKey.delete(element.key);
    } else if (oldFiber && oldFiber.key == null) {
      match = oldFiber;                                  // matched BY POSITION
    }

    const sameType = match && element && element.type === match.type;

    let newFiber = null;
    if (sameType) {
      // UPDATE: keep the DOM node and the hook state, change the props.
      newFiber = {
        type: match.type, props: element.props, key: element.key,
        dom: match.dom, parent: wip, alternate: match, effectTag: 'UPDATE',
      };
      trace.push(`  update ${describe(element)}${element.key != null ? ` (key=${element.key})` : ''}`);
    } else if (element) {
      // PLACEMENT: a new node. Any state the old one had is gone.
      newFiber = {
        type: element.type, props: element.props, key: element.key,
        dom: null, parent: wip, alternate: null, effectTag: 'PLACEMENT',
      };
      trace.push(`  create ${describe(element)}${element.key != null ? ` (key=${element.key})` : ''}`);
    }
    if (match && !sameType) {
      match.effectTag = 'DELETION';
      deletions.push(match);
      trace.push(`  delete ${describe(match)}`);
    }

    if (oldFiber) oldFiber = oldFiber.sibling;
    if (index === 0) wip.child = newFiber;
    else if (prevSibling) prevSibling.sibling = newFiber;
    if (newFiber) prevSibling = newFiber;
    index++;
  }

  // Anything left in the key map was not re-rendered.
  for (const orphan of oldByKey.values()) {
    orphan.effectTag = 'DELETION';
    deletions.push(orphan);
    trace.push(`  delete ${describe(orphan)} (key=${orphan.key})`);
  }
}

const describe = (f) => (typeof f.type === 'function' ? `<${f.type.name}>` : f.type === 'TEXT' ? `"${String(f.props.nodeValue).slice(0, 14)}"` : `<${f.type}>`);

// ---------------------------------------------------------------------------
// 5. Commit — the only phase that touches the DOM.
// ---------------------------------------------------------------------------

function commitRoot() {
  deletions.forEach((f) => commitDeletion(f, findParentDom(f)));
  commitChildren(rootFiber.dom, rootFiber.child, null);
  currentRoot = rootFiber;
  rootFiber = null;

  // Effects run AFTER the browser has the new DOM. Cleanup of the previous effect runs first.
  const effects = pendingEffects.splice(0);
  for (const hook of effects) {
    if (hook.cleanup) hook.cleanup();
    const cleanup = hook.effect();
    hook.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
  }
}

const findParentDom = (fiber) => {
  let p = fiber.parent;
  while (p && !p.dom) p = p.parent;
  return p?.dom ?? null;
};

/**
 * Commit a run of siblings INTO `parentDom`, in order, keeping an `anchor` — the last DOM node we
 * placed. That anchor is what makes REORDERING work: an updated fiber whose node is not already in
 * the right position is moved with insertBefore.
 *
 * A function component has no DOM node of its own, so its children are committed into the same
 * parent and contribute to the same anchor. React calls this searching for the "host sibling".
 */
function commitChildren(parentDom, firstChild, anchor) {
  let current = anchor;
  for (let fiber = firstChild; fiber; fiber = fiber.sibling) {
    current = commitFiber(fiber, parentDom, current);
  }
  return current;
}

function commitFiber(fiber, parentDom, anchor) {
  if (fiber.effectTag === 'DELETION') { commitDeletion(fiber, parentDom); return anchor; }

  if (!fiber.dom) {
    // A function component: transparent to the DOM tree.
    return commitChildren(parentDom, fiber.child, anchor);
  }

  const expected = anchor ? anchor.nextSibling : parentDom.firstChild;
  if (fiber.dom !== expected) {
    // insertBefore MOVES an existing node, which is exactly what a reorder needs.
    parentDom.insertBefore(fiber.dom, expected);
    if (fiber.effectTag === 'UPDATE') trace.push(`  move ${describe(fiber)}${fiber.key != null ? ` (key=${fiber.key})` : ''}`);
  }
  if (fiber.effectTag === 'UPDATE') updateDom(fiber.dom, fiber.alternate.props, fiber.props);

  commitChildren(fiber.dom, fiber.child, null);
  return fiber.dom;
}

function commitDeletion(fiber, parentDom) {
  // Run every cleanup in the removed subtree — the unmount half of useEffect.
  runCleanups(fiber);
  if (fiber.dom) parentDom?.removeChild(fiber.dom);
  else for (let c = fiber.child; c; c = c.sibling) commitDeletion(c, parentDom);
}

function runCleanups(fiber) {
  if (!fiber) return;
  for (const hook of fiber.hooks ?? []) if (hook.cleanup) hook.cleanup();
  runCleanups(fiber.child);
  runCleanups(fiber.sibling);
}

// ---------------------------------------------------------------------------
// 6. The DOM adapter — the only browser-specific part. Swap this and you have a custom renderer.
// ---------------------------------------------------------------------------

const isEvent = (k) => k.startsWith('on');
const isProperty = (k) => k !== 'children' && k !== 'key' && !isEvent(k);

function createDom(fiber) {
  const dom = fiber.type === 'TEXT' ? document.createTextNode('') : document.createElement(fiber.type);
  updateDom(dom, {}, fiber.props);
  return dom;
}

function updateDom(dom, prev, next) {
  for (const name of Object.keys(prev).filter(isEvent)) {
    if (!(name in next) || prev[name] !== next[name]) dom.removeEventListener(name.toLowerCase().slice(2), prev[name]);
  }
  for (const name of Object.keys(prev).filter(isProperty)) {
    if (!(name in next)) dom[name] = '';
  }
  for (const name of Object.keys(next).filter(isProperty)) {
    if (prev[name] === next[name]) continue;
    if (name === 'style' && typeof next[name] === 'object') Object.assign(dom.style, next[name]);
    else if (name === 'className') dom.setAttribute('class', next[name]);
    else if (name === 'checked' || name === 'value') dom[name] = next[name];
    else dom[name] = next[name];
  }
  for (const name of Object.keys(next).filter(isEvent)) {
    if (prev[name] !== next[name]) dom.addEventListener(name.toLowerCase().slice(2), next[name]);
  }
}
