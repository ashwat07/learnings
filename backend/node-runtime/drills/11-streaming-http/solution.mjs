/**
 * Drill 11 — streaming, both directions.
 *
 * The starting point is the code everyone writes first, and both halves of it are the same
 * mistake: putting the whole thing in memory because the API lets you.
 *
 *   createHandler({ maxUploadBytes, stats }) -> (req, res) => void
 *
 *     GET  /download?rows=N   N lines of {"id":i,"name":"row-i"}, newline-separated
 *     POST /upload            reply {"bytes":n,"sha256":"..."}; 413 if the body exceeds the limit
 *
 * `stats` is the harness watching you. Increment stats.generated once per row you produce, and
 * stats.bytesRead by the length of every upload chunk you take off the socket. They are how the
 * checks tell "streamed" from "buffered", and how they tell whether you stopped working when the
 * client went away.
 *
 * Four things to get right:
 *   1. produce rows only as fast as the socket drains — res.write() returns false, and 'drain'
 *      is when you may continue
 *   2. never accumulate the request body; hash it as it arrives
 *   3. refuse an oversized upload as soon as you know, not after you have read all of it —
 *      check Content-Length first, and keep counting anyway, because Content-Length is a claim
 *   4. stop working when the client hangs up
 */

import crypto from 'node:crypto';

export function createHandler({ maxUploadBytes = 1024 * 1024, stats = {} } = {}) {
  return function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/download') {
      const rows = Number(url.searchParams.get('rows') ?? 10);
      let body = '';
      for (let i = 0; i < rows; i++) {
        stats.generated = (stats.generated ?? 0) + 1;
        body += JSON.stringify({ id: i, name: `row-${i}` }) + '\n';
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(body);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/upload') {
      const chunks = [];
      req.on('data', (c) => {
        stats.bytesRead = (stats.bytesRead ?? 0) + c.length;
        chunks.push(c);
      });
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (body.length > maxUploadBytes) {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'too large' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          bytes: body.length,
          sha256: crypto.createHash('sha256').update(body).digest('hex'),
        }));
      });
      return;
    }

    res.writeHead(404).end();
  };
}
