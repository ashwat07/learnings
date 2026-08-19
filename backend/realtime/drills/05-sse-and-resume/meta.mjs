import http from 'node:http';
import { sleep } from '../../world.mjs';

export const title = 'Server-Sent Events, and resuming without a gap';
export const task = `SSE is the transport people skip past on the way to WebSockets, and for
one-way data it is almost always the better answer: it is plain HTTP, it goes through every proxy,
it reconnects on its own, and — the part nobody uses — the browser REPLAYS THE LAST EVENT ID it
saw, so you can resume exactly where the client left off.

Implement createStream(log) returning an http handler.

  log.since(id, limit) -> events after that id      (id may be null, or long expired)
  log.append(event)

The wire format is four fields, one per line, terminated by a BLANK line:

    id: 42
    event: message
    data: {"hello":"world"}
    <blank>

The bug that gets shipped every time: a payload containing a newline. "data:" is a LINE-oriented
field, so an embedded \\n silently ends your event and starts a new one.`;
export const passIf = 'the framing is correct, a payload with newlines survives, and a reconnect with Last-Event-ID replays exactly what was missed — no gap, no duplicate';

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

/** A parser that follows the EventSource rules, so the checks test the wire, not our leniency. */
function parseSSE(text) {
  const events = [];
  let data = [], id = null, type = 'message', comments = 0, retry = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') {
      if (data.length) events.push({ id, type, data: data.join('\n') });
      data = []; type = 'message';
      continue;
    }
    if (line.startsWith(':')) { comments++; continue; }
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
    else if (field === 'event') type = value;
    else if (field === 'retry') retry = Number(value);
  }
  return { events, comments, retry };
}

function makeLog() {
  const events = [];
  return {
    events,
    append(e) { events.push({ ...e, id: String(events.length + 1) }); return events.at(-1); },
    since(id, limit = 1000) {
      if (id == null || id === '') return events.slice(-limit);
      const idx = events.findIndex((e) => e.id === String(id));
      if (idx < 0) return null;                 // too old / unknown — the caller must decide
      return events.slice(idx + 1, idx + 1 + limit);
    },
  };
}

