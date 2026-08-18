/** Drill 09 — reference. */

import { Worker } from 'node:worker_threads';

export function createPool(size, workerPath) {
  let nextId = 1;
  let closed = false;
  const idle = [];                 // workers with nothing to do
  const queue = [];                // jobs with nowhere to run
  const pending = new Map();       // id -> { resolve, reject, worker }

  const spawn = () => {
    const worker = new Worker(workerPath);

    worker.on('message', (msg) => {
      const job = pending.get(msg.id);
      pending.delete(msg.id);
      // Hand the worker its next job BEFORE settling the promise. Settling runs the caller's
      // .then in a microtask, which may submit more work; releasing first means that work finds
      // an idle worker instead of queueing behind nothing.
      release(worker);
      if (!job) return;
      if (msg.error) job.reject(new Error(msg.error));
      else job.resolve(msg);
    });

    // A worker CAN still die: an OOM, a native crash, process.exit() in worker code. Every job
    // that was on it must be rejected, or its caller waits forever. This is the difference
    // between a pool and a memory leak with threads attached.
    const die = (err) => {
      for (const [id, job] of pending) {
        if (job.worker === worker) { job.reject(err ?? new Error('worker exited')); pending.delete(id); }
      }
      const i = idle.indexOf(worker);
      if (i >= 0) idle.splice(i, 1);
      if (!closed) spawn();                    // replace it, or the pool shrinks to nothing
    };
    worker.on('error', die);
    worker.on('exit', (code) => { if (code !== 0 && !closed) die(new Error(`worker exited with ${code}`)); });

    // An IDLE worker should not keep the process alive — otherwise a script that finishes its
    // work hangs forever because you forgot to close the pool. A BUSY one must, or the loop
    // empties while a job is in flight and Node exits with your promise still pending and no
    // error printed anywhere. So: unref when idle, ref when working. See release()/dispatch().
    worker.unref();
    release(worker);
    return worker;
  };

  const release = (worker) => {
    const job = queue.shift();
    if (job) { dispatch(worker, job); return; }
    worker.unref();                            // idle: stop holding the event loop open
    idle.push(worker);
  };

  const dispatch = (worker, job) => {
    pending.set(job.id, { ...job, worker });
    worker.ref();                              // busy: the loop must wait for this reply
    worker.postMessage({ id: job.id, ...job.payload });
  };

  for (let i = 0; i < size; i++) spawn();

  return {
    run(payload) {
      if (closed) return Promise.reject(new Error('pool is closed'));
      return new Promise((resolve, reject) => {
        const job = { id: nextId++, payload, resolve, reject };
        const worker = idle.pop();
        if (worker) dispatch(worker, job); else queue.push(job);
      });
    },
    async close() {
      closed = true;
      for (const job of queue) job.reject(new Error('pool is closing'));
      queue.length = 0;
      // terminate() is immediate and does not run any cleanup inside the worker. That is fine
      // for pure computation; if your workers hold sockets or file handles, send them a
      // 'shutdown' message first and terminate only as a fallback (drill 07, applied to threads).
      await Promise.all(idle.map((w) => w.terminate()));
      const others = new Set([...pending.values()].map((j) => j.worker));
      await Promise.all([...others].map((w) => w.terminate()));
      for (const job of pending.values()) job.reject(new Error('pool is closing'));
      pending.clear();
      idle.length = 0;
    },
  };
}

/*
WHEN A WORKER IS THE ANSWER, AND WHEN IT IS NOT

Workers buy you CPU parallelism and nothing else. They do not make I/O faster: libuv already does
your file and DNS work on a thread pool, and sockets are non-blocking. Moving a database call to a
worker adds a structured clone and buys you nothing.

  worth it     hashing, compression, image resize, parsing megabytes of JSON/CSV, crypto,
               template rendering at volume, anything you measured at >50ms of pure CPU
  not worth it anything I/O bound, anything under ~10ms (the postMessage round trip eats it),
               anything that needs to touch shared mutable state

THE COST NOBODY MEASURES: postMessage IS A COPY

Arguments are STRUCTURED-CLONED, and the serialisation happens synchronously on the sending
thread. Sending a 100MB object to a worker blocks your event loop for the copy — you have moved
the CPU work and kept the stall. Two ways out:

  transferList   worker.postMessage(buf, [buf.buffer])  — moves an ArrayBuffer with no copy. The
                 sender's view is neutered afterwards, which is the price and also the safety.
  SharedArrayBuffer + Atomics  — genuinely shared memory, no copy at all, and now you have every
                 data race Go's drill 01 is about. Atomics.wait/notify give you the primitives.
                 Use it for large numeric buffers; do not use it as a general object store.

SIZING THE POOL
os.availableParallelism() (not os.cpus().length — it respects cgroup limits, which is what your
container actually has), minus one for the main thread. More workers than cores makes everything
slower: you add context switching and memory pressure to work that was already CPU-saturated.

AND THE THING PEOPLE FORGET
Each worker is a separate V8 isolate with its own module registry. Your config module, your
database client, your 40MB of dependencies — all loaded again, per worker. A pool of 8 can cost
several hundred megabytes before it does anything. Keep worker entry points small and dependency-
free; that is why worker.mjs in this drill imports nothing.
*/
