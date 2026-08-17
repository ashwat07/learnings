// Lab 05 — Scale & backpressure.
//
// The messages are generated locally at a controlled rate: a real firehose is hard to produce on
// demand, and the lesson is about the RENDER side, which is identical either way.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
window.PerfHUD?.start?.();

let rate = 200, strategy = 'naive';
let producer = null, received = 0, rendered = 0, dropped = 0;
let pending = [];         // the buffer between arrival and render
let rafId = null, throttleTimer = null;

const rows = $('#rows');
const paint = () => {
  $('received').textContent = received;
  $('rendered').textContent = rendered;
  $('dropped').textContent = dropped;
};

// FPS, so the cost of the naive strategy is visible as a number rather than a feeling.
let frames = 0, last = performance.now();
const tickFps = () => {
  frames++;
  const now = performance.now();
  if (now - last >= 1000) { $('fps').textContent = frames; frames = 0; last = now; }
  requestAnimationFrame(tickFps);
};
requestAnimationFrame(tickFps);

function renderBatch(messages) {
  if (!messages.length) return;
  // One DOM write for the whole batch. Appending 200 nodes one at a time is 200 style
  // invalidations; a fragment is one.
  const frag = document.createDocumentFragment();
  for (const m of messages) {
    const d = document.createElement('div');
    d.textContent = `#${m.id}  ${m.symbol}  ${m.price.toFixed(2)}`;
    frag.append(d);
  }
  rows.prepend(frag);
  rendered += messages.length;
  while (rows.children.length > 300) rows.lastChild.remove();
  paint();
}

function onMessage(m) {
  received++;
  if (strategy === 'naive') {
    renderBatch([m]);                       // synchronous DOM write per message
  } else if (strategy === 'raf') {
    pending.push(m);
    // Coalesce: however many arrive between frames, render them once, in one write.
    rafId ??= requestAnimationFrame(() => { rafId = null; const batch = pending; pending = []; renderBatch(batch); });
  } else if (strategy === 'throttle') {
    pending.push(m);
    throttleTimer ??= setTimeout(() => {
      throttleTimer = null;
      const batch = pending; pending = [];
      renderBatch(batch);
    }, 250);
  } else if (strategy === 'latest') {
    // Conflation: for a price ticker, only the newest value per symbol matters. Everything else
    // is dropped ON PURPOSE, and that is not data loss — it is the correct semantics.
    const existing = pending.findIndex((x) => x.symbol === m.symbol);
    if (existing >= 0) { pending[existing] = m; dropped++; } else pending.push(m);
    rafId ??= requestAnimationFrame(() => { rafId = null; const batch = pending; pending = []; renderBatch(batch); });
  }
  paint();
}

const SYMBOLS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'NFLX'];
function start() {
  stop();
  const perTick = Math.max(1, Math.round(rate / 50));
  producer = setInterval(() => {
    for (let i = 0; i < perTick; i++) {
      onMessage({ id: received + 1, symbol: SYMBOLS[(received + i) % SYMBOLS.length], price: 100 + Math.random() * 50 });
    }
  }, 20);
  log.head(`producing ~${rate}/s, strategy: ${strategy}`);
}
function stop() { clearInterval(producer); cancelAnimationFrame(rafId); clearTimeout(throttleTimer); rafId = null; throttleTimer = null; }

for (const [id, s] of [['s-naive', 'naive'], ['s-raf', 'raf'], ['s-throttle', 'throttle'], ['s-latest', 'latest']]) {
  on(id, () => { strategy = s; received = rendered = dropped = 0; rows.textContent = ''; pending = []; start(); explain(s); });
}
for (const [id, r] of [['r-slow', 10], ['r-fast', 200], ['r-flood', 1000]]) {
  on(id, () => { rate = r; start(); });
}
on('stop', () => { stop(); log.muted('stopped'); });

