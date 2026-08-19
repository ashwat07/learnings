/**
 * Lab 03 — Diagnostics: finding out what is actually happening.
 *
 *   node --expose-gc node-runtime/labs/03-diagnostics/lab.mjs
 *
 * Six tools, each demonstrated on a process that is genuinely misbehaving. The point of the lab
 * is that all of these ship WITH Node — no agent, no vendor, no npm install — and almost nobody
 * uses them until an incident, which is the worst time to learn a tool.
 */

import { performance, PerformanceObserver, monitorEventLoopDelay, createHistogram } from 'node:perf_hooks';
import diagnostics_channel from 'node:diagnostics_channel';
import inspector from 'node:inspector';
import v8 from 'node:v8';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { rule, note, table, good } from '../../../lib/console.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const burn = (ms) => { const end = performance.now() + ms; let x = 0; while (performance.now() < end) x = Math.imul(x ^ 1, 2654435761); return x; };

// ---------------------------------------------------------------------------
rule('1. monitorEventLoopDelay — the one number to alert on');

{
  // A HISTOGRAM, sampled by libuv itself at a fixed interval, in nanoseconds. This is strictly
  // better than the setInterval-drift trick every blog post shows, because it is sampled in C
  // rather than in JavaScript — so it keeps measuring accurately while your JS is blocked, which
  // is exactly when you need it.
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();

  for (let i = 0; i < 12; i++) { burn(i % 4 === 0 ? 45 : 3); await sleep(10); }

  h.disable();
  table([
    { percentile: 'min', ms: (h.min / 1e6).toFixed(1) },
    { percentile: 'p50', ms: (h.percentile(50) / 1e6).toFixed(1) },
    { percentile: 'p90', ms: (h.percentile(90) / 1e6).toFixed(1) },
    { percentile: 'p99', ms: (h.percentile(99) / 1e6).toFixed(1) },
    { percentile: 'max', ms: (h.max / 1e6).toFixed(1) },
  ], ['percentile', 'ms']);

  console.log(`
  Event loop delay is the single most informative number a Node service can emit. It is not
  "CPU usage" — a process can sit at 30% CPU with a 400ms p99 delay because one handler blocks.
  It is the answer to "is this process able to respond?", and it leads every other metric: the
  delay climbs before latency does, and latency climbs before the errors do.

  Alert on the p99, not the mean. A mean of 2ms with a p99 of 300ms is a service where one
  request in a hundred waits a third of a second for a turn — which is invisible in the mean and
  extremely visible to the user having it.

  Thresholds worth starting from: p99 under 20ms is healthy, over 100ms is a problem you can
  feel, over 1s means requests are timing out somewhere downstream of you.`);
}

// ---------------------------------------------------------------------------
rule('2. GC observation — what the collector is costing you');

