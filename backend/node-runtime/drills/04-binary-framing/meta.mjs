export const title = 'Framing a protocol over a byte stream';
export const task = `TCP is a stream of BYTES, not messages. What you write is not what the other
side reads: your 3KB message can arrive as 40 chunks, and four of your messages can arrive as one.
There is no such thing as "the socket gave me a message".

Implement a decoder for a length-prefixed frame:  [ uint32 BE length ][ length bytes of payload ].
Reject a length above maxFrame instead of trusting it — a four-byte prefix from a stranger is an
allocation request from a stranger.`;
export const passIf = 'every message survives every split, oversized frames are rejected, and reassembly is not quadratic';

const frame = (payload) => {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(buf.length);
  return Buffer.concat([head, buf]);
};

// A deterministic PRNG so a failure is reproducible — "it fails sometimes" is not a bug report.
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

export async function check(s) {
  if (typeof s.createDecoder !== 'function') {
    return [{ check: 'exports createDecoder({ onMessage, onError, maxFrame })', actual: 'missing', pass: false }];
  }
  const out = [];
  // Each block is isolated: a decoder that throws on case 3 should still show you cases 4-6.
  const guard = (label, fn) => {
    try { fn(); } catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 62), pass: false }); }
  };
  const collect = (opts = {}) => {
    const messages = [], errors = [];
    const d = s.createDecoder({ onMessage: (m) => messages.push(m), onError: (e) => errors.push(e), maxFrame: opts.maxFrame ?? 1 << 24 });
    return { d, messages, errors };
  };

  // 1. the whole point: arbitrary split points must not matter.
  guard('200 messages survive random chunking', () => {
    const payloads = Array.from({ length: 200 }, (_, i) => Buffer.from(`message-${i}-${'x'.repeat(i % 97)}`));
    const wire = Buffer.concat(payloads.map(frame));
    let worstSeed = null;
    for (let seed = 1; seed <= 25 && !worstSeed; seed++) {
      const rand = rng(seed);
      const { d, messages } = collect();
      let i = 0;
      while (i < wire.length) {
        const n = 1 + Math.floor(rand() * 40);          // chunks of 1..40 bytes
        d.push(wire.subarray(i, i + n));
        i += n;
      }
      const ok = messages.length === payloads.length &&
        messages.every((m, k) => Buffer.compare(Buffer.from(m), payloads[k]) === 0);
      if (!ok) worstSeed = { seed, got: messages.length, want: payloads.length };
    }
    out.push({
      check: '200 messages survive 25 different random chunkings',
      actual: worstSeed ? `seed ${worstSeed.seed}: got ${worstSeed.got}/${worstSeed.want}` : '25/25 exact',
      pass: !worstSeed,
    });
  });

  // 2. the header itself split — the case people forget, because it only needs 4 bytes to go wrong.
  guard('a split length prefix', () => {
    const { d, messages } = collect();
    const wire = frame('hello');
    d.push(wire.subarray(0, 2));      // half a length prefix
    d.push(wire.subarray(2, 6));      // the rest of the prefix + 2 payload bytes
    d.push(wire.subarray(6));
    out.push({
      check: 'a length prefix split across chunks still decodes',
      actual: messages.length === 1 && String(messages[0]) === 'hello' ? 'hello' : JSON.stringify(messages.map(String)),
      pass: messages.length === 1 && String(messages[0]) === 'hello',
    });
  });

  // 3. many frames in one chunk, plus a partial trailing frame.
  guard('several frames in one chunk', () => {
    const { d, messages } = collect();
    const wire = Buffer.concat([frame('a'), frame('bb'), frame('ccc'), frame('dddd')]);
    d.push(wire.subarray(0, wire.length - 2));
    out.push({ check: '3 whole frames in one chunk are all delivered', actual: messages.map(String).join(','), pass: messages.map(String).join(',') === 'a,bb,ccc' });
    d.push(wire.subarray(wire.length - 2));
    out.push({ check: 'the 4th arrives when the rest of it does', actual: messages.map(String).join(','), pass: messages.map(String).join(',') === 'a,bb,ccc,dddd' });
  });

  // 4. zero-length frame: a legal, meaningful message (a heartbeat), and an easy off-by-one.
  guard('a zero-length frame', () => {
    const { d, messages } = collect();
    d.push(Buffer.concat([frame(''), frame('after')]));
    out.push({
      check: 'a zero-length frame is delivered, not skipped',
      actual: `${messages.length} messages: [${messages.map((m) => `"${m}"`).join(', ')}]`,
      pass: messages.length === 2 && messages[0].length === 0 && String(messages[1]) === 'after',
    });
  });

  // 5. the hostile length prefix.
  guard('a hostile length prefix', () => {
    const { d, messages, errors } = collect({ maxFrame: 1024 });
    const evil = Buffer.alloc(4); evil.writeUInt32BE(4_000_000_000);
    let threw = false;
    try { d.push(evil); } catch { threw = true; }
    out.push({
      check: 'a 4GB length prefix is rejected, not allocated',
      actual: errors.length || threw ? `rejected (${errors.length ? errors[0].message.slice(0, 40) : 'threw'})` : 'accepted — it would have allocated 4GB',
      pass: (errors.length > 0 || threw) && messages.length === 0,
    });
  });

  // 6. no O(n^2) reassembly.
  guard('6MB in 1KB chunks', () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 0x61);
    const wire = frame(big);
    const { d, messages } = collect();
    const t0 = performance.now();
    for (let i = 0; i < wire.length; i += 1024) d.push(wire.subarray(i, i + 1024));
    const ms = performance.now() - t0;
    out.push({
      check: 'a 6MB message in 1KB chunks decodes in under 400ms',
      actual: `${ms.toFixed(0)}ms${messages.length === 1 && messages[0].length === big.length ? '' : ' (and the message was wrong)'}`,
      pass: ms < 400 && messages.length === 1 && messages[0].length === big.length,
    });
  });

  return out;
}
