// Lab 01 — Transports: the same stream, three ways.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const stats = {
  poll: { requests: 0, messages: 0, bytes: 0, latency: [] },
  sse: { requests: 0, messages: 0, bytes: 0, latency: [] },
  ws: { requests: 0, messages: 0, bytes: 0, latency: [] },
};

let pollTimer = null, source = null, socket = null;

const feed = (kind, text) => {
  const el = $(`#f-${kind}`);
  const line = document.createElement('div');
  line.textContent = text;
  el.append(line);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 60) el.firstChild.remove();
};

const record = (kind, bytes, at) => {
  const s = stats[kind];
  s.messages++;
  s.bytes += bytes;
  if (at) s.latency.push(Date.now() - new Date(at).getTime());
  paint();
};

function paint() {
  renderTable('#results', Object.entries(stats).map(([kind, s]) => ({
    transport: kind,
    'HTTP requests': s.requests,
    messages: s.messages,
    'bytes (payload)': s.bytes,
    'median latency': s.latency.length
      ? `${[...s.latency].sort((a, b) => a - b)[Math.floor(s.latency.length / 2)]}ms` : '—',
  })), { columns: ['transport', 'HTTP requests', 'messages', 'bytes (payload)', 'median latency'] });
}

// ---------------------------------------------------------------------------
// 1. Polling. The whole implementation, and that is the argument for it.
// ---------------------------------------------------------------------------
function startPolling() {
  const tick = async () => {
    stats.poll.requests++;
    const r = await fetch('/api/asset?name=feed&type=json&cc=no-store', { cache: 'no-store' });
    const body = await r.text();
    record('poll', body.length);
    feed('poll', `${new Date().toLocaleTimeString()} polled (${body.length}B)`);
  };
  tick();
  pollTimer = setInterval(tick, 2000);
}

// ---------------------------------------------------------------------------
// 2. SSE. Note what you did NOT write: reconnection, resume, parsing framing.
// ---------------------------------------------------------------------------
function startSse() {
  stats.sse.requests++;
  source = new EventSource('/api/events?interval=1000');
  source.addEventListener('tick', (e) => {
    const d = JSON.parse(e.data);
    record('sse', e.data.length, d.at);
    feed('sse', `#${d.id} value=${d.value}`);
  });
  source.addEventListener('replay', (e) => feed('sse', `replayed ${e.data}`));
  source.onopen = () => log.ok('SSE open');
  source.onerror = () => {
    // EventSource reconnects by itself. This handler fires, readyState goes to CONNECTING,
    // and a new request goes out carrying Last-Event-ID.
    stats.sse.requests++;
    log.bad(`SSE error (readyState ${source.readyState}) — the browser will reconnect on its own`);
  };
}

// ---------------------------------------------------------------------------
// 3. WebSocket. Full duplex, and every resilience feature is now your problem.
// ---------------------------------------------------------------------------
function startWs() {
  stats.ws.requests++;
  socket = new WebSocket(`ws://${location.host}/ws?interval=1000`);
  socket.onopen = () => log.ok('WebSocket open');
  socket.onmessage = (e) => {
    const d = JSON.parse(e.data);
    record('ws', e.data.length, d.at);
    feed('ws', d.type === 'tick' ? `#${d.id}` : `${d.type}: ${d.body ?? ''} (${d.from ?? ''})`);
  };
  socket.onclose = () => log.bad('WebSocket closed — nothing reconnects unless you write it');
  socket.onerror = () => log.bad('WebSocket error');
}

