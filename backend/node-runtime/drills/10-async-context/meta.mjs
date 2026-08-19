export const title = 'Request context without threading it through';
export const task = `Every log line needs the request id. Every database query needs the tenant.
Every outbound call needs the trace parent. None of them are arguments to the function that needs
them, and adding them means changing forty signatures.

The obvious fix is a module-level variable. It works perfectly with one request at a time and
corrupts everything under concurrency — request A's id ends up on request B's logs, and you find
out from a customer.

Implement createContext(): { run(store, fn), get(key), set(key, value) } on top of
AsyncLocalStorage, and a logger that picks the request id up by itself.`;
export const passIf = 'the context survives every kind of async boundary AND 200 interleaved requests never see each other\'s data';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function check(s) {
  if (typeof s.createContext !== 'function') {
    return [{ check: 'exports createContext()', actual: 'missing', pass: false }];
  }
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 60), pass: false }); }
  };

  await guard('a value set at the top is visible five calls deep', async () => {
    const ctx = s.createContext();
    const deep5 = () => ctx.get('requestId');
    const deep4 = async () => { await sleep(1); return deep5(); };
    const deep3 = async () => deep4();
    const deep2 = async () => { await Promise.resolve(); return deep3(); };
    const deep1 = async () => deep2();
    const got = await ctx.run({ requestId: 'r-1' }, deep1);
    return got === 'r-1' || `got ${got}`;
  });

  await guard('it survives setTimeout, a promise chain, and an EventEmitter callback', async () => {
    const ctx = s.createContext();
    const { EventEmitter } = await import('node:events');
    const seen = {};
    await ctx.run({ requestId: 'r-2' }, async () => {
      await new Promise((r) => setTimeout(() => { seen.timer = ctx.get('requestId'); r(); }, 5));
      await Promise.resolve().then(() => { seen.microtask = ctx.get('requestId'); });
      const e = new EventEmitter();
      e.on('go', () => { seen.emitter = ctx.get('requestId'); });
      e.emit('go');
      await new Promise((r) => setImmediate(() => { seen.immediate = ctx.get('requestId'); r(); }));
    });
    const wrong = Object.entries(seen).filter(([, v]) => v !== 'r-2');
    return wrong.length === 0 ? true : `lost it in: ${wrong.map(([k]) => k).join(', ')}`;
  });

  await guard('outside any run(), get() is undefined rather than someone else\'s value', async () => {
    const ctx = s.createContext();
    await ctx.run({ requestId: 'r-3' }, async () => sleep(1));
    return ctx.get('requestId') === undefined || `leaked ${ctx.get('requestId')} after run() finished`;
  });

  // THE test. Two hundred overlapping requests, each yielding at random points.
  await guard('200 interleaved requests never see each other\'s id', async () => {
    const ctx = s.createContext();
    const wrong = [];
    const handle = async (id) => {
      await sleep(Math.floor(Math.random() * 15));
      if (ctx.get('requestId') !== id) wrong.push(`${id} saw ${ctx.get('requestId')}`);
      await Promise.resolve();
      await sleep(Math.floor(Math.random() * 15));
      if (ctx.get('requestId') !== id) wrong.push(`${id} saw ${ctx.get('requestId')} (late)`);
      return ctx.get('requestId');
    };
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) => ctx.run({ requestId: `req-${i}` }, () => handle(`req-${i}`))));
    const mismatched = results.filter((v, i) => v !== `req-${i}`).length;
    if (wrong.length || mismatched) return `${wrong.length + mismatched} crossed over, e.g. ${wrong[0] ?? 'wrong return value'}`;
    return true;
  });

  await guard('set() inside a run is visible to the rest of that run', async () => {
    const ctx = s.createContext();
    return await ctx.run({}, async () => {
      ctx.set('userId', 42);
      await sleep(1);
      return ctx.get('userId') === 42 || `got ${ctx.get('userId')}`;
    });
  });

  await guard('set() does NOT escape into a sibling request', async () => {
    const ctx = s.createContext();
    let leaked = 'clean';
    await Promise.all([
      ctx.run({ requestId: 'a' }, async () => { ctx.set('secret', 'a-only'); await sleep(10); }),
      ctx.run({ requestId: 'b' }, async () => { await sleep(5); if (ctx.get('secret')) leaked = `b saw ${ctx.get('secret')}`; }),
    ]);
    return leaked === 'clean' || leaked;
  });

  await guard('a nested run() shadows the outer one and restores it afterwards', async () => {
    const ctx = s.createContext();
    return await ctx.run({ requestId: 'outer' }, async () => {
      const inner = await ctx.run({ requestId: 'inner' }, async () => { await sleep(1); return ctx.get('requestId'); });
      await sleep(1);
      const after = ctx.get('requestId');
      return (inner === 'inner' && after === 'outer') || `inner=${inner} after=${after}`;
    });
  });

  await guard('the logger stamps every line with the request id, unasked', async () => {
    if (typeof s.createLogger !== 'function') return 'exports createLogger(ctx, sink)';
    const ctx = s.createContext();
    const lines = [];
    const log = s.createLogger(ctx, (line) => lines.push(line));
    await Promise.all([
      ctx.run({ requestId: 'r-a' }, async () => { await sleep(3); log.info('saving', { rows: 2 }); }),
      ctx.run({ requestId: 'r-b' }, async () => { await sleep(1); log.info('saving', { rows: 9 }); }),
    ]);
    log.info('outside a request');
    const byId = Object.fromEntries(lines.filter((l) => l.requestId).map((l) => [l.requestId, l]));
    const ok = byId['r-a']?.rows === 2 && byId['r-b']?.rows === 9 &&
      lines.length === 3 && lines.some((l) => l.requestId === undefined);
    return ok || `lines: ${JSON.stringify(lines)}`.slice(0, 90);
  });

  await guard('the store is not retained after 20,000 requests', async () => {
    const ctx = s.createContext();
    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20_000; i++) {
      await ctx.run({ requestId: `r-${i}`, payload: 'x'.repeat(512) }, async () => ctx.get('requestId'));
    }
    if (global.gc) global.gc();
    const grew = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
    return grew < 25 || `heap grew ${grew.toFixed(1)}MB — something is holding every store`;
  });

  return out;
}
