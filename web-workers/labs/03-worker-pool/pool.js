/**
 * pool.js — a fixed-size worker pool.
 *
 * The basics are implemented so the harness runs. The interesting parts are TODOs: read the
 * comments, then make the tests on the page pass.
 */

export class WorkerPool {
  /**
   * @param {URL|string} scriptUrl
   * @param {{size?: number, onEvent?: (e: object) => void}} options
   */
  constructor(scriptUrl, { size = navigator.hardwareConcurrency || 4, onEvent = () => {} } = {}) {
    this.scriptUrl = scriptUrl;
    this.size = size;
    this.onEvent = onEvent;

    /** @type {{worker: Worker, busy: boolean, jobId: string|null}[]} */
    this.workers = [];
    /** @type {{id: string, work: object, resolve: Function, reject: Function, priority: number}[]} */
    this.queue = [];
    this.jobs = new Map();          // id -> { resolve, reject, workerIndex }
    this.stats = { queued: 0, started: 0, done: 0, cancelled: 0, failed: 0, spawned: 0 };

    for (let i = 0; i < size; i++) this.#spawn(i);
  }

  #spawn(index) {
    const worker = new Worker(this.scriptUrl, { type: 'module' });
    const slot = { worker, busy: false, jobId: null };
    this.workers[index] = slot;
    this.stats.spawned++;

    worker.addEventListener('message', (e) => {
      const { id, type } = e.data;
      const job = this.jobs.get(id);
      slot.busy = false;
      slot.jobId = null;
      if (!job) return;
      this.jobs.delete(id);

      if (type === 'done') { this.stats.done++; job.resolve(e.data); }
      else if (type === 'cancelled') { this.stats.cancelled++; job.reject(new DOMException('cancelled', 'AbortError')); }
      this.onEvent({ type, id, index });
      this.#drain();
    });

    // TODO 4 — worker recycling.
    // A worker that throws an uncaught error is not automatically replaced, and every job
    // routed to it afterwards will hang forever. Handle 'error' and 'messageerror':
    //   - reject the in-flight job with a useful message
    //   - terminate and respawn this slot
    //   - do NOT lose the queued jobs
    worker.addEventListener('error', (err) => {
      this.onEvent({ type: 'error', index, message: err.message });
      throw new Error('TODO 4: implement worker recycling in pool.js');
    });

    return slot;
  }

  /**
   * Run a job. Returns a promise for the worker's result.
   *
   * TODO 1 — cancellation.
   *   Accept an AbortSignal: `run(work, { signal })`.
   *   - if the job is still QUEUED, remove it and reject immediately (no worker involved)
   *   - if the job is RUNNING, post a cancel message to the worker holding it
   *   - if the worker does not respond within `hardKillMs`, terminate() and respawn the slot,
   *     because a worker stuck in a synchronous loop will never see your message
   *   Make sure a cancelled job frees its slot exactly once.
   *
   * TODO 2 — priorities.
   *   Accept `{ priority: 'high' | 'normal' | 'low' }` and dequeue in priority order,
   *   FIFO within a priority. Then answer in a comment: what stops low-priority jobs from
   *   starving forever, and do you need to do anything about it?
   *
   * TODO 3 — backpressure.
   *   Accept a `maxQueue` option. When the queue is full, `run()` should either reject or
   *   (better) return a promise that resolves when there is room. Decide which, and say why in
   *   a comment. An unbounded queue is a memory leak with extra steps.
   */
  run(work, { signal, priority = 'normal' } = {}) {
    if (signal) throw new Error('TODO 1: implement cancellation in pool.js');

    return new Promise((resolve, reject) => {
      const id = `job-${Math.random().toString(36).slice(2, 9)}`;
      this.queue.push({ id, work, resolve, reject, priority: 1 });
      this.jobs.set(id, { resolve, reject });
      this.stats.queued++;
      this.#drain();
    });
  }

  #drain() {
    for (const [index, slot] of this.workers.entries()) {
      if (slot.busy || !this.queue.length) continue;
      const job = this.queue.shift();
      slot.busy = true;
      slot.jobId = job.id;
      this.stats.started++;
      this.onEvent({ type: 'start', id: job.id, index });
      slot.worker.postMessage({ id: job.id, type: 'run', work: job.work });
    }
  }

  /** Number of jobs currently running. */
  get running() { return this.workers.filter((w) => w.busy).length; }

  terminate() {
    for (const slot of this.workers) slot.worker.terminate();
    this.workers = [];
    for (const job of this.jobs.values()) job.reject(new Error('pool terminated'));
    this.jobs.clear();
    this.queue.length = 0;
  }
}
