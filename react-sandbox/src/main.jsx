import { StrictMode, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { renderLog } from './lib/instrument.js';
import { ROUTES } from './routes/index.js';

/**
 * A deliberately tiny shell. Each lab is a route; the shell provides the render tally so every
 * lab can answer "how much did that click re-render?" without extra wiring.
 *
 * StrictMode is ON on purpose: it double-invokes renders and effects in development, which
 * surfaces missing cleanup and impure renders immediately (see hydration-strategies lab 05).
 * If a lab's numbers look doubled, that is why — and it is the honest number to think about.
 */
function RenderTally() {
  const counts = useSyncExternalStore(
    (cb) => renderLog.subscribe(cb),
    () => renderLog.counts,
  );
  const entries = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <div className="panel">
      <h2>render tally <button onClick={() => renderLog.reset()}>reset</button></h2>
      <div>
        <span className="stat">total <b>{[...counts.values()].reduce((a, b) => a + b, 0)}</b></span>
        {entries.map(([name, n]) => (
          <span className="stat" key={name}>{name} <b className="render-count">{n}</b></span>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || Object.keys(ROUTES)[0]);
  addEventListener('hashchange', () => setRoute(location.hash.slice(1) || Object.keys(ROUTES)[0]));
  const Route = ROUTES[route]?.component ?? (() => <p>unknown route</p>);

  return (
    <>
      <div className="lab-header">
        <h1>React sandbox</h1>
        <p className="hint">
          One app, several courses. StrictMode is on, so renders and effects are double-invoked in
          dev — that is deliberate.
        </p>
      </div>
      <div className="toolbar">
        {Object.entries(ROUTES).map(([key, r]) => (
          <a href={`#${key}`} key={key}>
            <button aria-pressed={route === key}>{r.title}</button>
          </a>
        ))}
      </div>
      <RenderTally />
      <Route />
    </>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