const read = async (port, { lastEventId, ms = 300 } = {}) => {
  const ac = new AbortController();
  // Arm the abort BEFORE the fetch. A handler that writes headers and then nothing never flushes
  // them — Node holds the header until there is a body or an end — so awaiting fetch() first
  // would hang with no timer running. That is also a real client-side bug: always give an SSE
  // fetch a deadline for the FIRST byte, not just for the body.
  const t = setTimeout(() => ac.abort(), ms);
  const headers = lastEventId ? { 'last-event-id': String(lastEventId) } : {};
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}/events`, { headers, signal: ac.signal });
  } catch {
    clearTimeout(t);
    return { res: { status: 0, headers: new Headers() }, text: '' };
  }
  let text = '';
  try {
    for await (const chunk of res.body) text += Buffer.from(chunk).toString('utf8');
  } catch { /* the abort */ }
  clearTimeout(t);
  return { res, text };
};

export async function check(s) {
  if (typeof s.createStream !== 'function') return [{ check: 'exports createStream(log)', actual: 'missing', pass: false }];
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 64), pass: false }); }
  };

  const log = makeLog();
  for (let i = 1; i <= 5; i++) log.append({ type: 'message', data: JSON.stringify({ n: i }) });
  const server = http.createServer(s.createStream(log));
  const port = await listen(server);

  await guard('the response headers are right for a stream', async () => {
    const { res } = await read(port, { ms: 80 });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.startsWith('text/event-stream')) return `content-type is "${ct}"`;
    const cache = res.headers.get('cache-control') ?? '';
    if (!/no-cache|no-store/.test(cache)) return `cache-control is "${cache}" — a cached stream is a stream that never updates`;
    if (res.headers.get('content-length')) return 'a Content-Length was sent — the response has no length, it is a stream';
    return true;
  });

  await guard('events are framed so a spec parser reads them back', async () => {
    const { text } = await read(port, { ms: 200 });
    const { events } = parseSSE(text);
    if (events.length < 5) return `parsed ${events.length} events from ${JSON.stringify(text.slice(0, 80))}`;
    const first = events[0];
    return (first.id === '1' && JSON.parse(first.data).n === 1)
      ? true : `first event: ${JSON.stringify(first)}`;
  });

  await guard('a "retry" directive tells the client how long to wait before reconnecting', async () => {
    const { text } = await read(port, { ms: 120 });
    const { retry } = parseSSE(text);
    return (typeof retry === 'number' && retry > 0)
      ? true : 'no retry: field — the browser will use its default 3s, which is rarely what you want';
  });

  // THE framing bug. Note the PRETTY-PRINTED JSON: JSON.stringify with no indent escapes a
  // newline to the two characters \ and n, so it never reaches the wire as a line break and the
  // bug stays hidden. Pretty-printing — or a log line, or a stack trace, or a user's message —
  // puts real newlines in the payload, which is when it bites.
  await guard('a payload containing REAL newlines survives intact', async () => {
    const nasty = 'line one\nline two\n\nline four';
    log.append({ type: 'message', data: JSON.stringify({ text: nasty }, null, 2) });
    const { text } = await read(port, { ms: 200 });
    const { events } = parseSSE(text);
    const last = events.at(-1);
    if (!last) return 'no events parsed at all';
    let payload;
    try { payload = JSON.parse(last.data); }
    catch { return `the event did not survive as valid JSON: ${JSON.stringify(last.data).slice(0, 70)} — an embedded \\n ended the event early`; }
    return payload.text === nasty ? true : `got ${JSON.stringify(payload.text)}`;
  });

  await guard('a payload with a carriage return survives too', async () => {
    const nasty = 'windows lines';
    log.append({ type: 'message', data: `{\r\n  "text": "${nasty}"\r\n}` });
    const { text } = await read(port, { ms: 200 });
    const { events } = parseSSE(text);
    let payload;
    try { payload = JSON.parse(events.at(-1).data); } catch { return 'the event was corrupted by a \\r'; }
    return payload.text === nasty || `got ${JSON.stringify(payload.text)}`;
  });

  await guard('a custom event type is sent', async () => {
    log.append({ type: 'ping', data: '{}' });
    const { text } = await read(port, { ms: 200 });
    const { events } = parseSSE(text);
    return events.some((e) => e.type === 'ping') ? true : `types seen: ${[...new Set(events.map((e) => e.type))].join(',')}`;
  });

  // The whole reason to use SSE.
  await guard('reconnecting with Last-Event-ID replays exactly what was missed', async () => {
    const fresh = makeLog();
    for (let i = 1; i <= 10; i++) fresh.append({ type: 'message', data: JSON.stringify({ n: i }) });
    const srv = http.createServer(s.createStream(fresh));
    const p = await listen(srv);
    try {
      const { text } = await read(p, { lastEventId: '4', ms: 200 });
      const { events } = parseSSE(text);
      const ns = events.map((e) => JSON.parse(e.data).n);
      if (ns.includes(4)) return `replayed event 4, which the client already had: got ${ns.join(',')}`;
      if (!ns.includes(5)) return `event 5 was skipped — the client has a hole in its data: got ${ns.join(',')}`;
      return JSON.stringify(ns) === JSON.stringify([5, 6, 7, 8, 9, 10]) ? true : `got ${ns.join(',')}`;
    } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
  });

  await guard('reconnecting with the LATEST id replays nothing', async () => {
    const fresh = makeLog();
    for (let i = 1; i <= 6; i++) fresh.append({ type: 'message', data: JSON.stringify({ n: i }) });
    const srv = http.createServer(s.createStream(fresh));
    const p = await listen(srv);
    try {
      const { text } = await read(p, { lastEventId: '6', ms: 200 });
      const { events } = parseSSE(text);
      return events.length === 0 ? true : `replayed ${events.length} events the client already had`;
    } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
  });

  await guard('an unknown or expired Last-Event-ID does not silently drop the client', async () => {
    const fresh = makeLog();
    for (let i = 1; i <= 6; i++) fresh.append({ type: 'message', data: JSON.stringify({ n: i }) });
    const srv = http.createServer(s.createStream(fresh));
    const p = await listen(srv);
    try {
      const { res, text } = await read(p, { lastEventId: 'evt-from-last-tuesday', ms: 200 });
      const { events } = parseSSE(text);
      // Either resync from the top, or tell the client to resync. Silence is the wrong answer.
      const resynced = events.length > 0;
      const told = /resync|reset|expired/i.test(text) || res.status === 409;
      return (resynced || told)
        ? true : 'the client got nothing and no instruction — it will sit there forever believing it is up to date';
    } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
  });

  // Proxies and load balancers close an idle connection. A comment line is the standard keepalive.
  await guard('a heartbeat comment keeps the connection from being reaped', async () => {
    const quiet = makeLog();
    const srv = http.createServer(s.createStream(quiet, { heartbeatMs: 40 }));
    const p = await listen(srv);
    try {
      const { text } = await read(p, { ms: 260 });
      const { comments } = parseSSE(text);
      return comments >= 2
        ? true : `${comments} heartbeat comments in 260ms — an idle SSE connection gets closed by nginx after 60s by default`;
    } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
  });

  await guard('a disconnecting client stops the work', async () => {
    const quiet = makeLog();
    let ticks = 0;
    const srv = http.createServer(s.createStream(quiet, { heartbeatMs: 10, onTick: () => ticks++ }));
    const p = await listen(srv);
    try {
      await read(p, { ms: 120 });
      const atDisconnect = ticks;
      await sleep(200);
      return ticks <= atDisconnect + 2
        ? true : `the server kept ticking ${ticks - atDisconnect} more times for a client that had gone`;
    } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
  });

  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  return out;
}