{
  const kinds = { 1: 'scavenge (young gen)', 2: 'mark-sweep-compact (major)', 4: 'incremental marking', 8: 'weak callbacks' };
  const seen = [];
  const obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) seen.push(e); });
  obs.observe({ entryTypes: ['gc'] });

  // Allocate hard enough to force both kinds of collection.
  let keep = [];
  for (let i = 0; i < 60; i++) {
    const garbage = Array.from({ length: 20000 }, (_, j) => ({ i, j, s: `x${j}` }));
    if (i % 10 === 0) keep.push(garbage.slice(0, 500));      // some of it survives
    if (keep.length > 4) keep.shift();
    await sleep(1);
  }
  globalThis.gc?.();
  await sleep(60);
  obs.disconnect();

  const byKind = {};
  for (const e of seen) {
    const k = kinds[e.detail?.kind] ?? `kind ${e.detail?.kind}`;
    byKind[k] ??= { count: 0, total: 0, max: 0 };
    byKind[k].count++;
    byKind[k].total += e.duration;
    byKind[k].max = Math.max(byKind[k].max, e.duration);
  }
  table(Object.entries(byKind).map(([kind, v]) => ({
    'GC kind': kind, count: v.count, 'total ms': v.total.toFixed(1), 'worst pause': `${v.max.toFixed(2)}ms`,
  })), ['GC kind', 'count', 'total ms', 'worst pause']);

  const stats = v8.getHeapStatistics();
  table([
    { 'heap statistic': 'used', value: `${(stats.used_heap_size / 1048576).toFixed(1)}MB` },
    { 'heap statistic': 'total allocated', value: `${(stats.total_heap_size / 1048576).toFixed(1)}MB` },
    { 'heap statistic': 'limit (--max-old-space-size)', value: `${(stats.heap_size_limit / 1048576).toFixed(0)}MB` },
    { 'heap statistic': 'external (Buffers etc)', value: `${(stats.external_memory / 1048576).toFixed(1)}MB` },
  ], ['heap statistic', 'value']);

  console.log(`
  V8's heap is GENERATIONAL, and the two rows above are why that matters:

    SCAVENGE   collects the young generation by copying the few survivors to the other half of a
               small space. Cost is proportional to what SURVIVES, not to what died. Frequent,
               and usually under a millisecond — allocating short-lived garbage is genuinely
               cheap, which is why "avoid allocation" is bad advice without a profile.
    MARK-SWEEP collects the old generation: everything that survived enough scavenges to be
               promoted. Cost is proportional to the LIVE SET. Rare, and the pauses are the ones
               you see in your latency graph.

  The practical consequence: the expensive thing is not garbage, it is SURVIVAL. A cache that
  holds a million objects makes every major GC slower, forever. That is a second reason to bound
  a cache, on top of the memory (drill 13).

  Your heap limit here is ${(stats.heap_size_limit / 1048576).toFixed(0)}MB. In a container this
  is the number that decides whether you OOM: Node does NOT read your cgroup limit, so a pod with
  512MB and Node's default ~2GB heap limit will happily get OOM-killed by the kernel with no
  JavaScript error at all. Set --max-old-space-size to roughly 75% of the container limit.`);
}

// ---------------------------------------------------------------------------
rule('3. A CPU profile, taken from inside the process');

{
  // The same profiler DevTools uses, driven from JavaScript. This is how you profile a process
  // you cannot attach a debugger to — behind a flag, triggered by a signal or an admin endpoint.
  const session = new inspector.Session();
  session.connect();
  const post = (method, params) => new Promise((resolve, reject) =>
    session.post(method, params, (err, res) => (err ? reject(err) : resolve(res))));

  // Deliberately named for what they LOOK like. String building in a loop is the thing everyone
  // flags in review; a plain integer sum is the thing nobody looks at twice.
  const looksExpensive = (n) => { let s = ''; for (let i = 0; i < n; i++) s += `${i}`; return s.length; };
  const looksCheap = (n) => { let t = 0; for (let i = 0; i < n; i++) t += i; return t; };

  await post('Profiler.enable');
  await post('Profiler.start');
  for (let i = 0; i < 12; i++) { looksExpensive(20000); looksCheap(2_000_000); }
  const { profile } = await post('Profiler.stop');
  session.disconnect();

  // Self time per function, which is what a flame graph shows you as bar WIDTH.
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const total = profile.timeDeltas.reduce((a, b) => a + b, 0);
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]);
    const key = `${node.callFrame.functionName || '(anonymous)'}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  table(top.map(([fn, us]) => ({ function: fn, 'self time': `${(us / 1000).toFixed(1)}ms`, '% of profile': `${((us / total) * 100).toFixed(1)}%` })),
    ['function', 'self time', '% of profile']);

  console.log(`
  Read the two top rows before anything else. The string-building loop — the thing that gets
  flagged in every code review — is about 2% of this profile. The integer sum nobody would look
  at twice is three quarters of it, because it runs a hundred times more often. That is the
  entire argument for profiling: your intuition ranks by how expensive an operation LOOKS, and
  the profile ranks by cost x frequency, which is the only ranking that matters.

  A CPU profile is a SAMPLE: the profiler interrupts every ~1ms and records the stack. So the
  number above is "how often was this function on top of the stack", which is what you want, and
  it means anything that runs for less than a few milliseconds total is statistically invisible.

  Three ways to get one, in increasing order of intrusiveness:
    node --cpu-prof app.js         writes a .cpuprofile on exit; open it in DevTools or VS Code
    node --inspect app.js          attach chrome://inspect and hit record
    the code above                 in-process, so you can trigger it in production behind an
                                   admin route or a SIGUSR2 handler and profile the thing that
                                   is only slow at 3am

  And for flame graphs across the whole stack — including the C++ and the kernel — use
  \`0x\` or Linux perf. Node's own profile stops at the JavaScript boundary, which is exactly
  the wrong place to stop when the answer is "we are spending 40% of our time in TLS".`);
}

