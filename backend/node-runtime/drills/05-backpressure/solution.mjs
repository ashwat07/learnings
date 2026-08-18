/**
 * Drill 05 — backpressure.
 *
 * Two things to write.
 *
 * createParser() -> Transform
 *   Buffer chunks in, objects out. Chunk boundaries land anywhere, so you have to hold the tail
 *   of an incomplete line between calls — and remember the LAST record, which arrives with no
 *   trailing newline and is silently dropped by almost every version of this code ever written.
 *
 * run(source, parser, sink) -> Promise
 *   Connect the three. Resolve when everything has been written; reject if anything fails.
 *
 * The starting point below is the pump you have written before. Read what it does wrong: it calls
 * sink.write() and throws away the return value. `write()` returns FALSE when the stream's buffer
 * is over its highWaterMark, and that boolean is the entire backpressure protocol. Ignore it and
 * the stream will happily accept all hundred thousand objects into memory — it does not block,
 * it does not drop, it just grows.
 *
 * "Node ran out of memory copying a large file" is always this bug.
 */

import { Transform } from 'node:stream';

export function createParser() {
  let tail = '';
  return new Transform({
    readableObjectMode: true,
    transform(chunk, _enc, cb) {
      tail += chunk.toString();
      const lines = tail.split('\n');
      tail = lines.pop();
      for (const line of lines) if (line) this.push(JSON.parse(line));
      cb();
    },
  });
}

export function run(source, parser, sink) {
  return new Promise((resolve) => {
    source.pipe(parser);
    parser.on('data', (obj) => { sink.write(obj); });   // <- the return value is the whole protocol
    parser.on('end', () => { sink.end(); resolve(); });
  });
}
