/**
 * Drill 04 — framing.
 *
 * The starting point is the bug, and it is the single most common bug in hand-rolled network code:
 * it assumes one chunk is one message. It works perfectly against localhost with small payloads,
 * which is how it reaches production.
 *
 *   createDecoder({ onMessage, onError, maxFrame }) -> { push(chunk) }
 *
 *   onMessage(payloadBuffer)   called once per complete frame, in order
 *   onError(err)               called for a protocol violation (or throw — either is accepted)
 *   maxFrame                   the largest payload you will agree to buffer
 *
 * Three things to get right, in order of how often they are got wrong:
 *   1. a chunk can contain several frames, part of a frame, or both
 *   2. the 4-byte length prefix itself can be split across chunks
 *   3. reassembling by Buffer.concat on every push is O(n^2) — fine on the localhost test,
 *      seconds of CPU on a real 6MB upload
 */

export function createDecoder({ onMessage, onError, maxFrame = 1 << 24 }) {
  return {
    push(chunk) {
      const length = chunk.readUInt32BE(0);
      onMessage(chunk.subarray(4, 4 + length));
    },
  };
}
