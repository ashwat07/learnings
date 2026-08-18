/**
 * Lab 01 — What Node actually is, and where your callback runs.
 *
 *   node node-runtime/labs/01-runtime-and-loop/lab.mjs
 *
 * Six demonstrations. Every one of them prints a number, because "the event loop has phases" is
 * a sentence you can repeat without being able to predict anything.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rule, note, table, good, bad, loopLag } from '../../../lib/console.mjs';

const here = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rule('WHAT NODE IS');
console.log(`
  Node is three things bolted together, and almost every confusing behaviour comes from the seam
  between them:

    V8        runs your JavaScript. Single-threaded, with its own microtask queue. Knows nothing
              about files, sockets, or timers — none of those are in the language.
    libuv     a C library that owns the EVENT LOOP and does the actual I/O. Epoll/kqueue/IOCP for
              sockets, and a THREAD POOL (4 threads by default) for things the OS has no async
              interface for: file reads, DNS lookups via getaddrinfo, zlib, crypto's slow paths.
    bindings  the C++ that lets JS ask libuv for things and lets libuv call your JS back.

  So "Node is single-threaded" is half true and the half that is false is the interesting half.
  Your JAVASCRIPT is single-threaded. Your I/O is not — demonstration 4 measures the difference.

  Threads in this process right now: your main thread, ${os.availableParallelism()} of parallelism
  available, and a libuv pool of ${process.env.UV_THREADPOOL_SIZE ?? 4}.`);

// ---------------------------------------------------------------------------
rule('1. the phases, in the order they run');
console.log(`
     ┌───────────────────────────┐
  ┌─▶│         timers            │  setTimeout, setInterval callbacks whose time has come
  │  ├───────────────────────────┤
  │  │     pending callbacks     │  deferred system callbacks (some TCP errors)
  │  ├───────────────────────────┤
  │  │      idle, prepare        │  internal
  │  ├───────────────────────────┤     ┌────────────────┐
  │  │           POLL            │◀────│  incoming I/O  │  where the loop WAITS. Sockets, file
  │  ├───────────────────────────┤     └────────────────┘  reads completing, everything.
  │  │          CHECK            │  setImmediate callbacks
  │  ├───────────────────────────┤
  └──│     close callbacks       │  socket.on('close'), etc
     └───────────────────────────┘

  Between EVERY callback — not every phase — Node drains two more queues:
      process.nextTick queue   (Node's own, drained first, completely)
      microtask queue          (promises, queueMicrotask — drained to empty, including
                                anything added while draining)

  That single fact explains ordering questions people find mysterious. Drill 01 makes you predict
  eight of them.`);

// ---------------------------------------------------------------------------
rule('2. setTimeout(0) vs setImmediate — the coin toss, and the case where it is not');

{
  // The famous nondeterminism only exists on the FIRST loop iteration of a fresh process, so it
  // has to be measured in fresh processes. Inside this already-running loop it would not show up
  // at all — which is itself the lesson.
  const script = "setTimeout(()=>console.log('timeout'),0);setImmediate(()=>console.log('immediate'))";
  const tally = { timeout: 0, immediate: 0 };
  for (let i = 0; i < 30; i++) {
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    tally[r.stdout.trim().split('\n')[0]]++;
  }
  console.log('\n  30 FRESH processes, both scheduled at the top level:');
  table([{ 'ran first': 'setTimeout(fn, 0)', runs: tally.timeout }, { 'ran first': 'setImmediate(fn)', runs: tally.immediate }], ['ran first', 'runs']);
  note('setTimeout(fn, 0) is clamped to 1ms. Whether that millisecond has already elapsed when the');
  note('first timers phase runs depends on how long the process took to boot — so the answer');
  note('changes with machine load, with Node version, and with what else is in your entry file.');

  const inIo = await new Promise((resolve) => {
    fs.readFile(here, () => {
      const seen = [];
      setTimeout(() => { seen.push('timeout'); if (seen.length === 2) resolve(seen); }, 0);
      setImmediate(() => { seen.push('immediate'); if (seen.length === 2) resolve(seen); });
    });
  });
  console.log(`\n  Inside an I/O callback: ${inIo.join(' then ')} — every time, on every machine.`);
  note('An I/O callback runs in the POLL phase, and CHECK is the very next phase, while the timers');
  note('phase is a whole iteration away. Deterministic, and the only version worth relying on.');
}

// ---------------------------------------------------------------------------
rule('3. nextTick can starve the loop. Promises can too. Timers cannot.');

{
  const starve = (kind, depth) => new Promise((resolve) => {
    let ioRan = false;
    fs.readFile(here, () => { ioRan = true; });          // queued I/O, waiting for the poll phase
    let n = 0;
    const step = () => {
      if (++n >= depth) return resolve({ ioRan, n });
      if (kind === 'nextTick') process.nextTick(step);
      else if (kind === 'promise') Promise.resolve().then(step);
      else setImmediate(step);
    };
    step();
  });

  const rows = [];
  for (const kind of ['nextTick', 'promise', 'setImmediate']) {
    const r = await starve(kind, 100_000);
    rows.push({
      'recursed via': kind,
      'did the pending file read get a turn?': r.ioRan ? 'yes' : 'NO — the loop never reached poll',
    });
  }
  table(rows, ['recursed via', 'did the pending file read get a turn?']);
  console.log(`
  nextTick and promise recursion both starve the loop, for the same reason: those queues are
  drained to EMPTY between callbacks, so a queue that refills itself never empties. setImmediate
  recursion does not, because each setImmediate goes into the NEXT iteration's check phase — the
  loop gets all the way round, poll included, between every step.

  This is why "chunk the work with setImmediate" (drill 02) works and "chunk it with
  await Promise.resolve()" does nothing at all.`);
}

// ---------------------------------------------------------------------------
rule('4. the libuv thread pool — the part that is genuinely not single-threaded');

{
  const pbkdf2 = () => new Promise((r) => crypto.pbkdf2('secret', 'salt', 300_000, 32, 'sha512', r));
  const time = async (fn) => { const t0 = performance.now(); await fn(); return performance.now() - t0; };

  const four = await time(() => Promise.all([pbkdf2(), pbkdf2(), pbkdf2(), pbkdf2()]));
  const seq = await time(async () => { for (let i = 0; i < 4; i++) await pbkdf2(); });
  table([
    { 'four pbkdf2 calls': 'one after another (await each)', ms: seq.toFixed(0) },
    { 'four pbkdf2 calls': 'all at once (Promise.all)', ms: four.toFixed(0) },
  ], ['four pbkdf2 calls', 'ms']);
  console.log(`  ${(seq / four).toFixed(1)}x faster in parallel — on a thread pool, from single-threaded JavaScript.\n`);

  // Now prove the pool has a SIZE, by changing it. It can only be set before the first use, so
  // this has to happen in a child process.
  const bench = "const c=require('crypto');const p=()=>new Promise(r=>c.pbkdf2('s','salt',300000,32,'sha512',r));" +
    "const t=Date.now();Promise.all(Array.from({length:8},p)).then(()=>console.log(Date.now()-t))";
  const rows = [];
  for (const size of ['4', '8']) {
    const r = spawnSync(process.execPath, ['-e', bench], { encoding: 'utf8', env: { ...process.env, UV_THREADPOOL_SIZE: size } });
    rows.push({ UV_THREADPOOL_SIZE: size, 'eight pbkdf2 calls': `${r.stdout.trim()}ms` });
  }
  table(rows, ['UV_THREADPOOL_SIZE', 'eight pbkdf2 calls']);

  console.log(`
  Eight calls on a pool of four take about twice as long as eight on a pool of eight: four run,
  four queue. The pool is real, it is shared, and it has a size you can change (default 4, max
  1024) — but only from the environment, or before the first call that uses it.

  What uses that pool:  fs.*  (all of it),  dns.lookup  (but NOT dns.resolve),  zlib,
                        crypto.pbkdf2/scrypt/randomBytes and friends
  What does NOT:        TCP/UDP sockets, HTTP — those are epoll/kqueue, genuinely event-driven,
                        and scale to tens of thousands of connections without a thread each.

  Two consequences worth carrying around:
    · a burst of fs or crypto work queues behind itself and adds latency to unrelated requests
      that also touch the disk. The queue is invisible: it is not in your metrics, not in your
      flame graph, and not in the event loop lag either.
    · dns.lookup is thread-pool bound, so a service resolving many hostnames can exhaust the pool
      and stall its own file I/O. This is a real production failure mode, and the fix is a DNS
      cache or dns.resolve, which goes over the network instead.

  And the distinction that matters most: this pool is for I/O and native work. It cannot run your
  JavaScript. For that you need worker_threads — drill 09.`);
}

// ---------------------------------------------------------------------------
rule('5. blocking vs non-blocking, in milliseconds of lag');

{
  const bigFile = '/tmp/node-runtime-lab-01.bin';
  fs.writeFileSync(bigFile, Buffer.alloc(24 * 1024 * 1024, 1));

  const run = async (label, work) => {
    const lag = loopLag(4);
    const t0 = performance.now();
    await work();
    await sleep(40);
    const l = lag.stop();
    return { approach: label, 'wall ms': (performance.now() - t0).toFixed(0), 'worst loop lag': `${l.max.toFixed(1)}ms` };
  };

  const rows = [
    await run('fs.readFileSync x4', async () => { for (let i = 0; i < 4; i++) fs.readFileSync(bigFile); }),
    await run('fs.promises.readFile x4', async () => { await Promise.all(Array.from({ length: 4 }, () => fs.promises.readFile(bigFile))); }),
    await run('JSON.parse of 24MB', async () => { JSON.parse(JSON.stringify({ a: 'x'.repeat(12 * 1024 * 1024) })); }),
  ];
  table(rows, ['approach', 'wall ms', 'worst loop lag']);
  fs.unlinkSync(bigFile);

  console.log(`
  The sync version does the same work and stops the world while it does it. Every connected
  client waits. Note that the async version is not just kinder — it is FASTER here, because four
  reads run on four pool threads instead of one after another.

  And the third row is the one people miss: JSON.parse, JSON.stringify, a regex with catastrophic
  backtracking, a big Array.sort, template rendering, and crypto's SYNCHRONOUS variants are all
  blocking, and none of them look like I/O. If it is a long loop in JavaScript, it is a blocked
  server, whether or not you wrote the loop yourself.`);
}

// ---------------------------------------------------------------------------
rule('6. timers do not fire on time, and never claimed to');

{
  const drift = async (requested, n) => {
    const errs = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, requested));
      errs.push(performance.now() - t0 - requested);
    }
    errs.sort((a, b) => a - b);
    return { 'setTimeout(ms)': requested, 'median late by': `${errs[Math.floor(n / 2)].toFixed(2)}ms`, 'worst': `${errs.at(-1).toFixed(2)}ms` };
  };

  table([await drift(0, 30), await drift(1, 30), await drift(5, 30), await drift(50, 10)],
    ['setTimeout(ms)', 'median late by', 'worst']);

  console.log(`
  setTimeout is a MINIMUM, not a schedule. The callback runs in the next timers phase at or after
  the deadline, and if the loop is busy — or another callback is running — it waits. Note that
  setTimeout(fn, 0) is silently rewritten to 1ms, which is why a "zero" timer is not free and why
  a chain of them runs at ~1000/second at best.

  For an interval, this drift ACCUMULATES with setInterval if the callback takes time: the next
  fire is scheduled from when the last one finished. If you need a rate, compute the next deadline
  from a fixed start time and setTimeout to it. If you need precision below a few milliseconds,
  Node is the wrong tool — use the deadline to decide what to do, not to decide when.`);
}

rule('where to go next');
console.log(`
  drills/01  predict an ordering, exactly. If you cannot, re-read section 1.
  drills/02  keep the loop responsive under 400ms of CPU
  drills/09  actually parallelise it — the other answer to the same problem
  labs/02    modules: why require() and import behave differently even in the same file tree
`);
