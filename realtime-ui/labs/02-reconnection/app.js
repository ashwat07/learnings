// Lab 02 — Reconnection.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

let source = null, socket = null, naive = null, timers = [];
const attempts = [];

const setStatus = (state, text) => {
  $('#dot').className = `dot ${state}`;
  $('#status').textContent = text;
};

const record = (transport, kind, delay) => {
  attempts.push({ at: new Date().toLocaleTimeString(), transport, event: kind, delay: delay ?? '—' });
  renderTable('#results', attempts.slice(-14), { columns: ['at', 'transport', 'event', 'delay'] });
};

const stopAll = () => {
  source?.close(); source = null;
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  if (naive) { naive.onclose = null; naive.close(); naive = null; }
  timers.forEach(clearTimeout); timers = [];
};

// ---------------------------------------------------------------------------
// SSE: the browser reconnects, honours `retry:`, and resends Last-Event-ID.
// ---------------------------------------------------------------------------
on('sse-start', () => {
  stopAll();
  log.head('— SSE, server drops the stream after 4 events —');
  source = new EventSource('/api/events?interval=600&dropAfter=4&retry=1500');
  source.onopen = () => { setStatus('up', 'SSE connected'); record('SSE', 'open'); };
  source.addEventListener('tick', (e) => log.line(`tick ${JSON.parse(e.data).id}`));
  source.addEventListener('replay', (e) => log.ok(`REPLAYED ${e.data}`));
  source.onerror = () => {
    setStatus('wait', 'SSE reconnecting…');
    record('SSE', 'dropped → browser will reconnect', '1500ms (server `retry:`)');
    log.bad('stream ended; the browser is reconnecting on its own');
  };
  out.textContent =
    'Watch the Network panel: after the drop, a NEW request to /api/events goes out — and it\n' +
    'carries a Last-Event-ID header with the id of the last event you received.\n\n' +
    'The server replays everything after that id (look for the "REPLAYED" lines). You did not write\n' +
    'a reconnection loop, a backoff, or a resume protocol. This is the strongest practical argument\n' +
    'for SSE, and the thing people rebuild badly over WebSockets.\n\n' +
    'The server controls the delay by sending `retry: 1500` in the stream. Most implementations\n' +
    'never send it — which means the browser uses its own default (~3s in Chrome) and you have no\n' +
    'way to slow clients down when your server is struggling.';
});

on('sse-flaky', () => {
  stopAll();
  log.head('— SSE against an endpoint that refuses every other connection —');
  source = new EventSource('/api/events?interval=600&flaky=1&retry=1000');
  source.onopen = () => { setStatus('up', 'SSE connected'); record('SSE', 'open'); };
  source.onerror = () => { setStatus('wait', 'retrying…'); record('SSE', 'connection refused → retry', '1000ms'); };
  source.addEventListener('tick', (e) => log.line(`tick ${JSON.parse(e.data).id}`));
  out.textContent =
    'EventSource retries a failed CONNECTION at a fixed interval, forever, with no backoff and no\n' +
    'cap. That is the one place its built-in behaviour is not enough:\n\n' +
    '  · a server that is down gets hammered by every client at the same fixed rate\n' +
    '  · there is no jitter, so all your clients retry in lockstep — a thundering herd that keeps\n' +
    '    the server down after it tries to come back up\n\n' +
    'The fix is to send `retry:` from the server (raise it under load — a control channel for your\n' +
    'own backpressure), and for clients to close the EventSource after N consecutive failures and\n' +
    'reopen it on a backoff you control. Free reconnection is not free ADAPTIVE reconnection.';
});

on('sse-stop', () => { stopAll(); setStatus('down', 'disconnected'); });

