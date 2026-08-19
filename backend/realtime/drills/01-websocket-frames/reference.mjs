/** Drill 01 — reference. */

const OPCODE = { CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };
const isControl = (opcode) => (opcode & 0x8) !== 0;

export function encodeFrame({ opcode, payload = Buffer.alloc(0), fin = true, mask = null }) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));

  // Control frames must be <= 125 bytes and must never be fragmented. This is not pedantry: a
  // fragmented ping would deadlock the keepalive, because the peer cannot answer until it has
  // the whole thing, and the whole thing is behind the message it is interleaved with.
  if (isControl(opcode)) {
    if (body.length > 125) throw new RangeError('a control frame cannot exceed 125 bytes');
    if (!fin) throw new RangeError('a control frame cannot be fragmented');
  }

  let lengthBytes;
  if (body.length < 126) {
    lengthBytes = Buffer.from([body.length]);
  } else if (body.length < 65536) {
    lengthBytes = Buffer.alloc(3);
    lengthBytes[0] = 126;
    lengthBytes.writeUInt16BE(body.length, 1);
  } else {
    lengthBytes = Buffer.alloc(9);
    lengthBytes[0] = 127;
    lengthBytes.writeBigUInt64BE(BigInt(body.length), 1);
  }

  const first = Buffer.from([(fin ? 0x80 : 0x00) | (opcode & 0x0f)]);
  if (!mask) return Buffer.concat([first, lengthBytes, body]);

  // The masking key. It exists for one reason and it is not confidentiality — the key is sent in
  // clear, right next to the data. It is to stop CACHE POISONING: without it, an attacker could
  // craft a payload that a transparent proxy on the path mistakes for a second HTTP request and
  // caches. Hence the rule: clients MUST mask, servers MUST NOT, and each frame gets a fresh
  // random key.
  lengthBytes[0] |= 0x80;
  const masked = Buffer.allocUnsafe(body.length);
  for (let i = 0; i < body.length; i++) masked[i] = body[i] ^ mask[i % 4];
  return Buffer.concat([first, lengthBytes, mask, masked]);
}

