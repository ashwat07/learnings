import { makeService, sleep, NonRetryable, Unavailable } from '../../world.mjs';

export const title = 'Deadline propagation and a shared retry budget';
export const task = `Three hops: gateway -> orders -> inventory. Each one has a sensible 1-second
timeout and retries twice. Every component is correct in isolation.

Now count. Two retries per hop over three hops is up to EIGHT calls to the leaf for one request,
and each hop starts its 1-second timeout fresh — so the client gives up at 1s while the chain is
still working, three hops deep, on a request nobody is waiting for.

Neither the timeout nor the retry is wrong. The composition is.

Implement call(next, req, ctx):

  ctx = { deadline, signal, budget }
    deadline   an absolute epoch-ms instant. Not a duration — a POINT IN TIME, so it means the
               same thing at every hop.
    signal     an AbortSignal that fires when the caller gives up.
    budget     shared across the whole request: budget.tryTake() -> boolean

  next(req, ctx) is the downstream service. Pass it a context, and pass it the RIGHT one.`;
export const passIf = 'the deadline is honoured and shrinks at each hop, retries come out of one shared budget, and nothing runs after the client has gone';

const DEADLINE_MS = 500;

function makeBudget(max) {
  let taken = 0;
  return { tryTake() { if (taken >= max) return false; taken++; return true; }, get taken() { return taken; }, max };
}

// The chain the drill assembles: gateway calls orders, orders calls inventory.
function chain(s, leaf, mid) {
  const orders = (req, ctx) => s.call((r, c) => leaf.handle(r, c), req, ctx);
  const gateway = (req, ctx) => s.call((r, c) => (mid ? mid.handle(r, c) : orders(r, c)), req, ctx);
  return { orders, gateway };
}

