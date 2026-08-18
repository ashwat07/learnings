export const title = 'Write EventEmitter from scratch';
export const task = `Implement the class. Twenty lines gets you on/emit/off working; the checks
below are the other eighty percent, and every one of them is a bug that has shipped in a real
"tiny event emitter" package.

The interesting ones: what happens when a listener removes another listener DURING an emit, what
happens when it adds one, and what an 'error' event with no listener must do.`;
export const passIf = 'all fourteen behaviours match Node\'s EventEmitter';

export async function check(s) {
  const E = s.Emitter;
  if (typeof E !== 'function') return [{ check: 'exports class Emitter', actual: 'missing', pass: false }];

  const out = [];
  const t = (check, fn) => {
    try { const r = fn(); out.push({ check, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check, actual: `threw: ${e.message}`.slice(0, 60), pass: false }); }
  };

  t('on + emit passes every argument', () => {
    const e = new E(); let got;
    e.on('x', (...a) => { got = a; });
    e.emit('x', 1, 'two', { three: 3 });
    return JSON.stringify(got) === '[1,"two",{"three":3}]' || JSON.stringify(got);
  });

  t('emit returns true with listeners, false without', () => {
    const e = new E(); e.on('x', () => {});
    return (e.emit('x') === true && e.emit('nobody') === false) || `${e.emit('x')} / ${e.emit('nobody')}`;
  });

  t('listeners run in registration order', () => {
    const e = new E(); const seen = [];
    e.on('x', () => seen.push(1)); e.on('x', () => seen.push(2)); e.on('x', () => seen.push(3));
    e.emit('x');
    return seen.join('') === '123' || seen.join('');
  });

  t('listeners run SYNCHRONOUSLY', () => {
    const e = new E(); let ran = false;
    e.on('x', () => { ran = true; });
    e.emit('x');
    return ran === true || 'the listener had not run when emit returned';
  });

  t('once fires exactly once', () => {
    const e = new E(); let n = 0;
    e.once('x', () => n++);
    e.emit('x'); e.emit('x'); e.emit('x');
    return n === 1 || `fired ${n} times`;
  });

  t('once receives its arguments', () => {
    const e = new E(); let got;
    e.once('x', (a, b) => { got = [a, b]; });
    e.emit('x', 'a', 'b');
    return JSON.stringify(got) === '["a","b"]' || JSON.stringify(got);
  });

  t('off removes the listener', () => {
    const e = new E(); let n = 0; const fn = () => n++;
    e.on('x', fn); e.off('x', fn); e.emit('x');
    return n === 0 || `still fired ${n} times`;
  });

  t('off removes ONE instance of a listener added twice', () => {
    const e = new E(); let n = 0; const fn = () => n++;
    e.on('x', fn); e.on('x', fn); e.off('x', fn); e.emit('x');
    return n === 1 || `fired ${n} times, expected 1`;
  });

  t('off(once listener) works with the ORIGINAL function', () => {
    const e = new E(); let n = 0; const fn = () => n++;
    e.once('x', fn); e.off('x', fn); e.emit('x');
    return n === 0 || 'the once wrapper hid the original function from off()';
  });

  t('a listener removing a LATER listener stops it firing', () => {
    const e = new E(); const seen = [];
    const b = () => seen.push('b');
    e.on('x', () => { seen.push('a'); e.off('x', b); });
    e.on('x', b);
    e.emit('x');
    return seen.join('') === 'a' || `got "${seen.join('')}"`;
  });

  t('a listener removing ITSELF does not skip the next one', () => {
    const e = new E(); const seen = [];
    const a = () => { seen.push('a'); e.off('x', a); };
    e.on('x', a);
    e.on('x', () => seen.push('b'));
    e.on('x', () => seen.push('c'));
    e.emit('x');
    return seen.join('') === 'abc' || `got "${seen.join('')}" — the classic splice-while-iterating bug`;
  });

  t('a listener added DURING emit does not fire in that emit', () => {
    const e = new E(); const seen = [];
    e.on('x', () => { seen.push('a'); e.on('x', () => seen.push('late')); });
    e.emit('x');
    e.emit('x');
    return seen.join(',') === 'a,a,late' || `got "${seen.join(',')}"`;
  });

  t("emit('error') with no listener THROWS the error", () => {
    const e = new E();
    try { e.emit('error', new Error('boom')); return 'it did not throw'; }
    catch (err) { return err instanceof Error && err.message === 'boom' ? true : `threw ${err}`; }
  });

  t("emit('error') WITH a listener does not throw", () => {
    const e = new E(); let got;
    e.on('error', (err) => { got = err.message; });
    e.emit('error', new Error('boom'));
    return got === 'boom' || `listener got ${got}`;
  });

  t('listenerCount is accurate', () => {
    const e = new E(); const fn = () => {};
    e.on('x', fn); e.once('x', () => {}); e.on('y', () => {});
    const before = e.listenerCount('x');
    e.off('x', fn);
    return (before === 2 && e.listenerCount('x') === 1 && e.listenerCount('nothing') === 0) ||
      `${before} then ${e.listenerCount('x')}, unknown event ${e.listenerCount('nothing')}`;
  });

  t('on/off/once return this, so they chain', () => {
    const e = new E(); const fn = () => {};
    return (e.on('x', fn) === e && e.once('y', fn) === e && e.off('x', fn) === e) || 'one of them did not return this';
  });

  // The leak warning: Node fires this at 11 listeners for one event on one emitter, and it is the
  // single most useful diagnostic Node ships — it is how you find the `on` inside a request handler.
  const warnings = [];
  const onWarn = (w) => warnings.push(w);
  process.on('warning', onWarn);
  const e = new E();
  for (let i = 0; i < 12; i++) e.on('leaky', () => {});
  await new Promise((r) => setImmediate(r));
  process.off('warning', onWarn);
  const leak = warnings.filter((w) => w.name === 'MaxListenersExceededWarning');
  out.push({
    check: 'an 11th listener warns exactly once (MaxListenersExceededWarning)',
    actual: leak.length === 1 ? 'warned once' : `${leak.length} warnings`,
    pass: leak.length === 1,
  });

  return out;
}