// ---------------------------------------------------------------------------
rule('4. diagnostics_channel — instrumenting without monkey-patching');

{
  // A publish/subscribe bus built into Node, with near-zero cost when nobody is listening.
  // Libraries publish; observability tools subscribe. Undici, Postgres clients and several
  // frameworks already publish on well-known channel names.
  const channel = diagnostics_channel.channel('lab:query');
  const spans = [];
  channel.subscribe((message) => spans.push(message));

  const query = async (sql) => {
    const start = performance.now();
    await sleep(5 + Math.random() * 10);
    // hasSubscribers first: building the message object costs nothing if nobody wants it, which
    // is what lets a library instrument its hot path unconditionally.
    if (channel.hasSubscribers) channel.publish({ sql, ms: performance.now() - start });
    return [];
  };

  await Promise.all(['SELECT 1', 'SELECT * FROM orders', 'UPDATE users SET x=1'].map(query));
  table(spans.map((s) => ({ query: s.sql, ms: s.ms.toFixed(1) })), ['query', 'ms']);

  console.log(`
  This is how OpenTelemetry's Node instrumentation is supposed to work, and how it increasingly
  does: the library publishes, the tracer subscribes. The alternative — monkey-patching
  \`Module.prototype.require\` and rewriting library internals at load time — is what most APM
  agents still do, and it is why upgrading a database driver can silently break your tracing.

  If you write a library, publish on a channel. If you run a service, subscribe to the ones your
  dependencies already publish:
    undici:request:create / :headers / :trailers / :error
    http.server.request.start   (Node 22+)
  Combine it with AsyncLocalStorage (drill 10) and you have request-scoped tracing in about
  thirty lines, with no agent.`);
}

// ---------------------------------------------------------------------------
rule('5. A load test, and why the mean is a lie');

