/**
 * Three services, in one process, with a clock you can trust and faults you can reproduce.
 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Seeded PRNG, so "20% of calls are slow" means the SAME 20% on every run. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class NonRetryable extends Error {
  constructor(message) { super(message); this.name = 'NonRetryable'; this.retryable = false; }
}
export class Unavailable extends Error {
  constructor(message) { super(message); this.name = 'Unavailable'; this.retryable = true; }
}

/**
 * A service. It records EVERY invocation, including the ones that arrive after the caller has
 * given up — which is the number most of these drills turn on.
 */
export function makeService({ name, latencyMs = 10, failRate = 0, slowRate = 0, slowMs = 900, seed = 1 }) {
  const rand = rng(seed);
  const calls = [];
  let acceptingSince = Date.now();

  const svc = {
    name,
    get calls() { return calls; },
    get callCount() { return calls.length; },
    /** How many invocations STARTED after `t`. */
    callsAfter(t) { return calls.filter((c) => c.startedAt > t).length; },
    /** How many invocations were still running when they were abandoned. */
    get abandoned() { return calls.filter((c) => c.abandoned).length; },
    reset() { calls.length = 0; acceptingSince = Date.now(); },

    /**
     * handle(req, ctx) — ctx carries { deadline, signal } if the caller propagates them. The
     * service HONOURS them: it aborts its own work when the signal fires and refuses outright if
     * the deadline has already passed. A real service does this; the point of the drills is
     * whether the CALLER gives it the information it needs.
     */
    async handle(req = {}, ctx = {}) {
      const record = { startedAt: Date.now(), deadline: ctx.deadline ?? null, abandoned: false, req };
      calls.push(record);

      if (ctx.deadline != null && ctx.deadline <= Date.now()) {
        record.refused = 'deadline already passed';
        throw new NonRetryable(`${name}: refused, deadline already passed`);
      }

      const slow = rand() < slowRate;
      const ms = slow ? slowMs : latencyMs;
      record.plannedMs = ms;

      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        const onAbort = () => { clearTimeout(t); record.abandoned = true; reject(new NonRetryable(`${name}: aborted`)); };
        ctx.signal?.addEventListener('abort', onAbort, { once: true });
        // If the caller gave us a deadline, we stop at it ourselves rather than running on.
        if (ctx.deadline != null) {
          const remaining = ctx.deadline - Date.now();
          setTimeout(() => { clearTimeout(t); record.abandoned = true; reject(new Unavailable(`${name}: deadline exceeded`)); },
            Math.max(0, remaining));
        }
      });

      record.finishedAt = Date.now();
      if (rand() < failRate) throw new Unavailable(`${name}: unavailable`);
      return { from: name, ok: true };
    },
  };
  return svc;
}
