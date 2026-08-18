/** The world drill 05 runs against. Read it — the checks only make sense once you have. */
import { Readable, Writable } from 'node:stream';

/**
 * A fast producer: n NDJSON records, emitted as Buffer chunks whose boundaries fall wherever they
 * like — mid-record, mid-number, mid-anything. Exactly like a socket or a file read.
 */
export function makeSource(n) {
  let i = 0;
  let pending = '';
  return new Readable({
    highWaterMark: 64 * 1024,
    read() {
      // Produce a chunk of ~8KB, then cut it at an arbitrary point.
      while (pending.length < 8192 && i < n) {
        pending += JSON.stringify({ id: i, name: `user-${i}`, score: (i * 7919) % 1000 }) + '\n';
        i++;
      }
      if (pending.length === 0) { this.push(null); return; }
      const cut = 1 + Math.floor(Math.random() * Math.min(pending.length, 3000));
      const chunk = pending.slice(0, cut);
      pending = pending.slice(cut);
      this.push(Buffer.from(chunk));
    },
  });
}

/**
 * A slow consumer with a small buffer: highWaterMark 64 OBJECTS, and every write costs a turn of
 * the event loop. This is a database, an HTTP client, a disk — anything downstream of you.
 */
export function makeSink({ failAt = -1 } = {}) {
  const received = [];
  let peak = 0;
  const sink = new Writable({
    objectMode: true,
    highWaterMark: 64,
    write(obj, _enc, cb) {
      // writableLength is how many objects are sitting in this stream's buffer waiting for us.
      // If it climbs, the producer is ignoring backpressure and the buffer IS the memory leak.
      peak = Math.max(peak, sink.writableLength);
      received.push(obj);
      if (received.length === failAt) { setImmediate(() => cb(new Error('downstream exploded'))); return; }
      setImmediate(cb);
    },
  });
  // Swallow 'error' here so a solution that never handles it fails the CHECK rather than killing
  // the whole drill run with an unhandled 'error' event. In your own code, that crash is the
  // correct behaviour and you should not copy this line.
  sink.on('error', () => {});
  sink.received = received;
  Object.defineProperty(sink, 'peakBuffered', { get: () => peak });
  return sink;
}
