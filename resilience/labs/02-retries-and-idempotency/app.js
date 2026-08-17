// Lab 02 — Retries & idempotency.
//
// /api/flaky fails on a schedule. /api/csrf is a toy bank whose ledger shows the DUPLICATE
// side effects a naive retry causes.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const seen = new Map();          // client-side stand-in for a server's idempotency-key store
let charges = [];

const charge = async ({ key } = {}) => {
  // The "server": /api/flaky fails on a schedule (every third request). If a key is supplied it
  // returns the ORIGINAL result rather than performing the work again — which is what a real
  // idempotent endpoint does, and why the key must come from the CLIENT.
  if (key && seen.has(key)) {
    log.ok(`server: idempotency key ${key.slice(0, 8)} already applied — returning the stored result`);
    return seen.get(key);
  }
  const r = await fetch('/api/flaky?failEvery=3&name=charge');
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  const result = { chargedAt: new Date().toLocaleTimeString(), amount: 4900 };
  charges.push(result);
  if (key) seen.set(key, result);
  return result;
};

const paint = () => renderTable('#results', charges.map((c, i) => ({
  '#': i + 1, at: c.chargedAt, amount: `£${(c.amount / 100).toFixed(2)}`,
})), { columns: ['#', 'at', 'amount'] });

on('naive', async () => {
  charges = []; seen.clear(); paint();
  log.head('— naive retry: three attempts, no key —');
  for (let i = 1; i <= 4; i++) {
    try { const r = await charge(); log.ok(`attempt ${i}: succeeded`); void r; }
    catch (e) { log.bad(`attempt ${i}: ${e.message} — retrying`); continue; }
    break;
  }
  paint();
  out.textContent =
    'Read the ledger. Now consider the case this lab cannot show you directly: the request that\n' +
    'SUCCEEDED on the server and failed on the way back.\n\n' +
    'A timeout, a dropped connection, a 502 from a proxy after the origin already committed — from\n' +
    'the client these are indistinguishable from "it never happened". Retry, and the work happens\n' +
    'twice. The customer is charged twice, the email is sent twice, the order exists twice.\n\n' +
    'This is not an edge case; it is the normal behaviour of networks. Any mutating endpoint that\n' +
    'a client may retry needs to be idempotent, and the only way to make it so is a key the CLIENT\n' +
    'generates and REUSES across retries.';
});

on('keyed', async () => {
  charges = []; seen.clear(); paint();
  log.head('— retry with an idempotency key —');
  // Generated ONCE, before the first attempt, and reused for every retry of the same intent.
  const key = crypto.randomUUID();
  log.muted(`idempotency key: ${key}`);
  for (let i = 1; i <= 4; i++) {
    try { await charge({ key }); log.ok(`attempt ${i}: succeeded`); break; }
    catch (e) { log.bad(`attempt ${i}: ${e.message} — retrying with the SAME key`); }
  }
  // Retrying again after success: the server returns the stored result and does nothing.
  await charge({ key });
  paint();
  out.textContent =
    'One charge, however many attempts — including the retry after success.\n\n' +
    'The rules that make this work, and each one is a real bug when broken:\n\n' +
    '  1. THE CLIENT GENERATES THE KEY, once, before the first attempt. A key the server generates\n' +
    '     cannot help: you only receive it in a response you did not get.\n' +
    '  2. THE SAME KEY IS REUSED FOR EVERY RETRY OF THE SAME INTENT. Generating a new key per\n' +
    '     attempt is the same as having no key at all — a surprisingly common mistake.\n' +
    '  3. A NEW USER INTENT MEANS A NEW KEY. If the user genuinely wants to pay twice, that is two\n' +
    '     keys. Bind the key to the intent (the checkout session), not to the session or the user.\n' +
    '  4. THE SERVER STORES THE RESULT, not just "seen". A duplicate request should return the\n' +
    '     ORIGINAL response, so the client ends in the right state either way.\n' +
    '  5. THE KEY SURVIVES A RELOAD. Persist it (sessionStorage) with the pending operation, or a\n' +
    '     user who refreshes mid-payment gets a second charge.\n\n' +
    'HTTP already gives you this for free on the methods it defines as idempotent: GET, PUT and\n' +
    'DELETE. It is POST that needs the key — which is why every payments API has one.';
});

