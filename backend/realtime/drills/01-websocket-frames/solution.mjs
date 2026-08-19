/**
 * Drill 01 — WebSocket frames.
 *
 * The starting point assumes the frame header is always two bytes, never masks or unmasks, and
 * assumes one TCP chunk is one frame. It works perfectly against a small test message on
 * localhost — which is exactly how it survives review — and breaks the moment a payload exceeds
 * 125 bytes, a browser connects (browsers ALWAYS mask), or the network splits a frame.
 *
 *   encodeFrame({ opcode, payload, fin = true, mask = null }) -> Buffer
 *   createParser({ onFrame, onError, maxPayload }) -> { push(chunk) }
 *
 * onFrame receives { fin, opcode, payload }. A fragmented message (fin=false, then continuation
 * frames with opcode 0x0) must be delivered ONCE, reassembled, under the opcode of its first
 * frame. Control frames — close 0x8, ping 0x9, pong 0xA — can arrive BETWEEN fragments and must
 * be passed through immediately without joining the message.
 *
 * You have already written the state machine for this in node-runtime drill 04. This is the same
 * problem with a real protocol's header on top, and the same rule applies: a chunk is not a
 * message, and the length prefix is a claim.
 */

export function encodeFrame({ opcode, payload = Buffer.alloc(0), fin = true }) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const header = Buffer.alloc(2);
  header[0] = (fin ? 0x80 : 0) | opcode;
  header[1] = body.length;
  return Buffer.concat([header, body]);
}

export function createParser({ onFrame, onError, maxPayload = 1 << 20 }) {
  return {
    push(chunk) {
      const fin = (chunk[0] & 0x80) !== 0;
      const opcode = chunk[0] & 0x0f;
      const len = chunk[1];
      onFrame({ fin, opcode, payload: chunk.subarray(2, 2 + len) });
    },
  };
}