export function createParser({ onFrame, onError, maxPayload = 1 << 20 }) {
  // Same shape as node-runtime drill 04: a chunk LIST, never `rest = Buffer.concat([rest, chunk])`
  // — a 1MB message in 4KB chunks would otherwise be ~130MB of memcpy.
  let queue = [];
  let queued = 0;
  // The reassembly buffer for a fragmented message, and the opcode it started with.
  let fragments = null;
  let fragmentOpcode = 0;

  const fail = (message) => {
    const err = Object.assign(new Error(message), { code: 'EWSPROTO' });
    queue = []; queued = 0; fragments = null;
    if (onError) onError(err); else throw err;
    return false;
  };

  const peek = (n) => {
    if (queued < n) return null;
    if (queue[0].length >= n) return queue[0].subarray(0, n);
    return Buffer.concat(queue, queued).subarray(0, n);
  };

  const consume = (n) => {
    let taken = 0;
    const parts = [];
    while (taken < n) {
      const head = queue[0];
      const need = n - taken;
      if (head.length <= need) { parts.push(head); taken += head.length; queue.shift(); }
      else { parts.push(head.subarray(0, need)); queue[0] = head.subarray(need); taken = n; }
    }
    queued -= n;
    return parts.length === 1 ? parts[0] : Buffer.concat(parts, n);
  };

  const deliver = (fin, opcode, payload) => {
    // A control frame is delivered immediately and does NOT touch the fragment buffer. Merging it
    // into the message is the bug this rule exists to prevent — and it is easy to write, because
    // the obvious loop appends every payload it sees to the same buffer.
    if (isControl(opcode)) { onFrame({ fin: true, opcode, payload }); return; }

    if (opcode === OPCODE.CONTINUATION) {
      if (!fragments) return fail('continuation frame with nothing to continue');
      fragments.push(payload);
      if (!fin) return;
      const whole = Buffer.concat(fragments);
      const op = fragmentOpcode;
      fragments = null;
      onFrame({ fin: true, opcode: op, payload: whole });
      return;
    }

    if (!fin) { fragments = [payload]; fragmentOpcode = opcode; return; }
    if (fragments) return fail('a new message started while one was still fragmented');
    onFrame({ fin: true, opcode, payload });
  };

  return {
    push(chunk) {
      if (!chunk?.length) return;
      queue.push(chunk);
      queued += chunk.length;

      // Loop: one chunk may hold several frames, and one frame may need several chunks.
      for (;;) {
        const first2 = peek(2);
        if (!first2) return;

        const fin = (first2[0] & 0x80) !== 0;
        const rsv = first2[0] & 0x70;
        const opcode = first2[0] & 0x0f;
        const masked = (first2[1] & 0x80) !== 0;
        const short = first2[1] & 0x7f;

        // RSV bits are reserved for extensions negotiated at handshake time (permessage-deflate
        // uses RSV1). If you did not negotiate one, they must be zero — otherwise you are about
        // to parse compressed bytes as though they were not.
        if (rsv !== 0) return fail('reserved bits set with no extension negotiated');

        let headerLength = 2;
        let payloadLength = short;
        if (short === 126) {
          const h = peek(4); if (!h) return;
          payloadLength = h.readUInt16BE(2); headerLength = 4;
        } else if (short === 127) {
          const h = peek(10); if (!h) return;
          const big = h.readBigUInt64BE(2);
          // Check BEFORE converting and long before allocating. Sixty-four bits of length is an
          // allocation request from a stranger, and the top bit must be 0 per the RFC.
          if (big > BigInt(maxPayload)) return fail(`frame of ${big} bytes exceeds maxPayload ${maxPayload}`);
          payloadLength = Number(big); headerLength = 10;
        }
        if (payloadLength > maxPayload) return fail(`frame of ${payloadLength} bytes exceeds maxPayload ${maxPayload}`);
        if (isControl(opcode) && (payloadLength > 125 || !fin)) return fail('malformed control frame');

        const total = headerLength + (masked ? 4 : 0) + payloadLength;
        if (queued < total) return;                       // the rest of the frame is still in flight

        consume(headerLength);
        const key = masked ? consume(4) : null;
        const payload = payloadLength ? consume(payloadLength) : Buffer.alloc(0);
        if (key) for (let i = 0; i < payload.length; i++) payload[i] ^= key[i % 4];

        deliver(fin, opcode, payload);
      }
    },
    get buffered() { return queued; },
  };
}

/*
WHAT A REAL SERVER DOES AROUND THIS

  1. THE HANDSHAKE. An ordinary HTTP GET with `Upgrade: websocket`, and the server replies 101
     with `Sec-WebSocket-Accept = base64(sha1(clientKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`.
     That magic GUID is in the RFC. It proves the server understood the protocol rather than
     being an ordinary endpoint that echoes headers — not a security measure.
  2. AUTHENTICATE DURING THE HANDSHAKE, not after. Once the socket is open you have no status
     codes and no ergonomic way to say 401. Drill 02.
  3. ANSWER PINGS. If you never reply to a ping, the peer concludes you are dead. If you never
     SEND one, you will not notice when it is (drill 02 — a TCP connection to a laptop that went
     into a tunnel stays "open" for many minutes).
  4. permessage-deflate. Negotiated at handshake, uses RSV1, and is a real win on JSON traffic and
     a real cost in CPU and memory per connection. Measure before enabling it for thousands of
     sockets.

WHY YOU SHOULD STILL USE `ws`
Everything above is the easy half. The half this drill skips: UTF-8 validation on text frames
(the RFC requires rejecting invalid sequences mid-stream), close handshake state machine, the
per-connection memory of the extension, and years of fuzzing. Write it once to understand it,
then `npm install ws`.

WHEN NOT TO USE A WEBSOCKET AT ALL
If the data only flows one way — a live price, a progress bar, tokens streaming out of a model —
Server-Sent Events is less machinery, runs over plain HTTP/2, reconnects automatically, and
survives proxies that mangle upgrades. Drill 05.
*/