// ---------------------------------------------------------------------------
// WebSocket, the naive version: reconnect immediately, forever.
// ---------------------------------------------------------------------------
on('ws-naive', () => {
  stopAll();
  log.head('— WebSocket with a naive reconnect loop —');
  let n = 0;
  const connect = () => {
    naive = new WebSocket(`ws://${location.host}/ws?interval=500&dropAfter=2`);
    naive.onopen = () => { setStatus('up', 'connected'); record('WS naive', 'open'); };
    naive.onmessage = (e) => log.line(JSON.parse(e.data).id ? `tick ${JSON.parse(e.data).id}` : e.data);
    naive.onclose = () => {
      record('WS naive', `reconnect #${++n}`, '0ms');
      log.bad(`closed — reconnecting immediately (attempt ${n})`);
      setStatus('wait', 'reconnecting');
      if (n < 12) timers.push(setTimeout(connect, 0));
      else log.bad('stopped after 12 attempts so this page stays usable');
    };
  };
  connect();
  out.textContent =
    'Reconnect immediately, every time. In a demo it looks perfect.\n\n' +
    'In production it is an outage amplifier. When your server restarts, every client that was\n' +
    'connected reconnects in the same millisecond, and keeps doing so. The server comes up, is\n' +
    'immediately saturated by the reconnect storm, falls over, and the cycle repeats — a\n' +
    'self-sustaining outage that continues after the original fault is fixed.\n\n' +
    'Two properties turn this from a weapon into a mechanism: EXPONENTIAL BACKOFF (each attempt\n' +
    'waits longer) and JITTER (each client waits a DIFFERENT amount, so they stop arriving in\n' +
    'lockstep). Jitter is the one people leave out, and it is the one that actually spreads the load.';
});

// ---------------------------------------------------------------------------
// WebSocket, done properly.
// ---------------------------------------------------------------------------
on('ws-good', () => {
  stopAll();
  log.head('— WebSocket with backoff, jitter, heartbeat and a reset —');
  let attempt = 0, heartbeat = null, watchdog = null;

  const connect = () => {
    socket = new WebSocket(`ws://${location.host}/ws?interval=700&dropAfter=3`);

    socket.onopen = () => {
      setStatus('up', 'connected');
      record('WS', 'open', attempt ? `after ${attempt} attempts` : 'first try');
      attempt = 0;                                  // reset the backoff ON SUCCESS, not on close
      // A heartbeat is not optional: a TCP connection can be dead while readyState says OPEN
      // (a NAT dropped it, the peer vanished). Only an unanswered ping proves liveness.
      heartbeat = setInterval(() => {
        if (socket?.readyState !== WebSocket.OPEN) return;
        socket.send('ping');
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          log.bad('no pong within 3s — treating the connection as dead');
          socket.close();
        }, 3000);
      }, 4000);
    };

    socket.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === 'pong') return clearTimeout(watchdog);
      log.line(`tick ${d.id ?? ''}`);
    };

    socket.onclose = () => {
      clearInterval(heartbeat); clearTimeout(watchdog);
      setStatus('wait', 'backing off');
      // Exponential, capped, with full jitter: a random delay in [0, backoff]. Full jitter beats
      // "backoff ± 10%" because it spreads a synchronised herd across the whole window.
      const capped = Math.min(1000 * 2 ** attempt, 30000);
      const delay = Math.round(Math.random() * capped);
      attempt++;
      record('WS', `closed → retry #${attempt}`, `${delay}ms (cap ${capped}ms)`);
      log.bad(`closed — retry #${attempt} in ${delay}ms`);
      if (attempt < 8) timers.push(setTimeout(connect, delay));
      else { setStatus('down', 'gave up'); log.bad('gave up — now tell the USER, and offer a retry button'); }
    };
  };
  connect();

  out.textContent =
    'Five things, and each one exists because of a specific failure:\n\n' +
    '1. EXPONENTIAL BACKOFF — 1s, 2s, 4s, 8s… so a struggling server gets exponentially less\n' +
    '   traffic instead of a constant hammering.\n' +
    '2. FULL JITTER — a random delay in [0, backoff]. Without it, every client retries at the same\n' +
    '   instant forever. "backoff ± 10%" is not enough; you want the whole window.\n' +
    '3. A CAP — 30s, so a long outage does not turn into a 3-hour wait for a client whose\n' +
    '   exponent kept climbing.\n' +
    '4. RESET ON SUCCESS — reset the counter when a connection OPENS and survives, not when it is\n' +
    '   attempted. A flapping connection that opens and dies immediately should keep backing off.\n' +
    '5. HEARTBEAT + WATCHDOG — readyState can say OPEN on a socket that is already dead (a NAT\n' +
    '   timeout, a peer that vanished). Only an unanswered ping proves it. This also keeps\n' +
    '   load-balancer idle timeouts (usually 60s) from closing an idle connection.\n\n' +
    'And the sixth, which is UX rather than networking: AFTER N ATTEMPTS, TELL THE USER. A silent\n' +
    'permanent retry loop showing stale data is worse than an honest "disconnected — retry".';
});

