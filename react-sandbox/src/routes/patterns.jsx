import { createContext, useContext, useState, useId, useMemo, cloneElement, isValidElement, Children } from 'react';
import { useRenderCount } from '../lib/instrument.js';

/**
 * Component patterns — the API design half of React. Each panel is the same feature built two ways,
 * so the trade is visible rather than asserted.
 */

// ---------------------------------------------------------------------------
// 1. Configuration vs composition.
// ---------------------------------------------------------------------------

function ConfiguredCard({ title, subtitle, badge, badgeColor, footerText, footerAlign, onFooterClick, showDivider }) {
  return (
    <div className="panel" style={{ margin: 0 }}>
      <h3>{title} {badge && <span className="badge-count" style={{ background: badgeColor }}>{badge}</span>}</h3>
      {subtitle && <p className="hint">{subtitle}</p>}
      {showDivider && <hr style={{ borderColor: 'var(--line)' }} />}
      {footerText && <div style={{ textAlign: footerAlign }}><button onClick={onFooterClick}>{footerText}</button></div>}
    </div>
  );
}

function Card({ children }) { return <div className="panel" style={{ margin: 0 }}>{children}</div>; }
Card.Title = function Title({ children }) { return <h3>{children}</h3>; };
Card.Body = function Body({ children }) { return <div>{children}</div>; };
Card.Footer = function Footer({ children }) { return <div className="toolbar">{children}</div>; };