on('start', () => {
  log.head('— starting polling, SSE and WebSocket —');
  startPolling(); startSse(); startWs();
  setTimeout(() => {
    out.textContent =
      'Let it run for 30 seconds, then read the table.\n\n' +
      'POLLING made one HTTP request per interval whether or not anything changed. Every request\n' +
      'carries full headers and cookies — on a real app that is often 800–1500 bytes of overhead\n' +
      'for a 40-byte answer of "nothing new". Its latency is on average half the interval, by\n' +
      'construction.\n\n' +
      'SSE made ONE request and has been receiving ever since. Latency is the network. And the\n' +
      'code you did not write is the interesting part: reconnection, backoff, resume-from-id, and\n' +
      'the framing parser are all in the browser.\n\n' +
      'WEBSOCKET made one request that was upgraded, and can send in both directions. Notice the\n' +
      'onclose handler: it logs, and that is all. Everything after "the connection dropped" is\n' +
      'yours to build — which is lab 02.';
  }, 1500);
});

on('send', () => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(`hello at ${new Date().toLocaleTimeString()}`);
    log.ok('sent over the WebSocket');
  } else {
    log.bad('no open WebSocket');
  }
  out.textContent =
    'Client → server is where the transports actually differ.\n\n' +
    'Over a WebSocket this is socket.send() — one frame, no headers, no round trip setup.\n\n' +
    'With SSE you would do it with a normal fetch(), which is a full HTTP request with headers and\n' +
    'a response. For "the user clicked save" that is completely fine, and it keeps your auth,\n' +
    'retries and error handling identical to the rest of the app.\n\n' +
    'The question that decides the transport is therefore: HOW OFTEN does the client send, and does\n' +
    'it need a response? Cursor positions at 60Hz: WebSocket. A save button: fetch.';
});

on('stop', () => {
  clearInterval(pollTimer); source?.close(); socket?.close();
  log.muted('stopped');
});

on('compare', () => {
  renderTable('#results', [
    { question: 'Does the client send frequently?', answer: 'yes → WebSocket · no → SSE or polling' },
    { question: 'Do you need binary frames?', answer: 'yes → WebSocket (SSE is text only)' },
    { question: 'Is staleness of 30s acceptable?', answer: 'yes → poll, and stop reading here' },
    { question: 'Do you need it through hostile proxies?', answer: 'SSE — it is ordinary HTTP' },
    { question: 'Do you want reconnection for free?', answer: 'SSE — with resume, via Last-Event-ID' },
    { question: 'Are there many idle connections?', answer: 'both hold server resources; polling holds none between requests' },
    { question: 'Multiple tabs open?', answer: 'both open one connection PER TAB unless you share one via a SharedWorker' },
  ], { columns: ['question', 'answer'] });
  out.textContent =
    'Two operational facts that decide more architectures than the feature comparison does:\n\n' +
    '1. SSE IS HTTP. Your load balancer, auth middleware, compression, rate limiting, tracing and\n' +
    '   error dashboards all keep working, unchanged. A WebSocket bypasses most of that stack, and\n' +
    '   you will rebuild the parts you needed — usually after an incident.\n' +
    '   (Two historical caveats, both now mostly gone: over HTTP/1.1 the ~6-connections-per-origin\n' +
    '   limit meant a few open SSE streams could starve a site; over HTTP/2 they are multiplexed and\n' +
    '   this is a non-issue. And some proxies buffer streamed responses — hence the\n' +
    '   x-accel-buffering: no header this server sends.)\n\n' +
    '2. CONNECTIONS ARE PER TAB. Ten tabs is ten connections and ten times the fan-out. If that\n' +
    '   matters, put the connection in a SharedWorker and broadcast to tabs over a\n' +
    '   BroadcastChannel — one socket per browser, not per tab. See web-workers lab 05.\n\n' +
    'And the honest default: MOST FEATURES THAT ASK FOR REAL-TIME DO NOT NEED IT. A 30-second poll\n' +
    'has no connection state, no reconnection logic, no heartbeat, no reconciliation and no 3am\n' +
    'page. Make the requirement earn the complexity.';
});

on('clear', () => { log.clear(); for (const k of ['poll', 'sse', 'ws']) $(`#f-${k}`).textContent = ''; });
