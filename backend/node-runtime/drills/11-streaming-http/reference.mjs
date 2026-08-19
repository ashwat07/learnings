/** Drill 11 — reference. */

import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export function createHandler({ maxUploadBytes = 1024 * 1024, stats = {} } = {}) {
  return function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/download') return download(req, res, url, stats);
    if (req.method === 'POST' && url.pathname === '/upload') return upload(req, res, maxUploadBytes, stats);
    res.writeHead(404).end();
  };
}

// ---------------------------------------------------------------------------

function download(req, res, url, stats) {
  const rows = Number(url.searchParams.get('rows') ?? 10);

  // A generator is the cleanest source: Readable.from() drives it, and it only asks for the next
  // value when there is room. Backpressure becomes "the generator is not resumed", which needs no
  // code at all — compare with the res.write()/'drain' dance you would otherwise write by hand.
  //
  // The batching matters too: one res.write() per row means one syscall-ish operation and one
  // chunk of framing per row. Batching to ~64KB is roughly an order of magnitude fewer writes.
  function* generate() {
    let buf = '';
    for (let i = 0; i < rows; i++) {
      if (res.destroyed) return;                 // the client went away; stop generating
      stats.generated = (stats.generated ?? 0) + 1;
      buf += `{"id":${i},"name":"row-${i}"}\n`;
      if (buf.length >= 64 * 1024) { yield buf; buf = ''; }
    }
    if (buf) yield buf;
  }

  // No Content-Length: we do not know the size without generating it all, which is the thing we
  // are refusing to do. Node sends Transfer-Encoding: chunked automatically. The client gets its
  // first byte immediately instead of after the whole export — better TTFB and no timeout on a
  // slow query.
  res.writeHead(200, {
    'content-type': 'application/x-ndjson',
    'cache-control': 'no-store',
    // Tells proxies not to buffer the response on your behalf, which would undo all of this.
    'x-accel-buffering': 'no',
  });

  // pipeline() rather than .pipe(): it destroys the source when the response is destroyed, which
  // is what makes the disconnect case actually stop work. An error here is normal (the client
  // hung up), not exceptional — log it at debug, never as a 500, because there is nobody left to
  // send a 500 to.
  pipeline(Readable.from(generate()), res).catch(() => {});
}

// ---------------------------------------------------------------------------

async function upload(req, res, maxUploadBytes, stats) {
  // 1. The cheap check first. Content-Length is a CLAIM, not a fact — a chunked request has none,
  //    and a hostile client can lie — but when it is present and too big you can refuse before a
  //    single byte of body arrives.
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxUploadBytes) {
    return reject(req, res, declared);
  }

  const hash = crypto.createHash('sha256');
  let bytes = 0;

  try {
    // for await over the request gives you backpressure for free: the socket is not read again
    // until the loop body returns. A req.on('data') handler does not — it switches the stream
    // into flowing mode and the data arrives whether you are ready or not.
    for await (const chunk of req) {
      bytes += chunk.length;
      stats.bytesRead = (stats.bytesRead ?? 0) + chunk.length;

      // 2. And keep counting. This is the check that actually protects you, because it does not
      //    trust anything the client said.
      if (bytes > maxUploadBytes) return reject(req, res, bytes);

      hash.update(chunk);          // hash as it arrives; the body is never assembled anywhere
    }
  } catch (err) {
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: 'upload failed', code: err.code }));
    return;
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ bytes, sha256: hash.digest('hex') }));
}

function reject(req, res, seen) {
  if (!res.headersSent) {
    res.writeHead(413, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ error: 'payload too large' }));
  }
  // Stop reading, and cut the socket. Without this the client keeps sending its 200MB, your
  // kernel keeps buffering it, and you have paid the bandwidth for a request you rejected.
  // `res.end()` alone does NOT stop an upload in flight.
  req.destroy();
}

/*
THE FOUR RULES

  1. NEVER BUILD A RESPONSE IN MEMORY THAT SCALES WITH INPUT. A report, an export, a log tail, a
     file — stream it. The cost is not just peak heap: it is peak heap PER CONCURRENT CLIENT, and
     the failure mode is that ten simultaneous exports OOM a process that handled one fine.

  2. NEVER ACCUMULATE A REQUEST BODY. `let body = ''; req.on('data', c => body += c)` is both a
     memory bug (see drill 05 — string concatenation is O(n^2) too) and a denial-of-service
     primitive: the size is chosen by whoever is calling you. Every framework's body parser has a
     limit for this reason, and the default is usually 100KB — check yours, because "why does my
     upload fail at exactly 1MB" is the same fact from the other side.

  3. CHECK THE LIMIT TWICE: Content-Length for the cheap early refusal, a running counter because
     Content-Length is a claim. And destroy the socket when you refuse — a 413 with the body
     still arriving is a 413 you paid full price for.

  4. STOP WHEN THE CLIENT GOES. `res.destroyed`, `res.on('close')`, or `req.signal` (Node 18+,
     an AbortSignal that fires on disconnect — plumb it into your database query, see drill 06).
     A user who hits Escape on a slow report should not cost you the report.

MULTIPART, HONESTLY
Do not parse multipart/form-data by hand. The format is `boundary`-delimited with per-part
headers, the boundary can appear inside binary content, and the edge cases are a security
surface. Use busboy (the parser under most others) or @fastify/multipart, and stream each part
straight to its destination — S3, disk, a hash — rather than to a Buffer. The rules above still
apply: a per-file limit, a total limit, a file-count limit, and a check on the declared filename
before it ever touches a path.

FOR REALLY LARGE FILES, DO NOT PROXY THEM AT ALL
The best upload endpoint issues a PRESIGNED URL and gets out of the way: the client PUTs straight
to object storage, and your service handles a few hundred bytes of metadata instead of gigabytes
of body. You lose the ability to inspect the content inline — which is what the "virus scan on
the object-created event" pattern exists to solve.

DOWNLOADS: THE HEADERS THAT MATTER
  content-type            application/x-ndjson, text/csv; charset=utf-8, ...
  content-disposition     attachment; filename="export.csv"  — and encode the filename
  cache-control: no-store for anything per-user
  accept-ranges / range   if you want resumable downloads; fs.createReadStream takes {start,end}
And compress: pipeline(source, zlib.createGzip(), res) when the client sends Accept-Encoding,
which for NDJSON is usually a 10x saving for a few percent of CPU.
*/
