/** Drill 05 — reference. */

export function createStream(log, { heartbeatMs = 15_000, onTick } = {}) {
  return function handler(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      // A cached stream is a stream that never updates. This has bitten every SSE deployment
      // that sat behind a CDN with a permissive default.
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx buffers proxied responses by default, which for SSE means your events arrive in a
      // clump when the buffer fills — or when the connection closes. This header turns it off;
      // `proxy_buffering off` in the nginx config does the same thing from the other side.
      'x-accel-buffering': 'no',
    });
    // No Content-Length and no compression: gzip buffers, and a buffered event stream is a
    // contradiction. (If you want compression, `no-transform` above at least stops a proxy
    // adding it behind your back.)
    res.flushHeaders?.();

    // How long the browser waits before reconnecting. The default is 3 seconds; send your own so
    // a thundering herd after a deploy is spread out rather than synchronised.
    res.write('retry: 3000\n\n');

    // ---- resume ----
    // The browser sends this automatically on reconnect. You did not have to build it, it costs
    // one header to honour, and it is the difference between "reconnects" and "resumes".
    const lastEventId = req.headers['last-event-id'] ?? null;
    const missed = log.since(lastEventId);

    if (missed === null) {
      // The id is unknown — the client was away longer than we keep history. Silence is the worst
      // possible response: the client believes it is up to date and is not. Tell it, and send
      // what we do have so it can resync.
      send(res, { type: 'resync', data: JSON.stringify({ reason: 'unknown or expired Last-Event-ID' }) });
      for (const event of log.since(null)) send(res, event);
    } else {
      for (const event of missed) send(res, event);
    }

    // ---- keepalive ----
    // A comment line: valid SSE, ignored by the client, and enough traffic to stop an idle
    // connection being reaped by every proxy between you and the user. nginx's default is 60s,
    // AWS ALB's is 60s, and a mobile carrier's NAT can be shorter still.
    const beat = setInterval(() => {
      onTick?.();
      if (res.writableEnded || res.destroyed) return;
      res.write(': keepalive\n\n');
    }, heartbeatMs);

    // ---- cleanup ----
    // 'close' fires when the client goes away — a closed tab, a lost signal, a navigation. Without
    // this the interval runs forever, holding its closure, per abandoned connection. That is
    // node-runtime drill 13's leak, over HTTP.
    const stop = () => { clearInterval(beat); };
    res.on('close', stop);
    res.on('error', stop);
    req.on('aborted', stop);
  };
}

/**
 * The framing, which is where the drill actually is.
 *
 * `data:` is a LINE field. A payload containing "\n" written directly produces a blank-line
 * boundary in the middle of your event, which the client reads as "event over" — so it gets half
 * an object, fails to parse it, and (because EventSource swallows parse errors in your handler)
 * usually fails silently.
 *
 * "\r\n" and a lone "\r" are line terminators too, per the spec. Splitting on /\r\n|\r|\n/ and
 * emitting one `data:` per piece is the complete fix; the client rejoins them with "\n", which is
 * why a "\r\n" in the original comes back as "\n" unless you encode it — and why sending JSON
 * (where the newline is escaped as \\n inside a string) sidesteps the whole question.
 */
function send(res, { id, type, data }) {
  if (res.writableEnded || res.destroyed) return;
  let frame = '';
  if (id != null) frame += `id: ${id}\n`;
  if (type && type !== 'message') frame += `event: ${type}\n`;
  for (const line of String(data).split(/\r\n|\r|\n/)) frame += `data: ${line}\n`;
  frame += '\n';                                   // the blank line is what ends the event
  res.write(frame);
}

/*
SSE VERSUS WEBSOCKETS — the honest comparison

  SSE                                        WebSocket
  server -> client only                      both directions
  plain HTTP; every proxy understands it     an upgrade some corporate proxies still mangle
  reconnects automatically, with resume      you write reconnection and resume yourself
  text only (UTF-8)                          text and binary
  ~6 connections per domain on HTTP/1.1      one connection, many channels
  no framing to implement (drill 01)         you or your library implements framing

For a live price, a progress bar, a notification feed, a build log, or tokens streaming out of a
model, SSE is the right answer and is usually skipped because WebSockets sound more capable. The
HTTP/1.1 connection limit is the one real gotcha, and HTTP/2 removes it — which is another reason
SSE aged better than its reputation.

THE PART PEOPLE DO NOT BUILD: the id has to MEAN something.

Last-Event-ID only works if you can answer "what happened after this?" That means the id is a
position in a durable log — a sequence number, a Postgres bigserial, a Redis Stream id — not a
UUID and not an array index that shifts. And your history has to be long enough to cover a
realistic disconnection: a train tunnel is minutes, a closed laptop is hours.

When the id is too old, `resync` (as above) is the honest answer: tell the client to fetch a fresh
snapshot and start again. Every real-time system needs that path, and it is the one that never
gets tested until the day of an outage — which is exactly when every client will use it at once,
so make sure a full resync is something your API can serve to all of them.

CLIENT SIDE, FOR COMPLETENESS

    const es = new EventSource('/events');
    es.addEventListener('message', e => { ... });   // e.lastEventId is handled for you
    es.addEventListener('resync', () => location.reload());
    es.onerror = () => { };   // it is already reconnecting; do NOT create a second EventSource

That last comment is the most common client bug: creating a new EventSource in onerror, so every
blip doubles the number of connections. EventSource reconnects on its own.
*/