export async function check(s) {
  if (typeof s.call !== 'function') return [{ check: 'exports call(next, req, ctx)', actual: 'missing', pass: false }];
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 66), pass: false }); }
  };

  const run = async ({ leafOpts, deadlineMs = DEADLINE_MS, budget = 4 }) => {
    const leaf = makeService({ name: 'inventory', seed: 7, ...leafOpts });
    const b = makeBudget(budget);
    const ac = new AbortController();
    const ctx = { deadline: Date.now() + deadlineMs, signal: ac.signal, budget: b };
    const { gateway } = chain(s, leaf);
    const t0 = Date.now();
    let result = null, err = null;
    try { result = await gateway({ id: 1 }, ctx); } catch (e) { err = e; }
    return { leaf, budget: b, ac, elapsed: Date.now() - t0, result, err, ctx };
  };

  await guard('a healthy request succeeds, and the leaf is called once', async () => {
    const r = await run({ leafOpts: { latencyMs: 10 } });
    if (r.err) return `failed: ${r.err.message}`;
    return r.leaf.callCount === 1 ? true : `the leaf was called ${r.leaf.callCount} times for one healthy request`;
  });

  await guard('the deadline SHRINKS on the way down', async () => {
    const r = await run({ leafOpts: { latencyMs: 30 } });
    const seen = r.leaf.calls[0]?.deadline;
    if (seen == null) return 'the leaf received no deadline at all — it cannot know when to stop';
    // It must be <= the caller's, and strictly less if any time was spent above.
    if (seen > r.ctx.deadline) return `the leaf got a LATER deadline (${seen - r.ctx.deadline}ms later) than the caller's — each hop is resetting the clock`;
    return true;
  });

  await guard('a slow leaf does not blow the client budget', async () => {
    const r = await run({ leafOpts: { latencyMs: 3000 } });
    if (!r.err) return 'it returned a result after the deadline should have expired';
    return r.elapsed < DEADLINE_MS + 200
      ? true : `took ${r.elapsed}ms against a ${DEADLINE_MS}ms deadline`;
  });

  await guard('...and it fails with a DEADLINE error, not a generic one', async () => {
    const r = await run({ leafOpts: { latencyMs: 3000 } });
    return /deadline/i.test(r.err?.message ?? '') ? true : `error was: ${r.err?.message}`;
  });

  // THE amplification check.
  // The bound is budget + one free first attempt per hop (2 hops here), NOT budget alone: charging
  // the first attempt would let one failing hop spend the whole request's allowance before any
  // other hop got a turn. What must never happen is MULTIPLICATION.
  await guard('a totally broken leaf costs budget + 1 per hop, not budget^hops', async () => {
    const r = await run({ leafOpts: { latencyMs: 5, failRate: 1 }, budget: 4 });
    if (!r.err) return 'it succeeded against a leaf that always fails';
    return r.leaf.callCount <= 6
      ? true
      : `the leaf was called ${r.leaf.callCount} times for ONE request with a budget of 4. ` +
        `Per-hop retries MULTIPLY: 2 hops x 2 retries is 8, 3 x 3 is 27, and that is the load you ` +
        `add to a dependency at the exact moment it is failing.`;
  });

  await guard('the shared budget is actually consumed (retries did happen)', async () => {
    const r = await run({ leafOpts: { latencyMs: 5, failRate: 1 }, budget: 4 });
    return r.budget.taken > 1
      ? true : `the budget recorded ${r.budget.taken} takes — a transient failure should be retried at least once`;
  });

  await guard('a non-retryable error is not retried', async () => {
    let calls = 0;
    const next = async () => { calls++; throw new NonRetryable('422 unprocessable'); };
    const b = makeBudget(4);
    const ctx = { deadline: Date.now() + 500, signal: new AbortController().signal, budget: b };
    await s.call(next, { id: 1 }, ctx).catch(() => {});
    return calls === 1 ? true : `a 4xx-class error was attempted ${calls} times — it will fail identically every time`;
  });

  await guard('no retry is STARTED once the deadline has passed', async () => {
    // Each attempt takes 120ms and fails; a 250ms deadline permits two, not four.
    let calls = 0;
    const next = async (req, ctx) => { calls++; await sleep(120); throw new Unavailable('down'); };
    const b = makeBudget(10);
    const ctx = { deadline: Date.now() + 250, signal: new AbortController().signal, budget: b };
    const t0 = Date.now();
    await s.call(next, { id: 1 }, ctx).catch(() => {});
    const elapsed = Date.now() - t0;
    if (calls > 3) return `${calls} attempts inside a 250ms deadline — a retry with no time left is pure load`;
    return elapsed < 450 ? true : `kept retrying for ${elapsed}ms past a 250ms deadline`;
  });

  // The one that is invisible without instrumentation.
  await guard('when the client goes away, downstream work STOPS', async () => {
    const leaf = makeService({ name: 'inventory', latencyMs: 2000, seed: 3 });
    const b = makeBudget(4);
    const ac = new AbortController();
    const ctx = { deadline: Date.now() + 5000, signal: ac.signal, budget: b };
    const { gateway } = chain(s, leaf);
    const p = gateway({ id: 1 }, ctx).catch(() => {});
    await sleep(60);
    const at = Date.now();
    ac.abort();                       // the user closed the tab
    await sleep(200);
    await p;
    const started = leaf.callsAfter(at);
    const stillRunning = leaf.calls.filter((c) => !c.finishedAt && !c.abandoned).length;
    if (started > 0) return `${started} new leaf calls STARTED after the client gave up`;
    return stillRunning === 0
      ? true
      : `${stillRunning} leaf calls are still running for a client that has gone — the signal was ` +
        `not propagated, so you are doing work nobody will read`;
  });

  await guard('under load, 200 requests against a 30%-slow leaf stay bounded', async () => {
    const leaf = makeService({ name: 'inventory', latencyMs: 10, slowRate: 0.3, slowMs: 1200, seed: 11 });
    const { gateway } = chain(s, leaf);
    const lat = [];
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 200 }, async () => {
      const ac = new AbortController();
      const ctx = { deadline: Date.now() + DEADLINE_MS, signal: ac.signal, budget: makeBudget(3) };
      const s0 = Date.now();
      await gateway({ id: 1 }, ctx).catch(() => {});
      lat.push(Date.now() - s0);
    }));
    lat.sort((a, b) => a - b);
    const p99 = lat[Math.floor(lat.length * 0.99)];
    const perRequest = leaf.callCount / 200;
    if (p99 > DEADLINE_MS + 250) return `p99 ${p99}ms against a ${DEADLINE_MS}ms deadline`;
    return perRequest <= 3
      ? true : `${perRequest.toFixed(1)} leaf calls per request on average — that is amplification, and it grows with every hop you add`;
  });

  return out;
}
