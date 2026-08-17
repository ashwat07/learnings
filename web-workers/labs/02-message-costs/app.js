// Lab 02 — Message passing costs (page side).

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

$('#isolated').textContent = self.crossOriginIsolated
  ? 'cross-origin isolated — SharedArrayBuffer is available'
  : 'NOT cross-origin isolated — SharedArrayBuffer is unavailable';

const worker = new Worker(new URL('./worker.js', import.meta.url));

let seq = 0;
function send(message, transfer = []) {
  return new Promise((resolve) => {
    const id = ++seq;
    const onMessage = (e) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      resolve({ ...e.data, receivedAt: performance.now() });
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ ...message, id, sentAt: performance.now() }, transfer);
  });
}

const n = () => Number($('n').value);

function record(label, bytes, timings) {
  rows.push({
    payload: label,
    'MB': +(bytes / 1048576).toFixed(2),
    'build ms': Math.round(timings.build),
    'postMessage() blocked ms': +timings.post.toFixed(1),
    'one-way ms': +timings.oneWay.toFixed(1),
    'round trip ms': +timings.round.toFixed(1),
    'MB/s': Math.round((bytes / 1048576) / (timings.oneWay / 1000)),
    _oneWayClass: timings.oneWay > 50 ? 'no' : timings.oneWay > 10 ? 'meh' : 'ok',
  });
  renderTable('#results', rows, {
    columns: ['payload', 'MB', 'build ms', 'postMessage() blocked ms', 'one-way ms', 'round trip ms', 'MB/s'],
  });
  log.line(`${label.padEnd(28)} ${fmt.bytes(bytes).padStart(10)}  post ${timings.post.toFixed(1)}ms  ` +
    `one-way ${timings.oneWay.toFixed(1)}ms  round ${timings.round.toFixed(1)}ms`,
    timings.oneWay > 50 ? 'bad' : 'good');
}

// ---------------------------------------------------------------------------

on('baseline', async () => {
  log.head('— empty message round trip (the floor) —');
  const t0 = performance.now();
  const r = await send({ kind: 'empty' });
  record('(empty message)', 0, { build: 0, post: 0, oneWay: r.oneWay, round: performance.now() - t0 });
  out.textContent =
    'That is the floor: the cost of one round trip with no payload — thread scheduling plus two\n' +
    'event-loop hops, typically 0.1–1ms.\n\n' +
    'It is also the reason not to put small, frequent work in a worker: at 0.5ms per round trip,\n' +
    'a worker call per item over 10,000 items costs 5 seconds in scheduling alone.';
});

on('objects', async () => {
  log.head('— structured clone: array of plain objects —');
  const t0 = performance.now();
  const data = Array.from({ length: n() }, (_, i) => ({
    id: i, team: `t${i % 37}`, score: i % 1000, active: i % 3 !== 0,
  }));
  const build = performance.now() - t0;
  const bytes = n() * 64;                       // rough, for a MB/s figure

  const tPost = performance.now();
  const p = send({ kind: 'objects', payload: data });
  const post = performance.now() - tPost;       // how long postMessage BLOCKED this thread
  const r = await p;
  record('array of objects', bytes, { build, post, oneWay: r.oneWay, round: performance.now() - tPost });

  out.textContent =
    'Two costs, and only one of them is obvious:\n\n' +
    '  "postMessage() blocked" — the SERIALISATION, which happens synchronously on the main\n' +
    '  thread. This is the number that causes jank, and it is invisible in most benchmarks\n' +
    '  because people only measure the round trip.\n\n' +
    '  "one-way" — includes deserialisation on the worker side.\n\n' +
    'Objects are the worst case: every key, every string, every boolean is walked and rebuilt.\n' +
    'Structured clone of a large object graph can run at well under 100MB/s.';
});

on('typed', async () => {
  log.head('— structured clone: Float64Array (no transfer) —');
  const t0 = performance.now();
  const arr = new Float64Array(n());
  for (let i = 0; i < arr.length; i++) arr[i] = i * 0.5;
  const build = performance.now() - t0;

  const tPost = performance.now();
  const p = send({ kind: 'typed', payload: arr.buffer.slice(0) });   // slice = copy, so we keep ours
  const post = performance.now() - tPost;
  const r = await p;
  record('Float64Array (cloned)', arr.byteLength, { build, post, oneWay: r.oneWay, round: performance.now() - tPost });

  out.textContent =
    'Much better than objects: a typed array is a flat block of bytes, so the clone is essentially\n' +
    'a memcpy — often several GB/s. If your data can be a typed array, make it one; the difference\n' +
    'against an array of objects is usually 10–50×.\n\n' +
    'It is still a copy, though: peak memory is 2× the payload while both threads hold it.';
});

on('transfer', async () => {
  log.head('— transfer: ArrayBuffer ownership moves, nothing is copied —');
  const t0 = performance.now();
  const arr = new Float64Array(n());
  for (let i = 0; i < arr.length; i++) arr[i] = i * 0.5;
  const build = performance.now() - t0;
  const bytes = arr.byteLength;
  const buf = arr.buffer;

  const tPost = performance.now();
  const p = send({ kind: 'transfer', payload: buf, echo: true }, [buf]);
  const post = performance.now() - tPost;
  const r = await p;
  record('ArrayBuffer (transferred)', bytes, { build, post, oneWay: r.oneWay, round: performance.now() - tPost });

  log.muted(`after transferring, the sender's buffer is detached: byteLength = ${buf.byteLength}`);
  out.textContent =
    'Near-zero, and constant regardless of size — ownership moved, no bytes were copied.\n\n' +
    'The cost is that YOUR reference is now dead: the buffer is detached (byteLength 0) and any\n' +
    'typed-array view over it throws. That is why the worker echoed it back here — transfer is a\n' +
    'hand-off, so if you need it again, it has to come back.\n\n' +
    'Transferable types: ArrayBuffer, MessagePort, ImageBitmap, OffscreenCanvas, ReadableStream,\n' +
    'WritableStream, TransformStream. If your payload can be shaped into one of those, transfer\n' +
    'turns message cost from O(n) into O(1).';
});