function explain(s) {
  const notes = {
    naive:
      'One DOM write per message. At 200/s that is 200 style invalidations and layouts a second,\n' +
      'and the frame rate collapses — the page is technically up to date and completely unusable.\n\n' +
      'The mistake is not the transport. It is treating "a message arrived" and "the screen should\n' +
      'change" as the same event. They are not: the screen changes at most 60 times a second, so\n' +
      'anything above that rate is work whose output nobody ever sees.',
    raf:
      'COALESCE PER FRAME. Buffer everything that arrives, and flush once per animation frame in a\n' +
      'single DOM write.\n\n' +
      'Received stays high; rendered drops to at most 60 batches a second; FPS recovers. Note that\n' +
      'NOTHING IS LOST — every message is still rendered, just grouped. This is the default you\n' +
      'should reach for, and it is about four lines of code.\n\n' +
      'In React the equivalent is batching state updates and letting one render handle them —\n' +
      'React 18 batches automatically, but a store that fires a listener per message will still\n' +
      'schedule a render per message unless you buffer before you setState.',
    throttle:
      'THROTTLE: flush at a fixed maximum rate regardless of frames. Useful when the render is\n' +
      'expensive enough that even 60/s is too many, or when the data has no meaning at frame\n' +
      'resolution (a chart with a 250ms window).\n\n' +
      'Still lossless — batches are just bigger. Choose the interval from what the USER can read,\n' +
      'not from what the machine can do: a number changing 60 times a second is unreadable, and a\n' +
      'list scrolling faster than the eye can follow conveys nothing.',
    latest:
      'CONFLATION: keep only the newest value per key and drop the rest, deliberately.\n\n' +
      'The "dropped" counter is not a failure — for a price ticker, a superseded price is\n' +
      'genuinely worthless, and delivering it costs frames that the current price needs. This is\n' +
      'the standard behaviour of every serious market-data feed.\n\n' +
      'The question that decides whether you can conflate: IS EACH MESSAGE A FACT OR AN EVENT? A\n' +
      'fact ("the price is now X") supersedes its predecessor and can be conflated. An event ("a\n' +
      'trade occurred") cannot — dropping one loses information forever. Chat messages are events.\n' +
      'Cursor positions are facts. Getting this wrong in either direction is the bug.',
  };
  out.textContent = notes[s];
}

on('patterns', () => {
  renderTable('#results', [
    { pattern: 'coalesce per frame (rAF)', loses: 'nothing', use: 'the default for any high-rate feed' },
    { pattern: 'throttle to N/s', loses: 'nothing', use: 'expensive renders; data with no meaning at 60Hz' },
    { pattern: 'conflate by key', loses: 'superseded values, on purpose', use: 'tickers, cursors, "current state" facts' },
    { pattern: 'sample (take every Nth)', loses: 'arbitrary messages', use: 'almost never — you cannot say what you dropped' },
    { pattern: 'bounded queue + drop oldest', loses: 'the oldest', use: 'logs and feeds where recency wins' },
    { pattern: 'bounded queue + reject new', loses: 'the newest', use: 'when order matters more than freshness' },
    { pattern: 'ask the server to slow down', loses: 'nothing', use: 'the real fix — subscribe to less' },
  ], { columns: ['pattern', 'loses', 'use'] });
  out.textContent =
    'The last row is the one that scales, and the one that is usually available:\n\n' +
    'DO NOT SUBSCRIBE TO WHAT YOU ARE NOT SHOWING. A table displaying 20 rows of a 5,000-row\n' +
    'dataset should subscribe to 20 symbols, not 5,000 — and should change that subscription as\n' +
    'the user scrolls. Every client-side backpressure strategy is damage control for data you\n' +
    'asked for and did not need.\n\n' +
    'Other server-side levers worth knowing:\n' +
    '  · server-side conflation — one update per key per interval, computed once for all clients\n' +
    '    rather than 10,000 times in 10,000 browsers\n' +
    '  · a "slow consumer" policy: if a client cannot keep up, drop it and make it re-snapshot,\n' +
    '    rather than growing an unbounded buffer in your server for one bad connection\n' +
    '  · SSE `retry:` and application-level "back off" messages, so you can shed load deliberately\n\n' +
    'And the ones on the client that are not about the queue at all:\n' +
    '  · VIRTUALIZE the list, so the number of DOM nodes does not grow with the data\n' +
    '  · put the parsing and aggregation in a WORKER, so the main thread only receives what it will\n' +
    '    draw (web-workers labs 01 and 03)\n' +
    '  · stop rendering entirely when the tab is hidden (visibilitychange) — a background tab\n' +
    '    animating a ticker is pure battery cost';
});
