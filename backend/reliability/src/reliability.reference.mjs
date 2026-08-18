/** Reference implementation. Read it after you have made the suite pass yourself. */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
export function withTimeout(fn, ms) {
  return async (...args) => {
    const ac = new AbortController();
    let timer;
    try {
      return await Promise.race([
        fn(ac.signal, ...args),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            // Abort FIRST so the underlying work stops, then reject.
            ac.abort();
            reject(Object.assign(new Error(`timed out after ${ms}ms`), { code: 'ETIMEDOUT' }));
          }, ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);          // or a settled fast call keeps the process alive for `ms`
    }
  };
}

// ---------------------------------------------------------------------------
export async function retry(fn, { attempts = 3, baseMs = 20, isRetryable = () => true, onRetry } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !isRetryable(err)) break;
      // Full jitter: random in [0, cap]. Not "cap ± 10%" — you want the whole window, or a fleet
      // of clients still retries in a narrow band around the same instant.
      const cap = Math.min(baseMs * 2 ** (attempt - 1), 2000);
      const delay = Math.random() * cap;
      onRetry?.({ attempt, delay, error: err });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
export function createBreaker({ threshold = 0.5, cooldownMs = 200, windowSize = 10 } = {}) {
  const window = [];                 // true = failure, over the last `windowSize` calls
  let state = 'closed';
  let openedAt = 0;

  const record = (failed) => {
    window.push(failed);
    if (window.length > windowSize) window.shift();
    // Only judge on a full window: a rate over 3 calls is not a rate.
    if (window.length >= windowSize) {
      const rate = window.filter(Boolean).length / window.length;
      if (rate > threshold) { state = 'open'; openedAt = Date.now(); }
    }
  };

  return {
    get state() {
      if (state === 'open' && Date.now() - openedAt >= cooldownMs) return 'half-open';
      return state;
    },
    async call(fn) {
      if (this.state === 'open') {
        throw Object.assign(new Error('circuit open'), { code: 'CIRCUIT_OPEN' });
      }
      const probing = this.state === 'half-open';
      try {
        const result = await fn();
        if (probing) { state = 'closed'; window.length = 0; }   // recovered
        else record(false);
        return result;
      } catch (err) {
        if (probing) { state = 'open'; openedAt = Date.now(); } // still broken; restart cooldown
        else record(true);
        throw err;
      }
    },
  };
}

// ---------------------------------------------------------------------------
const SECRET_KEYS = /^(password|token|secret|authorization|api[_-]?key|cookie|ssn|card(_?number)?)$/i;

const redact = (value, depth = 0) => {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1)]));
};

export function createLogger({ service, sink = console.log, bindings = {} } = {}) {
  const emit = (level) => (msg, fields) => sink(JSON.stringify({
    level, msg, time: new Date().toISOString(), service, ...bindings, ...redact(fields ?? {}),
  }));
  return {
    service,
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child(extra) { return createLogger({ service, sink, bindings: { ...bindings, ...redact(extra) } }); },
  };
}

// ---------------------------------------------------------------------------
export function createMetrics() {
  const routes = new Map();
  const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

  return {
    observe(route, ms, ok = true) {
      if (!routes.has(route)) routes.set(route, { durations: [], count: 0, errors: 0 });
      const r = routes.get(route);
      r.count++;
      if (!ok) r.errors++;
      r.durations.push(ms);
    },
    snapshot() {
      return Object.fromEntries([...routes].map(([route, r]) => {
        const sorted = [...r.durations].sort((a, b) => a - b);
        return [route, {
          count: r.count,
          errors: r.errors,
          errorRate: r.count ? r.errors / r.count : 0,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
        }];
      }));
    },
  };
}

// ---------------------------------------------------------------------------
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function parseTraceparent(header) {
  if (typeof header !== 'string') return null;
  const m = TRACEPARENT.exec(header.trim());
  if (!m) return null;
  const [, traceId, spanId, flags] = m;
  if (traceId === '0'.repeat(32) || spanId === '0'.repeat(16)) return null;   // spec: invalid
  return { traceId, spanId, sampled: (parseInt(flags, 16) & 0x01) === 1 };
}

export function newTraceparent(parent) {
  const traceId = parent?.traceId ?? crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');    // a NEW span for this hop
  const flags = parent ? (parent.sampled ? '01' : '00') : '01';
  return `00-${traceId}-${spanId}-${flags}`;
}
