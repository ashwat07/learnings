/** Drill 07 — reference. */

export function createShutdown(server, { graceMs = 15_000, onDraining = () => {} } = {}) {
  // Count requests, not connections. A keep-alive connection is idle most of its life, and idle
  // is exactly what we are allowed to close.
  let inFlight = 0;
  let draining = false;
  let idle = null;                       // resolves when inFlight hits 0 during draining

  server.on('request', (req, res) => {
    inFlight++;
    // Tell the client this connection will not be reused. Without it, a client that gets a
    // response mid-shutdown will happily send its NEXT request down a socket you are about to
    // close, and see an ECONNRESET it cannot distinguish from a real failure.
    if (draining) res.setHeader('Connection', 'close');
    res.on('close', () => {
      inFlight--;
      if (draining && inFlight === 0) idle?.();
      // Every response completing is a chance to sweep up sockets that just went idle.
      if (draining) server.closeIdleConnections?.();
    });
  });

  return async function shutdown() {
    if (draining) return 'clean';
    draining = true;

    // 1. FAIL THE HEALTH CHECK FIRST, AND ONLY THEN STOP LISTENING.
    //    The load balancer needs a poll interval or two to notice you are gone. If you stop
    //    accepting before it has, every request it routes to you in that window is a hard
    //    connection refusal — a 502 the client sees. In Kubernetes this is why a preStop hook
    //    that just sleeps 5 seconds fixes more 502s than any code change: it buys the time
    //    between "I am unhealthy" and "I am gone".
    onDraining();

    const waitForIdle = new Promise((resolve) => {
      idle = resolve;
      if (inFlight === 0) resolve();
    });

    // 2. Stop accepting new connections. Existing ones keep working.
    const closed = new Promise((resolve) => server.close(resolve));

    // 3. Close the sockets that are sitting idle. THIS is the line that stops the 60-second hang:
    //    server.close() alone waits for them, and keep-alive means they are in no hurry.
    server.closeIdleConnections?.();

    // 4. Wait for real work to finish — but only up to the grace period.
    const forced = await Promise.race([
      waitForIdle.then(() => false),
      new Promise((r) => setTimeout(() => r(true), graceMs)),
    ]);

    if (forced) {
      // 5. Time is up. A request still running now will not finish before SIGKILL either, and
      //    holding the process open only means the orchestrator kills you at a moment of its
      //    choosing instead of yours. Cut them, log them, exit.
      server.closeAllConnections?.();
    }

    await Promise.race([closed, new Promise((r) => setTimeout(r, 500))]);
    return forced ? 'forced' : 'clean';
  };
}

/*
THE SEQUENCE, AND WHY EACH STEP IS WHERE IT IS

  1. flip readiness to unhealthy        so the LB stops sending you work
  2. (in production: sleep 2-5s)        so the LB actually notices — this is a preStop hook, not
                                        code, and it is the single highest-value line in most
                                        Kubernetes deployments
  3. server.close()                     stop accepting new connections
  4. closeIdleConnections()             release keep-alive sockets that are between requests
  5. wait for in-flight, with a budget  the actual "graceful" part
  6. closeAllConnections()              the deadline. Always shorter than terminationGracePeriod
  7. close the other things             database pool, message consumer, cron, metrics flush —
                                        in that order, because a consumer that is still pulling
                                        jobs after the pool is closed just fails them

WIRING IT UP

  const shutdown = createShutdown(server, { graceMs: 15000, onDraining: () => { ready = false } });
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
      const how = await shutdown();
      await pool.end();
      process.exit(how === 'clean' ? 0 : 1);
    });
  }

`process.once`, not `on`: a second SIGTERM while you are draining should not start a second
shutdown. And note the exit code — a forced shutdown is a signal worth alerting on, because it
means your grace period is shorter than your slowest request.

TWO THINGS THAT LOOK LIKE THIS PROBLEM AND ARE NOT

  · process.exit() in a signal handler skips all of the above, including flushing stdout. Your
    last log line — the one explaining the shutdown — is the one you lose.
  · `server.close()` does NOT close active WebSocket connections, because they are not requests.
    Track those separately and send a close frame, or your "graceful" shutdown drops every
    subscriber with no explanation (realtime-ui lab 03).

THE HEALTH-CHECK DISTINCTION THAT MATTERS
  liveness   "am I alive?"  → must NOT fail during shutdown, or you get killed mid-drain
  readiness  "send me work?" → this is the one you flip in onDraining
Getting these the wrong way round turns a clean rolling deploy into a wave of 502s.
*/
