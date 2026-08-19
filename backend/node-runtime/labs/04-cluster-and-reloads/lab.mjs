/**
 * Lab 04 — Clustering, and reloading without dropping a request.
 *
 *   node node-runtime/labs/04-cluster-and-reloads/lab.mjs
 *
 * One process uses one core. This lab forks a cluster across all of them, then breaks it twice:
 * once by killing a worker the way `kill -9` and an unhandled exception do, and once gracefully.
 * Both times it counts the requests that failed, under continuous load.
 *
 * The numbers at the end are the entire lab.
 */

import cluster from 'node:cluster';
import http from 'node:http';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PORT = 8127;
const WORKERS = Math.min(4, Math.max(2, os.availableParallelism() - 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// THE WORKER
// ---------------------------------------------------------------------------
if (!cluster.isPrimary) {
  let draining = false;
  let inFlight = 0;

  const server = http.createServer((req, res) => {
    inFlight++;
    // Every response takes 40ms, so there is always work in flight when we pull the rug out.
    setTimeout(() => {
      if (draining) res.setHeader('Connection', 'close');
      res.end(String(process.pid));
      inFlight--;
      if (draining && inFlight === 0) server.closeIdleConnections?.();
    }, 40);
  });
  server.keepAliveTimeout = 30_000;

  // Every worker calls listen() on the SAME port. cluster makes that work: on Linux and macOS
  // the PRIMARY owns the listening socket and hands accepted connections to workers round-robin
  // (cluster.SCHED_RR, the default everywhere except Windows). The workers never bind the port
  // at all — which is why this does not fail with EADDRINUSE, and why the OS scheduler is not
  // what balances your load.
  server.listen(PORT, () => process.send?.({ type: 'listening' }));

  // The graceful half, exactly as in drill 07 — the primary tells us to drain, and we tell it
  // when we are done, rather than being killed while holding requests.
  process.on('message', async (msg) => {
    if (msg?.type !== 'drain') return;
    draining = true;
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    const until = Date.now() + 3000;
    while (inFlight > 0 && Date.now() < until) await sleep(10);
    server.closeAllConnections?.();
    process.exit(0);
  });

  // Nothing below this line runs in a worker.
} else {
  // -------------------------------------------------------------------------
  // THE PRIMARY
  // -------------------------------------------------------------------------
  const { rule, note, table, good, bad } = await import('../../../lib/console.mjs');

  cluster.setupPrimary({ exec: fileURLToPath(import.meta.url) });

  const forkAndWait = () => new Promise((resolve) => {
    const w = cluster.fork();
    w.on('message', (m) => { if (m?.type === 'listening') resolve(w); });
  });

  rule('CLUSTERING IN ONE PARAGRAPH');
  console.log(`
  Node runs your JavaScript on one thread, so one process uses one core. cluster.fork() starts
  additional PROCESSES — full copies, own heap, own event loop, no shared memory — and lets them
  all accept connections on one port. That is horizontal scaling inside a single machine, and it
  is a completely different tool from worker_threads (drill 09), which shares a process and is
  for CPU-bound work inside one request.

    cluster       N processes, N event loops, no shared state. For THROUGHPUT.
    worker_threads N threads in one process, shared ArrayBuffers possible. For ONE SLOW TASK.

  This machine reports ${os.availableParallelism()} of available parallelism; forking ${WORKERS} workers.`);

  rule('starting the cluster');
  const started = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, forkAndWait));
  good(`${WORKERS} workers listening on :${PORT} after ${Date.now() - started}ms`);

  // A closed-loop load generator: 24 in flight, continuously, for the duration of each phase.
  const load = (ms) => {
    const result = { ok: 0, failed: 0, pids: new Map(), errors: new Map() };
    const until = Date.now() + ms;
    const one = async () => {
      while (Date.now() < until) {
        try {
          const res = await fetch(`http://127.0.0.1:${PORT}/`);
          const pid = await res.text();
          if (res.ok) { result.ok++; result.pids.set(pid, (result.pids.get(pid) ?? 0) + 1); }
          else result.failed++;
        } catch (e) {
          result.failed++;
          const code = e.cause?.code ?? e.message;
          result.errors.set(code, (result.errors.get(code) ?? 0) + 1);
        }
      }
    };
    return Promise.all(Array.from({ length: 24 }, one)).then(() => result);
  };

  // --- phase 0: is the load actually spread? ---
  rule('1. the load is spread across the workers');
  const baseline = await load(1200);
  table([...baseline.pids.entries()].map(([pid, n]) => ({ 'worker pid': pid, requests: n })), ['worker pid', 'requests']);
  note(`${baseline.ok} requests, ${baseline.failed} failed`);
  console.log(`
  Roughly even, because the primary distributes accepted connections round-robin. Note it is
  round-robin over CONNECTIONS, not requests: with HTTP keep-alive a client that holds one
  connection sends every request to the same worker. That is fine for many clients and terrible
  for a few chatty ones, and it is the reason a load balancer in front of N pods usually beats
  cluster inside one pod once you have more than one machine.`);

  // --- phase 1: the ungraceful death ---
  rule('2. killing a worker the way a crash does');
  const victimA = Object.values(cluster.workers)[0];
  const crashRun = load(1600);
  setTimeout(() => {
    // SIGKILL is what an OOM kill, a `kill -9`, and (via the default handler) an uncaught
    // exception amount to: the process stops mid-response, holding open sockets.
    victimA.process.kill('SIGKILL');
  }, 400);
  const crashed = await crashRun;
  const crashErrors = [...crashed.errors.entries()].map(([k, v]) => `${k} x${v}`).join(', ') || 'none';
  (crashed.failed ? bad : good)(`${crashed.ok} ok, ${crashed.failed} FAILED — ${crashErrors}`);

  // Replace it, so the next phase starts from a full cluster.
  await forkAndWait();
  await sleep(200);

  // --- phase 2: the rolling reload ---
  rule('3. a rolling reload, one worker at a time');
  const reloadRun = load(2600);
  setTimeout(async () => {
    for (const w of Object.values(cluster.workers)) {
      // START THE REPLACEMENT FIRST, and wait until it is actually listening. This is the whole
      // trick: capacity never dips, because the new worker is accepting before the old one stops.
      await forkAndWait();
      // Only then ask the old one to drain: stop accepting, finish what it is holding, exit.
      const gone = new Promise((r) => w.once('exit', r));
      w.send({ type: 'drain' });
      await Promise.race([gone, sleep(4000)]);
      if (!w.isDead()) w.process.kill('SIGKILL');     // the deadline, as always
    }
  }, 300);
  const reloaded = await reloadRun;
  const reloadErrors = [...reloaded.errors.entries()].map(([k, v]) => `${k} x${v}`).join(', ') || 'none';
  (reloaded.failed ? bad : good)(`${reloaded.ok} ok, ${reloaded.failed} failed — ${reloadErrors}`);

  rule('the result');
  table([
    { event: 'steady state', requests: baseline.ok, failed: baseline.failed },
    { event: 'one worker SIGKILLed', requests: crashed.ok, failed: crashed.failed },
    { event: `all ${WORKERS} workers rolled, one at a time`, requests: reloaded.ok, failed: reloaded.failed },
  ], ['event', 'requests', 'failed']);

  console.log(`
  The middle row is what a crash, an OOM kill, or an unhandled exception costs you: every request
  that worker was holding, plus every connection a client had already established to it. The
  bottom row replaced EVERY worker in the cluster — a full deploy — and, done in the right order,
  costs nothing.

  THE ORDER IS THE ENTIRE TECHNIQUE, and it is the same three steps whether the unit is a worker,
  a container or a VM:

    1. start the replacement
    2. WAIT until it is actually ready — listening, warmed, health check green. Not "forked".
       Skipping this is why a rolling deploy still drops requests: for a second there is a worker
       that has been counted as capacity and cannot answer.
    3. only now tell the old one to drain, and give it a deadline

  In Kubernetes those three steps are: a new pod, a READINESS probe, and terminationGracePeriod
  plus a preStop hook. Same shape, bigger units. If you understand it here you understand it
  there, and the failure modes are identical.

  WHAT CLUSTER DOES NOT SOLVE
    · shared state. Four workers means four in-process caches, four rate-limiter counters, four
      WebSocket rooms. Anything that must be shared goes in Redis — this is the single most
      common bug when a service moves from one process to four, and it appears as "the rate limit
      is 4x what I configured".
    · sticky sessions. Round-robin over connections means a WebSocket lands on one worker and
      stays there; another worker cannot push to it without a pub/sub bus.
    · memory. N workers means N copies of your heap. Four workers x 300MB is 1.2GB, and each one
      needs its own --max-old-space-size well under the container limit.

  AND THE HONEST COMPARISON WITH JUST RUNNING MORE PODS
  cluster gives you multi-core inside one container. Kubernetes gives you multi-core across many.
  If you are already on an orchestrator, one process per container is simpler: the scheduler sees
  real resource usage, a crash restarts one small thing, and you have one less supervisor to
  debug. Use cluster when you control the box, or when the container is large and you want to
  fill it. PM2 is cluster plus a supervisor, log handling and a reload command — worth it outside
  a container, redundant inside one.`);

  for (const w of Object.values(cluster.workers)) w.process.kill('SIGKILL');
  await sleep(200);
  process.exit(0);
}
