import http from 'node:http';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

export const title = 'Streaming responses and uploads';
export const task = `Two endpoints, and the same mistake on both sides of the wire.

  GET  /download?rows=N   emit N NDJSON rows: {"id":0,"name":"row-0"}
  POST /upload            consume the body, reply {"bytes":n,"sha256":"..."}

Build the response in memory and a 500,000-row export is 30MB of heap per concurrent client.
Buffer the upload and a 100MB file is 100MB of heap that an unauthenticated stranger chose for
you. Both are one line of convenience.

createHandler({ maxUploadBytes }) returns an ordinary (req, res) handler.`;
export const passIf = 'both directions stream, the heap stays flat, an oversized upload is refused EARLY, and a client hanging up stops the work';

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function check(s) {
  if (typeof s.createHandler !== 'function') {
    return [{ check: 'exports createHandler({ maxUploadBytes })', actual: 'missing', pass: false }];
  }
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 60), pass: false }); }
  };

  // `generated` lets the checks see how much work the server did, which is the only way to tell
  // "streamed politely" from "built it all and handed it over".
  const stats = { generated: 0, bytesRead: 0 };
  const server = http.createServer(s.createHandler({ maxUploadBytes: 100 * 1024 * 1024, stats }));
  const port = await listen(server);

  // A second server with a 1MB limit, for the two checks about refusing. Same handler, different
  // configuration — which is also a check that maxUploadBytes is actually read.
  const small = { generated: 0, bytesRead: 0 };
  const strict = http.createServer(s.createHandler({ maxUploadBytes: 1024 * 1024, stats: small }));
  const strictPort = await listen(strict);

  // heapUsed + external, because Buffers live OUTSIDE the V8 heap. A server that accumulates
  // request chunks in an array of Buffers shows almost no heapUsed growth at all — which is a
  // good reason to know that process.memoryUsage() has five numbers and heapUsed is only one.
  const used = () => { const m = process.memoryUsage(); return m.heapUsed + m.external; };
  const peakHeapDuring = async (fn) => {
    if (global.gc) global.gc();
    const before = used();
    let peak = before;
    const t = setInterval(() => { peak = Math.max(peak, used()); }, 5);
    const result = await fn();
    clearInterval(t);
    return { result, grewMB: (peak - before) / 1024 / 1024 };
  };

  await guard('a 200,000-row download arrives complete and in order', async () => {
    const { result } = await peakHeapDuring(async () => {
      const res = await fetch(`http://127.0.0.1:${port}/download?rows=200000`);
      return res.text();
    });
    const lines = result.trimEnd().split('\n');
    if (lines.length !== 200000) return `${lines.length} rows, want 200000`;
    const first = JSON.parse(lines[0]);
    const last = JSON.parse(lines[199999]);
    return (first.id === 0 && last.id === 199999 && last.name === 'row-199999') || `first ${JSON.stringify(first)} last ${JSON.stringify(last)}`;
  });

  // 2,000,000 rows is ~76MB on the wire. The client half of this runs in the same process and
  // costs ~20MB of transient buffers whatever the server does, so the threshold is set well
  // above that: what it catches is a server holding the entire export at once.
  await guard('...without the server buffering it: heap stays under 50MB for a 76MB export', async () => {
    stats.generated = 0;
    const { grewMB, result } = await peakHeapDuring(async () => {
      const res = await fetch(`http://127.0.0.1:${port}/download?rows=2000000`);
      let n = 0;
      for await (const chunk of res.body) n += chunk.length;
      return n;
    });
    if (result < 60 * 1024 * 1024) return `only ${(result / 1048576).toFixed(0)}MB arrived`;
    return grewMB < 50 || `heap grew ${grewMB.toFixed(1)}MB — the whole export was in memory at once`;
  });

  await guard('it is chunked, not Content-Length (the size is not known up front)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/download?rows=10`);
    await res.text();
    const te = res.headers.get('transfer-encoding');
    const cl = res.headers.get('content-length');
    return (te === 'chunked' || cl === null) || `transfer-encoding=${te} content-length=${cl}`;
  });

  await guard('a client that hangs up mid-download stops the server generating', async () => {
    stats.generated = 0;
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/download?rows=2000000`, { signal: ac.signal });
    let read = 0;
    try {
      for await (const chunk of res.body) {
        read += chunk.length;
        if (read > 64 * 1024) { ac.abort(); break; }
      }
    } catch { /* the abort */ }
    const atAbort = stats.generated;
    await sleep(300);
    const after = stats.generated;
    if (after > atAbort + 200_000) return `kept generating ${after - atAbort} more rows for a client that had gone`;
    return after < 1_500_000 || `generated ${after} of 2,000,000 rows for a disconnected client`;
  });

  await guard('a 20MB upload is hashed correctly', async () => {
    const body = crypto.randomBytes(20 * 1024 * 1024);
    const want = crypto.createHash('sha256').update(body).digest('hex');
    const res = await fetch(`http://127.0.0.1:${port}/upload`, {
      method: 'POST', body: Readable.toWeb(Readable.from([body])), duplex: 'half',
      headers: { 'content-type': 'application/octet-stream' },
    });
    const json = await res.json();
    return (json.bytes === body.length && json.sha256 === want) ||
      `bytes=${json.bytes} (want ${body.length}), sha match=${json.sha256 === want}`;
  });

  await guard('...without buffering it: heap+external grows under 45MB for a 60MB upload', async () => {
    const chunk = crypto.randomBytes(1024 * 1024);
    const { grewMB, result } = await peakHeapDuring(async () => {
      const res = await fetch(`http://127.0.0.1:${port}/upload`, {
        method: 'POST',
        body: Readable.toWeb(Readable.from(Array.from({ length: 60 }, () => chunk))),
        duplex: 'half',
      });
      return res.json();
    });
    if (result.bytes !== 60 * 1024 * 1024) return `bytes=${result.bytes}, want ${60 * 1024 * 1024}`;
    return grewMB < 45 || `heap+external grew ${grewMB.toFixed(1)}MB — the body was accumulated`;
  });

  // Refusing an upload has two acceptable outcomes, and both are correct behaviour: a clean 413,
  // or a reset socket if you stopped reading while the client was still sending. What is NOT
  // acceptable is reading all 200MB first.
  await guard('an 8MB upload against a 1MB limit is refused', async () => {
    const res = await fetch(`http://127.0.0.1:${strictPort}/upload`, {
      method: 'POST',
      body: Readable.toWeb(Readable.from(Array.from({ length: 8 }, () => crypto.randomBytes(1024 * 1024)))),
      duplex: 'half',
    }).then((r) => ({ status: r.status }), (e) => ({ status: `reset (${e.cause?.code ?? e.message})` }));
    return res.status === 413 || String(res.status).startsWith('reset') || `status ${res.status}, want 413`;
  });

  await guard('...and refused EARLY, without reading the whole 200MB', async () => {
    small.bytesRead = 0;
    const chunk = crypto.randomBytes(1024 * 1024);
    try {
      await fetch(`http://127.0.0.1:${strictPort}/upload`, {
        method: 'POST',
        body: Readable.toWeb(Readable.from(Array.from({ length: 200 }, () => chunk))),
        duplex: 'half',
      }).then((r) => r.text());
    } catch { /* a reset socket is the correct outcome here */ }
    await sleep(200);
    const mb = small.bytesRead / 1024 / 1024;
    return mb < 20 || `read ${mb.toFixed(0)}MB before saying no — and a stranger picked that number`;
  });

  await guard('a Content-Length that declares too much is refused before any body arrives', async () => {
    small.bytesRead = 0;
    const res = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: strictPort, path: '/upload', method: 'POST',
        headers: { 'content-length': String(50 * 1024 * 1024) } }, (r) => { r.resume(); resolve(r.statusCode); });
      req.on('error', () => resolve('socket error'));
      req.write(crypto.randomBytes(1024));      // a single kilobyte of a 50MB claim
      // deliberately never end() — a real attacker would not either
      setTimeout(() => { req.destroy(); resolve('no answer — it is waiting for all 50MB'); }, 1500);
    });
    return (res === 413 && small.bytesRead < 1024 * 1024) ||
      `status ${res} after reading ${(small.bytesRead / 1024).toFixed(0)}KB — check content-length first`;
  });

  for (const srv of [server, strict]) {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
  return out;
}
