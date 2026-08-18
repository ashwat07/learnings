/** Drill 04 — reference. */

const HEADER = 4;

export function createDecoder({ onMessage, onError, maxFrame = 1 << 24 }) {
  // Hold the chunks in a LIST and only concat when a frame actually spans more than one of them.
  // The common case — several whole frames inside one chunk — then does zero copying at all,
  // because subarray() is a view over the same memory.
  let queue = [];
  let queued = 0;      // bytes currently held across all chunks in `queue`
  let need = -1;       // payload length of the frame being assembled, -1 until the header is read

  const fail = (message) => {
    const err = Object.assign(new Error(message), { code: 'EPROTO' });
    if (onError) onError(err); else throw err;
    queue = []; queued = 0; need = -1;    // the stream is no longer trustworthy; stop parsing it
    return false;
  };

  // Take exactly n bytes off the front of the queue.
  const take = (n) => {
    if (n === 0) return Buffer.alloc(0);
    if (queue[0].length === n) { queued -= n; return queue.shift(); }
    if (queue[0].length > n) {
      const head = queue[0].subarray(0, n);
      queue[0] = queue[0].subarray(n);
      queued -= n;
      return head;
    }
    const parts = [];
    let got = 0;
    while (got < n) {
      const c = queue[0];
      if (got + c.length <= n) { parts.push(c); got += c.length; queue.shift(); }
      else { parts.push(c.subarray(0, n - got)); queue[0] = c.subarray(n - got); got = n; }
    }
    queued -= n;
    return Buffer.concat(parts, n);
  };

  return {
    push(chunk) {
      if (chunk.length === 0) return;
      queue.push(chunk);
      queued += chunk.length;

      // Loop, because one chunk may complete several frames.
      for (;;) {
        if (need === -1) {
          if (queued < HEADER) return;                 // not even a length yet
          const header = take(HEADER);
          need = header.readUInt32BE(0);
          // Validate BEFORE believing it. This check is the difference between a decoder and a
          // remote memory-allocation primitive: without it, four bytes from an attacker (or a
          // client that got the byte order wrong) ask you for 4GB.
          if (need > maxFrame) return fail(`frame of ${need} bytes exceeds maxFrame ${maxFrame}`);
        }
        if (queued < need) return;                     // header known, payload incomplete
        const payload = take(need);
        need = -1;
        onMessage(payload);                            // note: length 0 is a legal frame
      }
    },
    get buffered() { return queued; },
  };
}

/*
THE FOUR IDEAS

1. THE STATE MACHINE IS THE DESIGN. `need === -1` means "reading a header"; anything else means
   "reading a payload of that many bytes". Every framing bug is a decoder that has no explicit
   state and tries to infer it from the current chunk.

2. LOOP AFTER EVERY PUSH. Not `if`. A 40-byte chunk can complete the frame you were waiting for
   AND contain three more. Decoders that deliver one message per push silently stall under load —
   the exact moment chunks start getting bigger.

3. VALIDATE THE LENGTH PREFIX. maxFrame is not defensive programming, it is the protocol. Every
   real one has it: HTTP/2 SETTINGS_MAX_FRAME_SIZE, WebSocket's max payload, Postgres's message
   length limit. Also note what happens after a violation: the reference stops parsing entirely,
   because once you have lost sync with the frame boundaries every subsequent "length" is
   arbitrary bytes from the middle of someone's payload. Close the connection.

4. QUEUE, DO NOT CONCAT. `rest = Buffer.concat([rest, chunk])` on every push copies the entire
   accumulated buffer every time. For a 6MB message in 1KB chunks that is ~18GB of memcpy and
   about 1.6 seconds of CPU — with the loop blocked for all of it. The chunk list makes the
   common path allocation-free.

WHAT THIS LOOKS LIKE IN REAL CODE

You would normally write this as a Transform in object mode and let pipeline() carry backpressure
(drill 05) — but the parsing state machine inside is exactly the code above. It is also worth
knowing that `net.Socket` gives you no help here at all, and that the reason people reach for
newline-delimited JSON is that `\n` framing needs no length prefix and no maxFrame... until a
payload contains a newline, at which point you are debugging something much worse.

Length-prefixed framing is what gRPC, Postgres's wire protocol, Redis's RESP (partly) and every
serious binary protocol use, for exactly the reason above: the receiver knows how much to allocate
before it allocates, and there is no escaping to get wrong.
*/