on('shared', async () => {
  if (!self.crossOriginIsolated) {
    log.bad('SharedArrayBuffer needs cross-origin isolation — reload with ?isolate=1');
    out.textContent =
      'SharedArrayBuffer requires the document to be cross-origin isolated:\n' +
      '  Cross-Origin-Opener-Policy: same-origin\n' +
      '  Cross-Origin-Embedder-Policy: require-corp\n' +
      'and then every cross-origin subresource needs CORP or CORS headers too.\n\n' +
      'That requirement exists because of Spectre: shared memory plus a high-resolution timer is\n' +
      'enough to build a side-channel that reads other origins\' data out of the same process.\n' +
      'Isolation guarantees no cross-origin documents share your process.\n\n' +
      'Click the "Reload with cross-origin isolation" link at the top.';
    return;
  }
  log.head('— SharedArrayBuffer: no copy, no transfer, both threads see the same memory —');
  const t0 = performance.now();
  const sab = new SharedArrayBuffer(n() * 8);
  const view = new Float64Array(sab);
  for (let i = 0; i < view.length; i++) view[i] = i * 0.5;
  const build = performance.now() - t0;

  const tPost = performance.now();
  const p = send({ kind: 'shared', payload: sab });
  const post = performance.now() - tPost;
  const r = await p;
  record('SharedArrayBuffer', sab.byteLength, { build, post, oneWay: r.oneWay, round: performance.now() - tPost });

  log.muted(`sender still has full access: view[10] = ${view[10]}`);
  out.textContent =
    'Zero copy AND you keep access — both threads read and write the same memory.\n\n' +
    'Which means you now have real concurrency, with real data races. Use Atomics for anything\n' +
    'that is not "one writer, then a message, then one reader": Atomics.store/load for ordering,\n' +
    'Atomics.wait/notify for blocking (worker side only — wait() is forbidden on the main thread).\n\n' +
    'This is the right tool for wasm heaps, audio buffers, and tight producer/consumer loops. It\n' +
    'is the wrong tool for "I want to avoid a copy of my app state", because the debugging cost of\n' +
    'a race is enormous compared to the 3ms you saved.';
});

on('json', async () => {
  log.head('— JSON.stringify + JSON.parse, for comparison —');
  const data = Array.from({ length: n() }, (_, i) => ({
    id: i, team: `t${i % 37}`, score: i % 1000, active: i % 3 !== 0,
  }));
  const t0 = performance.now();
  const str = JSON.stringify(data);
  const tStr = performance.now() - t0;
  const t1 = performance.now();
  JSON.parse(str);
  const tParse = performance.now() - t1;
  log.line(`stringify ${fmt.ms(tStr)}, parse ${fmt.ms(tParse)}, string size ${fmt.bytes(str.length)}`, 'macro');
  out.textContent =
    'People sometimes "optimise" postMessage by sending a JSON string instead of an object,\n' +
    'reasoning that a string clones faster. Compare the numbers: structured clone of the object is\n' +
    'usually FASTER than stringify+parse, and you also pay for the intermediate string.\n\n' +
    'The exception is when you already have the data as a string (it came off the network that\n' +
    'way) — then send the string and parse it in the worker. Never parse on the main thread just\n' +
    'to clone the result over.';
});

on('detached', () => {
  log.head('— life after transfer —');
  const buf = new ArrayBuffer(1024);
  const view = new Uint8Array(buf);
  view[0] = 42;
  worker.postMessage({ kind: 'oneway', payload: buf, id: -1, sentAt: performance.now() }, [buf]);
  log.line(`buf.byteLength after transfer: ${buf.byteLength}  (was 1024)`, 'bad');
  try {
    view[0] = 1;
    log.line(`view[0] = ${view[0]}`, 'macro');
  } catch (err) {
    log.bad(`writing to the view threw: ${err.message}`);
  }
  log.muted('Detached buffers do not throw on write in every engine — they silently do nothing, ' +
    'or read as 0. That silence is why a "transfer then keep using it" bug can survive code review.');
});

on('unclonable', () => {
  log.head('— things structured clone refuses —');
  const cases = [
    ['a function', () => {}],
    ['a DOM node', document.body],
    ['an object with a method', { fn() {} }],
    ['a class instance', new (class Foo { constructor() { this.x = 1; } })()],
    ['a Proxy', new Proxy({}, {})],
    ['an Error', new Error('this one works')],
    ['a Map of Sets', new Map([['a', new Set([1, 2])]])],
  ];
  for (const [label, value] of cases) {
    try {
      structuredClone(value);
      log.ok(`${label.padEnd(26)} clones fine`);
    } catch (err) {
      log.bad(`${label.padEnd(26)} ${err.name}: ${err.message.slice(0, 70)}`);
    }
  }
  log.muted('Note the class instance: it clones, but comes out as a PLAIN OBJECT — the prototype ' +
    'is gone, so its methods are gone. That is the subtle one: no error, just an object that no ' +
    'longer behaves like the thing you sent.');
  out.textContent =
    'structuredClone() is available on the main thread too, and it is the exact algorithm\n' +
    'postMessage uses. Test your payloads with it directly — much easier than debugging a\n' +
    'DataCloneError from inside a worker.';
});

on('reset', () => { rows.length = 0; renderTable('#results', rows); log.clear(); });
