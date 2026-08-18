/** Drill 05 — reference. */

import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function createParser() {
  let tail = '';
  return new Transform({
    // Two separate flags. The WRITABLE side takes Buffers (so leave it alone); only the READABLE
    // side emits objects. `objectMode: true` would set both and quietly change what the writable
    // side counts — its highWaterMark would become 16 OBJECTS instead of 16KB of bytes.
    readableObjectMode: true,
    readableHighWaterMark: 64,

    transform(chunk, _enc, cb) {
      // A chunk can end mid-record, mid-string, mid-escape-sequence. Keep the tail.
      // (toString() on a chunk that ends mid-UTF-8 would also corrupt a multibyte character —
      // for real binary-safe line splitting use a StringDecoder, or split on the Buffer.)
      tail += chunk.toString('utf8');
      const lines = tail.split('\n');
      tail = lines.pop();                 // the last element is either '' or a partial record
      try {
        for (const line of lines) if (line) this.push(JSON.parse(line));
      } catch (e) { return cb(e); }       // report parse errors through cb, never throw
      cb();
    },

    // _flush runs after the writable side ends: the last record has no trailing newline, so
    // without this it is dropped. This is the most common bug in NDJSON parsers.
    flush(cb) {
      try { if (tail.trim()) this.push(JSON.parse(tail)); } catch (e) { return cb(e); }
      cb();
    },
  });
}

export async function run(source, parser, sink) {
  // pipeline() is the answer, and it is worth knowing exactly what it does that .pipe() does not:
  //
  //   .pipe()      forwards data and honours backpressure — and nothing else. On an error
  //                anywhere it UNPIPES and leaves every other stream in the chain open. The
  //                source keeps its file descriptor, the socket stays connected, the memory stays
  //                reachable. This is the single biggest source of fd leaks in Node services.
  //
  //   pipeline()   forwards data, honours backpressure, and on error or early close DESTROYS
  //                every stream in the chain, then reports the first error. It also resolves only
  //                when the final stream has actually FINISHED — not when the source ended.
  //
  // The promise form additionally lets you `await` it, which means try/finally works and the
  // error arrives at a place that can do something about it.
  await pipeline(source, parser, sink);
}

/*
BACKPRESSURE, IN ONE PARAGRAPH

Every Node stream has an internal buffer and a highWaterMark. `writable.write(chunk)` returns
false when the buffer is over the mark; that is not an error and the write still succeeded — it
is the stream saying "I accepted this, but stop sending". The contract is: stop calling write(),
wait for the 'drain' event, resume. .pipe() and pipeline() implement that contract for you. A
`for await (const x of readable)` loop plus `await once(sink, 'drain')` implements it by hand. A
`readable.on('data', x => sink.write(x))` handler does not implement it at all — and worse,
attaching a 'data' listener switches the readable into FLOWING mode, so it will not even wait for
you to ask for more.

WHAT THE NUMBERS IN THIS DRILL MEAN

The naive pump buffers all 100,000 objects inside the sink because the sink is never allowed to
say no. That is the peak-buffered check. Now imagine those objects are 4KB rows from a Postgres
cursor and the sink is an HTTP response to a client on a phone: the client's slow connection
becomes your server's heap. This is exactly the bug drill 03 of jobs-and-messaging measures at
53MB, and it is why `res.write()` in a loop without checking the return value is a memory bug and
not a style preference.

WHEN TO USE WHAT

  pipeline(a, b, c)              always, for anything more than one hop
  for await (const x of stream)  when you need per-item async logic; backpressure comes free
                                 because the loop does not ask for the next item until you return
  Transform                      stateful per-chunk work (parsing, framing, compression)
  objectMode                     the moment your items are not bytes — and remember highWaterMark
                                 then counts OBJECTS, so 16 huge objects can be more memory than
                                 16KB of bytes
  Web Streams (ReadableStream)   at the edges — fetch, Workers, Deno/Bun compat. Node's own I/O is
                                 still faster on node: streams; convert with Readable.fromWeb().
*/
