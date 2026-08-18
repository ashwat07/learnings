import { makeServer, listen, makeClient } from './world.mjs';

export const title = 'Shutting down without dropping requests';
export const task = `SIGTERM arrives. Your orchestrator will SIGKILL you in 30 seconds. You have
in-flight requests, idle keep-alive sockets, and a load balancer that has not noticed yet.

Implement createShutdown(server, { graceMs, onDraining }) -> async () => 'clean' | 'forced'.

  · call onDraining() FIRST, so /health starts returning 503 and the load balancer takes you out
  · stop accepting new connections
  · let in-flight requests finish
  · resolve as soon as they have — do not sit there waiting on idle keep-alive sockets
  · after graceMs, stop being polite: kill what is left and resolve 'forced'`;
export const passIf = 'no in-flight request is dropped, new connections are refused, and it never hangs on an idle socket';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function check(s) {
  if (typeof s.createShutdown !== 'function') {
    return [{ check: 'exports createShutdown(server, { graceMs, onDraining })', actual: 'missing', pass: false }];
  }
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 60), pass: false }); }
  };

  // --- scenario A: in-flight work must survive, idle sockets must not hold us hostage ---
  {
    const { server, state } = makeServer();
    const port = await listen(server);
    const client = makeClient(port);
    let drainedAt = null;

    const shutdown = s.createShutdown(server, { graceMs: 5000, onDraining: () => { drainedAt = Date.now(); } });

    // Five slow requests in flight...
    const inFlight = Array.from({ length: 5 }, () => client.get('/slow?ms=400'));
    // ...and one client that made a request, finished it, and is now sitting on an idle socket.
    await client.get('/quick?ms=0');
    await sleep(60);

    const t0 = Date.now();
    const verdict = await Promise.race([shutdown(), sleep(8000).then(() => 'HUNG')]);
    const shutdownMs = Date.now() - t0;
    const results = await Promise.allSettled(inFlight);
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value.status === 200 && r.value.body === 'done');

    out.push({ check: 'shutdown() did not hang on the idle keep-alive socket', actual: verdict === 'HUNG' ? 'still waiting after 8s' : `${verdict} in ${shutdownMs}ms`, pass: verdict !== 'HUNG' });
    out.push({ check: 'all 5 in-flight requests completed with 200', actual: `${ok.length}/5 ok, ${state.aborted} aborted mid-response`, pass: ok.length === 5 && state.aborted === 0 });
    out.push({ check: 'it waited for them rather than exiting instantly', actual: `${shutdownMs}ms for 400ms requests`, pass: shutdownMs >= 300 });
    out.push({ check: 'onDraining ran before anything closed', actual: drainedAt ? `${t0 - drainedAt}ms before / at shutdown` : 'never called', pass: drainedAt !== null && drainedAt <= t0 + 50 });
    out.push({ check: "it reported a clean shutdown", actual: String(verdict), pass: verdict === 'clean' });

    client.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r)).catch(() => {});
  }

  // --- scenario B: new work must be refused once draining has begun ---
  {
    const { server } = makeServer();
    const port = await listen(server);
    const client = makeClient(port);
    const shutdown = s.createShutdown(server, { graceMs: 5000, onDraining: () => {} });

    const inFlight = client.get('/slow?ms=500');
    await sleep(30);
    const done = shutdown();
    await sleep(80);

    let refused = 'accepted';
    try {
      const fresh = makeClient(port);                 // a NEW connection, not the pooled one
      await fresh.get('/slow?ms=0');
      fresh.close();
    } catch (e) { refused = e.code ?? e.message; }

    await Promise.allSettled([inFlight, done]);
    out.push({ check: 'a NEW connection during shutdown is refused', actual: refused, pass: refused !== 'accepted' });
    client.close();
    server.closeAllConnections?.();
  }

  // --- scenario C: a request that outlives the grace period must not outlive the process ---
  {
    const { server } = makeServer();
    const port = await listen(server);
    const client = makeClient(port);
    const shutdown = s.createShutdown(server, { graceMs: 300, onDraining: () => {} });

    const stuck = client.get('/forever?ms=20000');
    stuck.catch(() => {});
    await sleep(50);

    const t0 = Date.now();
    const verdict = await Promise.race([shutdown(), sleep(4000).then(() => 'HUNG')]);
    const ms = Date.now() - t0;

    out.push({ check: 'a 20s request does not stop a 300ms grace period', actual: verdict === 'HUNG' ? 'hung — SIGKILL would have got you' : `${verdict} in ${ms}ms`, pass: verdict !== 'HUNG' && ms < 1500 });
    out.push({ check: "and it says so: 'forced', not 'clean'", actual: String(verdict), pass: verdict === 'forced' });

    client.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r)).catch(() => {});
  }

  return out;
}
