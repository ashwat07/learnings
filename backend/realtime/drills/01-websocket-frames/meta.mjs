export const title = 'WebSocket frames, by hand';
export const task = `A WebSocket is a TCP stream after an HTTP upgrade, and everything above it is
frames you have to draw yourself. Implement them.

  encodeFrame({ opcode, payload, fin, mask }) -> Buffer
  createParser({ onFrame, maxPayload }) -> { push(chunk) }

    bit  0     FIN — is this the last fragment of a message?
    bits 4-7   opcode: 0x0 continuation, 0x1 text, 0x2 binary,
               0x8 close, 0x9 ping, 0xA pong
    bit  8     MASK — set on every client-to-server frame, never on server-to-client
    bits 9-15  payload length: 0-125 literal, 126 = read a uint16, 127 = read a uint64
    then       a 4-byte masking key if MASK, then the payload XORed with it

The byte vectors in the checks are the ones from RFC 6455 §5.7. If yours match, yours is a
WebSocket.`;
export const passIf = 'the bytes match the RFC, frames survive arbitrary chunking, fragments reassemble, and a hostile length is refused';

const hex = (b) => Buffer.from(b).toString('hex');

export async function check(s) {
  if (typeof s.encodeFrame !== 'function' || typeof s.createParser !== 'function') {
    return [{ check: 'exports encodeFrame and createParser', actual: 'missing', pass: false }];
  }
  const out = [];
  const guard = (label, fn) => {
    try { const r = fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 64), pass: false }); }
  };
  const collect = (opts = {}) => {
    const frames = [], errors = [];
    const p = s.createParser({ onFrame: (f) => frames.push(f), onError: (e) => errors.push(e), maxPayload: opts.maxPayload ?? 1 << 20 });
    return { p, frames, errors };
  };

  guard('an unmasked "Hello" is 81 05 48 65 6c 6c 6f', () => {
    const got = hex(s.encodeFrame({ opcode: 0x1, payload: Buffer.from('Hello'), fin: true }));
    return got === '810548656c6c6f' || `got ${got}`;
  });

  guard('a masked "Hello" matches the RFC vector', () => {
    const got = hex(s.encodeFrame({ opcode: 0x1, payload: Buffer.from('Hello'), fin: true, mask: Buffer.from([0x37, 0xfa, 0x21, 0x3d]) }));
    return got === '818537fa213d7f9f4d5158' || `got ${got}\n        want 818537fa213d7f9f4d5158`;
  });

  guard('a 126-byte payload switches to the 16-bit length', () => {
    const f = s.encodeFrame({ opcode: 0x2, payload: Buffer.alloc(126), fin: true });
    return (f[1] === 126 && f.readUInt16BE(2) === 126 && f.length === 4 + 126)
      ? true : `second byte ${f[1]}, total ${f.length} bytes`;
  });

  guard('a 70,000-byte payload switches to the 64-bit length', () => {
    const f = s.encodeFrame({ opcode: 0x2, payload: Buffer.alloc(70_000), fin: true });
    return (f[1] === 127 && Number(f.readBigUInt64BE(2)) === 70_000 && f.length === 10 + 70_000)
      ? true : `second byte ${f[1]}, total ${f.length}`;
  });

  guard('a 125-byte payload still uses the short form', () => {
    const f = s.encodeFrame({ opcode: 0x2, payload: Buffer.alloc(125), fin: true });
    return (f[1] === 125 && f.length === 2 + 125) ? true : `second byte ${f[1]}, total ${f.length}`;
  });

  guard('the parser reads one frame back', () => {
    const { p, frames } = collect();
    p.push(s.encodeFrame({ opcode: 0x1, payload: Buffer.from('hello there'), fin: true }));
    const f = frames[0];
    return (frames.length === 1 && f.opcode === 0x1 && f.fin === true && String(f.payload) === 'hello there')
      ? true : JSON.stringify(frames.map((x) => ({ ...x, payload: String(x.payload) })));
  });

  guard('a MASKED client frame is unmasked on the way in', () => {
    const { p, frames } = collect();
    p.push(Buffer.from('818537fa213d7f9f4d5158', 'hex'));
    return String(frames[0]?.payload) === 'Hello' ? true : `got ${JSON.stringify(String(frames[0]?.payload))}`;
  });

  // The same lesson as node-runtime drill 04, now over a real protocol.
  guard('a frame split across 20 chunks still arrives whole', () => {
    const frame = s.encodeFrame({ opcode: 0x1, payload: Buffer.from('x'.repeat(4000)), fin: true });
    for (let size = 1; size <= 20; size += 3) {
      const { p, frames } = collect();
      for (let i = 0; i < frame.length; i += size) p.push(frame.subarray(i, i + size));
      if (frames.length !== 1 || frames[0].payload.length !== 4000) {
        return `chunk size ${size}: got ${frames.length} frames, payload ${frames[0]?.payload?.length}`;
      }
    }
    return true;
  });

  guard('three frames in one chunk are all delivered, in order', () => {
    const { p, frames } = collect();
    p.push(Buffer.concat([
      s.encodeFrame({ opcode: 0x1, payload: Buffer.from('one'), fin: true }),
      s.encodeFrame({ opcode: 0x1, payload: Buffer.from('two'), fin: true }),
      s.encodeFrame({ opcode: 0x1, payload: Buffer.from('three'), fin: true }),
    ]));
    return frames.map((f) => String(f.payload)).join(',') === 'one,two,three'
      ? true : frames.map((f) => String(f.payload)).join(',');
  });

  guard('a fragmented message reassembles into one', () => {
    const { p, frames } = collect();
    p.push(s.encodeFrame({ opcode: 0x1, payload: Buffer.from('Hel'), fin: false }));
    p.push(s.encodeFrame({ opcode: 0x0, payload: Buffer.from('lo w'), fin: false }));
    p.push(s.encodeFrame({ opcode: 0x0, payload: Buffer.from('orld'), fin: true }));
    const messages = frames.filter((f) => f.opcode === 0x1);
    return (messages.length === 1 && String(messages[0].payload) === 'Hello world')
      ? true : `${frames.length} frames: ${frames.map((f) => `${f.opcode}:${String(f.payload)}`).join(' | ')}`;
  });

  // The rule people miss, and the reason a naive reassembler corrupts messages under load.
  guard('a PING between two fragments is delivered separately, not spliced into the message', () => {
    const { p, frames } = collect();
    p.push(s.encodeFrame({ opcode: 0x1, payload: Buffer.from('Hel'), fin: false }));
    p.push(s.encodeFrame({ opcode: 0x9, payload: Buffer.from('pp'), fin: true }));      // ping
    p.push(s.encodeFrame({ opcode: 0x0, payload: Buffer.from('lo'), fin: true }));
    const ping = frames.find((f) => f.opcode === 0x9);
    const text = frames.find((f) => f.opcode === 0x1);
    if (!ping) return 'the ping was swallowed — the peer will conclude you are dead and disconnect';
    return (String(text?.payload) === 'Hello' && String(ping.payload) === 'pp')
      ? true : `text=${JSON.stringify(String(text?.payload))} ping=${JSON.stringify(String(ping.payload))}`;
  });

  guard('a close frame carries its status code', () => {
    const { p, frames } = collect();
    const body = Buffer.alloc(2 + 5);
    body.writeUInt16BE(1001, 0);
    body.write('bye!!', 2);
    p.push(s.encodeFrame({ opcode: 0x8, payload: body, fin: true }));
    const f = frames[0];
    return (f?.opcode === 0x8 && f.payload.readUInt16BE(0) === 1001) ? true : JSON.stringify(f);
  });

  guard('a frame claiming 10GB is refused, not allocated', () => {
    const { p, frames, errors } = collect({ maxPayload: 1 << 16 });
    const evil = Buffer.alloc(10);
    evil[0] = 0x82;
    evil[1] = 127;
    evil.writeBigUInt64BE(10n * 1024n * 1024n * 1024n, 2);
    let threw = false;
    try { p.push(evil); } catch { threw = true; }
    return ((errors.length > 0 || threw) && frames.length === 0)
      ? true : 'accepted — and a moment later your process is gone';
  });

  guard('a 1MB message in 4KB chunks parses in under 200ms (no quadratic reassembly)', () => {
    const frame = s.encodeFrame({ opcode: 0x2, payload: Buffer.alloc(1024 * 1024, 7), fin: true });
    const { p, frames } = collect({ maxPayload: 4 << 20 });
    const t0 = performance.now();
    for (let i = 0; i < frame.length; i += 4096) p.push(frame.subarray(i, i + 4096));
    const ms = performance.now() - t0;
    return (ms < 200 && frames[0]?.payload?.length === 1024 * 1024) ? true : `${ms.toFixed(0)}ms, payload ${frames[0]?.payload?.length}`;
  });

  return out;
}