on('ws-stop', () => { stopAll(); setStatus('down', 'disconnected'); });

on('offline', () => {
  log.head('— offline/online events —');
  log.muted(`navigator.onLine is ${navigator.onLine}`);
  out.textContent =
    'Use the Network panel\'s "Offline" preset, and watch the log.\n\n' +
    'The online/offline events are a useful HINT and a terrible source of truth:\n' +
    '  · navigator.onLine === false is reliable (no network interface).\n' +
    '  · navigator.onLine === true means only "an interface exists". A captive portal, a VPN that\n' +
    '    is up but routing nowhere, or a server that is down all report true.\n\n' +
    'So: use "offline" to STOP retrying (there is no point) and "online" to retry IMMEDIATELY\n' +
    'instead of waiting out the backoff — that is what makes an app feel instant when you leave a\n' +
    'tunnel. But never use "online" as proof that a request will succeed. The only proof is a\n' +
    'successful request.\n\n' +
    'Also handle visibilitychange: a tab that has been hidden for an hour should verify its\n' +
    'connection and re-sync when it comes back, rather than trusting a socket that a sleeping\n' +
    'laptop silently killed.';
  addEventListener('offline', () => { log.bad('offline event'); setStatus('down', 'offline'); }, { once: true });
  addEventListener('online', () => { log.ok('online event — retry NOW, do not wait out the backoff'); }, { once: true });
});

on('recipe', () => {
  renderTable('#results', [
    { step: 'exponential backoff', because: 'a struggling server should receive exponentially less traffic' },
    { step: 'full jitter — random in [0, backoff]', because: 'otherwise every client retries in lockstep' },
    { step: 'a cap (30s)', because: 'a long outage should not mean a 3-hour wait' },
    { step: 'reset on a connection that SURVIVES', because: 'a flapping socket should keep backing off' },
    { step: 'heartbeat + watchdog', because: 'readyState lies; only an unanswered ping proves death' },
    { step: 'resume from a message id', because: 'reconnecting is not the same as being correct — lab 03' },
    { step: 'stop on `offline`, retry on `online`', because: 'retrying with no interface is pure waste' },
    { step: 're-sync on visibilitychange', because: 'a sleeping laptop kills sockets silently' },
    { step: 'give up visibly after N attempts', because: 'a silent retry loop showing stale data is a lie' },
  ], { columns: ['step', 'because'] });
  out.textContent =
    'The step that is easiest to skip and most expensive to skip: RESUME FROM A MESSAGE ID.\n\n' +
    'Reconnecting restores the CONNECTION. It does not restore the STATE. If you were disconnected\n' +
    'for 40 seconds, you missed everything that happened in those 40 seconds, and your UI is now\n' +
    'confidently wrong while looking perfectly healthy — the worst failure mode there is.\n\n' +
    'That is lab 03.';
});

on('clear', () => { log.clear(); attempts.length = 0; $('#results').textContent = ''; });