{
  const server = http.createServer((req, res) => {
    // 1 request in 20 hits a slow path — a cold cache, a big customer, a lock.
    const slow = Math.random() < 0.05;
    setTimeout(() => res.end('ok'), slow ? 120 : 2);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const CONCURRENCY = 20, DURATION_MS = 1500;
  const latencies = createHistogram();
  const raw = [];
  let done = 0;
  const until = Date.now() + DURATION_MS;

  const worker = async () => {
    while (Date.now() < until) {
      const t0 = performance.now();
      await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
      const ms = performance.now() - t0;
      raw.push(ms);
      latencies.record(Math.max(1, Math.round(ms * 1000)));   // microseconds
      done++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));

  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  table([
    { measure: 'requests', value: done.toLocaleString() },
    { measure: 'throughput', value: `${Math.round(done / (DURATION_MS / 1000)).toLocaleString()} req/s` },
    { measure: 'mean', value: `${mean.toFixed(1)}ms` },
    { measure: 'p50', value: `${(latencies.percentile(50) / 1000).toFixed(1)}ms` },
    { measure: 'p95', value: `${(latencies.percentile(95) / 1000).toFixed(1)}ms` },
    { measure: 'p99', value: `${(latencies.percentile(99) / 1000).toFixed(1)}ms` },
    { measure: 'max', value: `${(latencies.max / 1000).toFixed(1)}ms` },
  ], ['measure', 'value']);

  console.log(`
  Five percent of these requests are sixty times slower than the rest, and the MEAN barely
  notices. The p99 does. That is the whole argument for percentiles, and it gets stronger as
  systems get bigger: a user whose page makes 20 API calls hits your p99 about one time in five.

  Two things this toy harness does that real ones do properly, and one it cannot:
    · fixed CONCURRENCY, measured throughput — not "fire 10,000 requests as fast as possible",
      which measures your client
    · latency recorded per request into a histogram, never averaged early — averaging percentiles
      across shards or over time windows is meaningless, which is why real systems ship
      histogram buckets, not summaries
    · COORDINATED OMISSION: a closed-loop client like this one waits for a slow response before
      sending the next request, so a stall UNDER-reports latency — the requests that would have
      arrived during the stall were never sent. Real tools (wrk2, k6) send at a fixed RATE to
      avoid it. If your load test says p99 is 50ms and production says 2s, this is usually why.

  Reach for autocannon (Node, easy), k6 (scriptable, rate-based) or wrk2 (fast, honest). Run them
  from a different machine than the one under test.`);
}

// ---------------------------------------------------------------------------
rule('6. a heap snapshot you can open in DevTools');

{
  const before = v8.getHeapStatistics().used_heap_size;
  const path = v8.writeHeapSnapshot(`${os.tmpdir()}/node-lab-03.heapsnapshot`);
  const size = fs.statSync(path).size;
  good(`wrote ${(size / 1048576).toFixed(1)}MB snapshot of a ${(before / 1048576).toFixed(1)}MB heap`);
  note(path);
  console.log(`
  Open it: Chrome DevTools -> Memory -> Load. Or in VS Code, just open the file.

  writeHeapSnapshot() works from inside a running process, which is the point: you can wire it to
  an admin endpoint or a SIGUSR2 handler and capture the heap of a container that is misbehaving
  in production, then analyse it at your desk. Note that it PAUSES the process for the duration
  (proportional to heap size — seconds for a large heap) and writes a file bigger than the heap
  itself, so do it on one pod, not all of them.

  The workflow that actually finds leaks is a COMPARISON, not a single snapshot: take one, apply
  load, take another, and use the Comparison view sorted by Delta. Then read the retainer chain.
  Drill 13 is that exercise with the answer hidden.`);
  fs.unlinkSync(path);
}

rule('the toolbox, in one place');
console.log(`
  monitorEventLoopDelay()       the number to alert on. Histogram, sampled in C.
  PerformanceObserver 'gc'      what the collector costs you, split by generation.
  performance.mark/measure      your own spans, visible in DevTools' timeline.
  v8.getHeapStatistics()        used / total / LIMIT. The limit is the OOM line.
  v8.writeHeapSnapshot()        in-process, openable in DevTools. Compare two.
  node --cpu-prof               a .cpuprofile on exit, no tooling required.
  node --heap-prof              allocation profile: WHERE the allocations happen.
  inspector.Session             both of the above, triggered from inside a running process.
  diagnostics_channel           instrument without monkey-patching.
  process.getActiveResourcesInfo()  what is keeping the loop alive right now.
  process.report.writeReport()  a diagnostic report: stacks, handles, limits, env. One call.
  --trace-warnings              turns a warning into a stack trace. Turn it on in dev, always.
  --trace-uncaught              the same for uncaught exceptions in async code.

  And the three flags that belong on every containerised Node process:
    --max-old-space-size=<75% of the container limit>   Node cannot see your cgroup
    --enable-source-maps                                so stack traces point at your source
    UV_THREADPOOL_SIZE                                  if you do heavy fs/crypto (lab 01 §4)
`);
