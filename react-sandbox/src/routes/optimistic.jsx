import { useState, useRef } from 'react';
import { useRenderCount } from '../lib/instrument.js';

/**
 * Optimistic UI, rollback, and conflict resolution — the three things that make a mutation feel
 * instant without lying to the user.
 *
 * The server here is the lab server's /api/flaky, which fails on a schedule. That is the point:
 * optimistic UI is easy when writes succeed.
 */

let nextId = 1000;

export function OptimisticUI() {
  useRenderCount('OptimisticUI');
  const [items, setItems] = useState([{ id: 1, text: 'first item', state: 'synced', rev: 1 }]);
  const [mode, setMode] = useState('optimistic');
  const [failEvery, setFailEvery] = useState(3);
  const [log, setLog] = useState([]);
  const attempt = useRef(0);

  const say = (msg, kind = '') => setLog((l) => [{ msg, kind, at: new Date().toLocaleTimeString() }, ...l].slice(0, 12));

  /** The server: slow, and fails every Nth write. */
  async function saveToServer(item) {
    attempt.current++;
    await new Promise((r) => setTimeout(r, 600));
    if (failEvery > 0 && attempt.current % failEvery === 0) {
      const err = new Error('server rejected the write');
      err.status = 500;
      throw err;
    }
    // The server also bumps the revision — which is how conflicts are detected.
    return { ...item, rev: item.rev + 1, state: 'synced' };
  }

  async function add(text) {
    // The client generates the id. That is what makes a retry idempotent, and it lets the UI
    // render the row before the server has heard of it (browser-storage lab 06, same idea).
    const item = { id: ++nextId, text, state: 'pending', rev: 0 };

    if (mode === 'pessimistic') {
      say(`waiting for the server before showing "${text}"`);
      try {
        const saved = await saveToServer(item);
        setItems((prev) => [...prev, saved]);
        say(`saved "${text}"`, 'good');
      } catch (err) {
        say(`failed: ${err.message} — nothing was shown`, 'bad');
      }
      return;
    }

    // Optimistic: show it now, reconcile later.
    setItems((prev) => [...prev, item]);
    say(`showed "${text}" immediately`);
    try {
      const saved = await saveToServer(item);
      setItems((prev) => prev.map((i) => (i.id === item.id ? saved : i)));
      say(`confirmed "${text}"`, 'good');
    } catch (err) {
      if (mode === 'optimistic') {
        // Rollback: remove it and say so. Silently reverting is worse than not being optimistic.
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        say(`rolled back "${text}": ${err.message}`, 'bad');
      } else {
        // Queue: keep it, marked failed, and offer a retry. Usually the better product.
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, state: 'failed' } : i)));
        say(`kept "${text}" as failed — retry available`, 'bad');
      }
    }
  }

  async function retry(item) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, state: 'pending' } : i)));
    try {
      const saved = await saveToServer(item);
      setItems((prev) => prev.map((i) => (i.id === item.id ? saved : i)));
      say(`retry succeeded for "${item.text}"`, 'good');
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, state: 'failed' } : i)));
      say(`retry failed for "${item.text}"`, 'bad');
    }
  }

  /** Someone else changed the record while you were editing it. */
  async function conflict(item) {
    const serverVersion = { ...item, text: `${item.text} [edited by someone else]`, rev: item.rev + 5 };
    say('the server has a newer revision than you based your edit on (409)', 'bad');
    setItems((prev) => prev.map((i) => (i.id === item.id
      ? { ...i, state: 'conflict', theirs: serverVersion.text, theirRev: serverVersion.rev }
      : i)));
  }

  const resolve = (item, keep) => setItems((prev) => prev.map((i) => (i.id === item.id
    ? { ...i, text: keep === 'theirs' ? i.theirs : i.text, rev: i.theirRev, state: 'synced', theirs: undefined }
    : i)));

  return (
    <>
      <div className="panel">
        <h2>mutation strategy</h2>
        <div className="toolbar">
          {['pessimistic', 'optimistic', 'optimistic-queue'].map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</button>
          ))}
          <label>server fails every
            <select value={failEvery} onChange={(e) => setFailEvery(Number(e.target.value))}>
              {[0, 2, 3, 1].map((n) => <option key={n} value={n}>{n === 0 ? 'never' : n}</option>)}
            </select>
          </label>
          <button onClick={() => add(`item ${items.length + 1}`)}>add an item</button>
        </div>
        <p className="hint">
          pessimistic: nothing appears until the server confirms — always correct, always feels slow.<br />
          optimistic: appears instantly, disappears on failure — fast, and the rollback is jarring.<br />
          optimistic-queue: appears instantly, stays marked failed with a retry — usually the right product.
        </p>
      </div>

      <div className="panel">
        <h2>items</h2>
        <div className="rows">
          {items.map((item) => (
            <div className="row" key={item.id}>
              <span>{item.id}</span>
              <span className={item.state === 'pending' ? 'pending' : item.state === 'failed' ? 'failed' : ''}>
                {item.text}
              </span>
              <span>{item.state}</span>
              <span>rev {item.rev}</span>
              <span>
                {item.state === 'failed' && <button onClick={() => retry(item)}>retry</button>}
                {item.state === 'synced' && <button onClick={() => conflict(item)}>simulate conflict</button>}
                {item.state === 'conflict' && (
                  <>
                    <button onClick={() => resolve(item, 'mine')}>keep mine</button>
                    <button onClick={() => resolve(item, 'theirs')}>take theirs</button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>log</h2>
        <div className="rows" style={{ maxHeight: 200 }}>
          {log.map((l, i) => (
            <div className="row" key={i} style={{ gridTemplateColumns: '90px 1fr' }}>
              <span>{l.at}</span>
              <span className={l.kind === 'bad' ? 'failed' : ''}>{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