function CompositionPanel() {
  return (
    <div className="panel">
      <h2>1. configuration vs composition</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ConfiguredCard
          title="Configured" subtitle="eight props and counting" badge="3" badgeColor="#5b2f6d"
          footerText="Act" footerAlign="right" onFooterClick={() => {}} showDivider
        />
        <Card>
          <Card.Title>Composed</Card.Title>
          <Card.Body><p className="hint">anything at all goes here</p></Card.Body>
          <Card.Footer><button>Act</button><button>Or two</button></Card.Footer>
        </Card>
      </div>
      <p className="hint">
        The configured card needs a new prop for every new requirement, and the prop list only ever
        grows. The composed one needs nothing — a caller who wants two footer buttons, or an icon in
        the title, just writes it.
      </p>
      <p className="hint">
        The rule: <b>if a prop exists only to be passed into a slot, make it a slot.</b> Configuration
        is right when the set of options is genuinely closed and you want to constrain callers
        (a Button&apos;s <code>variant</code>); composition is right when it is open.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Compound components with implicit state.
// ---------------------------------------------------------------------------

const TabsContext = createContext(null);

function Tabs({ defaultValue, children }) {
  const [value, setValue] = useState(defaultValue);
  const id = useId();
  // The value is memoised so consumers do not re-render on every parent render — see the
  // architecture-and-state course on context invalidation granularity.
  const ctx = useMemo(() => ({ value, setValue, id }), [value, id]);
  return <TabsContext.Provider value={ctx}>{children}</TabsContext.Provider>;
}
function useTabs(component) {
  const ctx = useContext(TabsContext);
  // A clear error beats `undefined is not an object` three components deep.
  if (!ctx) throw new Error(`<${component}> must be rendered inside <Tabs>`);
  return ctx;
}
Tabs.List = function List({ children }) {
  useTabs('Tabs.List');
  return <div className="toolbar" role="tablist">{children}</div>;
};
Tabs.Tab = function Tab({ value, children }) {
  const ctx = useTabs('Tabs.Tab');
  const selected = ctx.value === value;
  return (
    <button role="tab" aria-selected={selected} aria-controls={`${ctx.id}-${value}`}
      id={`${ctx.id}-tab-${value}`} tabIndex={selected ? 0 : -1}
      onClick={() => ctx.setValue(value)}>{children}</button>
  );
};
Tabs.Panel = function Panel({ value, children }) {
  const ctx = useTabs('Tabs.Panel');
  if (ctx.value !== value) return null;
  return <div role="tabpanel" id={`${ctx.id}-${value}`} aria-labelledby={`${ctx.id}-tab-${value}`}>{children}</div>;
};

function CompoundPanel() {
  return (
    <div className="panel">
      <h2>2. compound components</h2>
      <Tabs defaultValue="a">
        <Tabs.List>
          <Tabs.Tab value="a">First</Tabs.Tab>
          <Tabs.Tab value="b">Second</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="a"><p className="hint">Panel A</p></Tabs.Panel>
        <Tabs.Panel value="b"><p className="hint">Panel B</p></Tabs.Panel>
      </Tabs>
      <p className="hint">
        The parts share state through context, so the caller never wires anything up — and because
        the ids come from <code>useId</code>, the ARIA relationships are correct without the caller
        knowing they exist. That is the strongest argument for this pattern: <b>accessibility is
        handled once, in the component, rather than by every consumer</b> (accessibility lab 06).
      </p>
      <p className="hint">
        Note <code>useTabs()</code> throwing a named error. A compound component with an implicit
        contract needs a loud failure when the contract is broken; otherwise a misplaced
        <code>&lt;Tabs.Tab&gt;</code> is a blank screen and an hour of debugging.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Controlled, uncontrolled, and the hybrid every library ships.
// ---------------------------------------------------------------------------

function useControllableState({ value, defaultValue, onChange }) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : uncontrolled;
  const set = (next) => {
    if (!isControlled) setUncontrolled(next);
    onChange?.(next);
  };
  return [current, set];
}

function Toggle({ value, defaultValue = false, onChange, label }) {
  const [on, setOn] = useControllableState({ value, defaultValue, onChange });
  return <button aria-pressed={on} onClick={() => setOn(!on)}>{label}: {on ? 'on' : 'off'}</button>;
}

function ControllablePanel() {
  const [controlled, setControlled] = useState(true);
  return (
    <div className="panel">
      <h2>3. controlled / uncontrolled / both</h2>
      <div className="toolbar">
        <Toggle label="uncontrolled" defaultValue />
        <Toggle label="controlled" value={controlled} onChange={setControlled} />
        <button onClick={() => setControlled((c) => !c)}>set from outside</button>
      </div>
      <p className="hint">
        <code>useControllableState</code> is about ten lines and it is what every serious component
        library ships. The rule it encodes: <b>the prop being <code>undefined</code> means
        uncontrolled</b>, which is why you must never pass <code>value={'{'}undefined{'}'}</code> to
        mean &quot;empty&quot; — you have silently switched modes.
      </p>
      <p className="hint">
        React&apos;s own warning about switching a controlled input to uncontrolled is exactly this
        bug, and it is nearly always caused by <code>value={'{'}data?.field{'}'}</code> before the
        data arrives. Use <code>?? &apos;&apos;</code>.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Render props → hooks, and what remains of the old patterns.
// ---------------------------------------------------------------------------

function MouseTracker({ children }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  return (
    <div onPointerMove={(e) => setPos({ x: Math.round(e.clientX), y: Math.round(e.clientY) })}
      style={{ padding: 12, border: '1px dashed var(--line)', borderRadius: 8 }}>
      {children(pos)}
    </div>
  );
}

function withLogging(Component, name) {
  // A higher-order component. Note the displayName and the ref forwarding you have to remember.
  const Wrapped = (props) => { useRenderCount(`HOC:${name}`); return <Component {...props} />; };
  Wrapped.displayName = `withLogging(${name})`;
  return Wrapped;
}
const LoggedButton = withLogging(function Btn({ children }) { return <button>{children}</button>; }, 'Btn');

function PatternsHistory() {
  return (
    <div className="panel">
      <h2>4. render props &amp; HOCs</h2>
      <MouseTracker>{(pos) => <span className="stat">pointer <b>{pos.x}, {pos.y}</b></span>}</MouseTracker>
      <div className="toolbar"><LoggedButton>an HOC-wrapped button</LoggedButton></div>
      <p className="hint">
        Hooks replaced both for <b>sharing logic</b> — that is what they were designed for. What
        render props still do better is <b>sharing logic that must be tied to a piece of JSX</b>:
        a virtualized list that gives you an index, a form field that gives you props to spread, a
        drop zone that needs to own its element.
      </p>
      <p className="hint">
        HOCs survive mostly at framework boundaries (<code>connect</code>, <code>memo</code>,
        <code>forwardRef</code>). Their costs are real: an extra layer in the tree, lost static
        typing unless you work at it, a wrapper name in the devtools, and ref forwarding you have to
        remember. Prefer a hook; reach for an HOC when you must wrap a component you do not control.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Headless: logic without markup.
// ---------------------------------------------------------------------------

function useDisclosure({ defaultOpen = false } = {}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return {
    open,
    getTriggerProps: () => ({
      'aria-expanded': open,
      'aria-controls': id,
      onClick: () => setOpen((o) => !o),
    }),
    getContentProps: () => ({ id, hidden: !open }),
  };
}

function HeadlessPanel() {
  const d = useDisclosure();
  return (
    <div className="panel">
      <h2>5. headless components</h2>
      <button {...d.getTriggerProps()}>Details</button>
      <div {...d.getContentProps()}><p className="hint">Content, styled entirely by the caller.</p></div>
      <p className="hint">
        The hook owns <b>state, behaviour and accessibility</b>; the caller owns <b>markup and
        styles</b>. That split is why Radix, Headless UI, TanStack Table and React Aria are shaped
        this way — the hard, easily-got-wrong part is reusable, and the part every design system
        wants to control is not.
      </p>
      <p className="hint">
        The prop-getter convention (<code>getTriggerProps()</code>) exists so the library can add
        attributes later without a breaking change, and so callers can merge their own handlers.
        A good getter takes user props and composes them rather than overwriting.
      </p>
    </div>
  );
}

export function Patterns() {
  useRenderCount('PatternsRoute');
  void cloneElement; void isValidElement; void Children;
  return (
    <>
      <CompositionPanel />
      <CompoundPanel />
      <ControllablePanel />
      <PatternsHistory />
      <HeadlessPanel />
    </>
  );
}