on('backoff', async () => {
  charges = []; seen.clear(); paint();
  log.head('— backoff, jitter, and a retry BUDGET —');
  const key = crypto.randomUUID();
  const deadline = performance.now() + 6000;      // the budget is time, not attempts
  let attempt = 0;
  while (performance.now() < deadline) {
    try { await charge({ key }); log.ok(`succeeded on attempt ${attempt + 1}`); break; }
    catch (e) {
      attempt++;
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
        log.bad(`${e.message} is a client error — NOT retrying`);
        break;
      }
      const capped = Math.min(300 * 2 ** attempt, 4000);
      const delay = Math.round(Math.random() * capped);
      log.bad(`attempt ${attempt} failed (${e.message}) — waiting ${delay}ms (cap ${capped}ms)`);
      if (performance.now() + delay > deadline) { log.bad('retry budget exhausted — giving up'); break; }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  paint();
  out.textContent =
    'Four properties, and the last one is the one that is almost always missing:\n\n' +
    '  EXPONENTIAL BACKOFF   a struggling service receives exponentially less traffic\n' +
    '  FULL JITTER           random in [0, cap], so clients stop arriving in lockstep\n' +
    '  A CAP                 so the delay does not grow without bound\n' +
    '  A BUDGET              a total time (or a total attempt count ACROSS the app), after which\n' +
    '                        you stop and tell the user\n\n' +
    'Without a budget, a retry loop is an infinite loop with extra steps. Worse, retries compose:\n' +
    'if your fetch retries 3 times, and the component retries the fetch 3 times, and the user\n' +
    'clicks a "retry" button 3 times, you have sent 27 requests to a service that is already\n' +
    'failing. THAT is how a partial outage becomes a total one — the retry traffic keeps it down.\n\n' +
    'The industry answer is a RETRY BUDGET at the client library level: allow retries only while\n' +
    'they are, say, under 10% of total requests. Under a broad outage that ratio blows immediately\n' +
    'and retries stop, which is exactly when you want them to.';
});

on('status', async () => {
  log.head('— retrying a 400 —');
  for (let i = 1; i <= 3; i++) {
    const r = await fetch('/api/asset?name=nope&status=400');
    log.bad(`attempt ${i}: HTTP ${r.status} — retrying will not change this`);
  }
  out.textContent =
    'Three identical failures. A 4xx means YOU sent something wrong: a malformed body, a missing\n' +
    'field, an expired token, a permission you do not have. Sending it again produces the same\n' +
    'answer, and the only thing your retry achieved was load.\n\n' +
    'The classification worth memorising:\n\n' +
    '  RETRY:      network errors, timeouts, 502/503/504, and 429 (obey Retry-After)\n' +
    '  DO NOT:     400, 401, 403, 404, 409, 422 — the request is wrong, not the moment\n' +
    '  SPECIAL:    401 → refresh the token ONCE, then retry once. Never a loop.\n' +
    '              408 and 425 are retryable; 409 usually means "re-read and re-decide", which is a\n' +
    '              different action than a retry.\n\n' +
    'And for 429 specifically: Retry-After is a server telling you the answer. Honour it. A client\n' +
    'that ignores Retry-After and applies its own backoff is guessing at something it was told.';
});

on('matrix', () => {
  renderTable('#results', [
    { method: 'GET', idempotent: 'yes (by spec)', retry: 'freely' },
    { method: 'PUT', idempotent: 'yes (by spec)', retry: 'freely — it sets state, it does not change it by a delta' },
    { method: 'DELETE', idempotent: 'yes (by spec)', retry: 'freely — the second one 404s, which is fine' },
    { method: 'POST /charge', idempotent: 'NO', retry: 'only with an idempotency key' },
    { method: 'POST /search', idempotent: 'in practice yes', retry: 'freely — POST used as a read' },
    { method: 'PATCH { count: +1 }', idempotent: 'NO', retry: 'never; redesign as a PUT of an absolute value' },
    { method: 'PATCH { status: "done" }', idempotent: 'yes', retry: 'freely — it is a fact, not a delta' },
  ], { columns: ['method', 'idempotent', 'retry'] });
  out.textContent =
    'Compare the last two rows: the same HTTP method, and one is safe to retry while the other\n' +
    'corrupts data. IDEMPOTENCE IS A PROPERTY OF THE OPERATION, NOT OF THE METHOD — the method is\n' +
    'only a convention that tells intermediaries what to assume.\n\n' +
    'Which gives you a design rule that removes most of this work: PREFER SETTING FACTS OVER\n' +
    'APPLYING DELTAS. "status = done" and "quantity = 3" can arrive twice, late, or out of order and\n' +
    'still end correct. "increment quantity" cannot. The same rule appears in realtime-ui lab 03\n' +
    'for exactly the same reason — an at-least-once world rewards commutative, idempotent\n' +
    'operations, and punishes deltas.\n\n' +
    'The other half of the design: make the CLIENT able to answer "did it happen?" Give mutations a\n' +
    'client-generated id, and provide a way to look up the result by that id. Then a client that\n' +
    'crashed mid-request can find out what happened instead of guessing — see\n' +
    'architecture-and-state lab 04.';
});

on('reset', async () => { await fetch('/api/reset'); charges = []; seen.clear(); paint(); log.muted('reset'); });
on('clear', () => log.clear());
