/** Drill 03 — reference. */

import crypto from 'node:crypto';

const signedPayload = (timestamp, rawBody) => `${timestamp}.${rawBody}`;

/**
 * timingSafeEqual compares every byte, always. It does not stop at the first difference, so the
 * time it takes carries no information about HOW MUCH of the input was right.
 *
 * The alternative — any loop with an early return, or `===` on strings — takes longer the more
 * leading bytes match. Measured over long inputs that is a 250x difference; at 64 hex characters
 * it is small, noisy, and still enough, because an attacker can average over thousands of
 * requests. There is published work recovering HMACs this way over a network. The safe version
 * costs nothing, so there is no case for the other one.
 *
 * The length check must come first and must NOT use timingSafeEqual, which throws on a mismatch.
 * Leaking the length of a fixed-length digest is not a secret.
 */
export function secureCompare(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function sign(rawBody, secret, timestamp) {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  const mac = crypto.createHmac('sha256', secret).update(signedPayload(timestamp, body)).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export function verify({ rawBody, header, secret, toleranceSec = 300, seen = null, now = Date.now }) {
  // Every failure returns a REASON for your logs and the SAME opaque outcome to the caller. Do not
  // tell the sender which check failed — "bad signature" versus "too old" versus "already seen"
  // is a free oracle for someone probing your endpoint.
  const fail = (reason) => ({ ok: false, reason });

  if (typeof header !== 'string' || header.length === 0) return fail('missing signature header');
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : (rawBody == null ? null : String(rawBody));
  if (body === null) return fail('missing body');

  // Parse defensively: this is attacker-controlled input, before any authentication has happened.
  let timestamp = null;
  const candidates = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      if (!/^\d{1,15}$/.test(value)) return fail('malformed timestamp');
      timestamp = Number(value);
    } else if (key === 'v1') {
      // Length and alphabet checked before we do anything with it. A hex string of the wrong
      // length can never be a SHA-256 digest, and rejecting it here keeps timingSafeEqual — which
      // throws on a length mismatch — off the hostile path.
      if (/^[0-9a-f]{64}$/.test(value)) candidates.push(value);
    }
  }
  if (timestamp === null) return fail('no timestamp');
  if (candidates.length === 0) return fail('no usable signature');

  // The timestamp window. Two jobs: it bounds how long a captured request stays useful, and it
  // bounds how much replay history you have to remember (see `seen`). Both directions matter —
  // a future timestamp is as suspicious as an old one, and allowing it lets an attacker mint a
  // request that is valid for as long as they like.
  const nowSec = Math.floor(now() / 1000);
  const drift = Math.abs(nowSec - timestamp);
  if (drift > toleranceSec) return fail(`timestamp outside the ${toleranceSec}s tolerance (off by ${drift}s)`);

  const expected = crypto.createHmac('sha256', secret).update(signedPayload(timestamp, body)).digest();

  // Check EVERY candidate, and in constant time.
  //
  // timingSafeEqual does not short-circuit on the first differing byte. `===` on strings does, so
  // the time it takes reveals how many leading characters you got right — and an attacker who can
  // measure that recovers the signature one character at a time, in a few thousand requests. Over
  // a network the signal is noisy and it is still exploitable; there is published work doing
  // exactly this. The countermeasure costs nothing, so there is no argument for the fast version.
  //
  // Note the loop does not `break`: exiting early on the first match would leak how many
  // signatures were checked. With at most two or three that is a small leak, and free to avoid.
  let matched = false;
  for (const candidate of candidates) {
    const provided = Buffer.from(candidate, 'hex');
    if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) matched = true;
  }
  if (!matched) return fail('signature mismatch');

  // Replay. The signature proves the request was GENUINE; it says nothing about whether it is the
  // FIRST time you have seen it. A network capture, a proxy log, an over-enthusiastic retry from
  // the provider — all produce a perfectly valid duplicate.
  //
  // The key is the signature itself, which is unique per (timestamp, body). Entries only need to
  // live as long as the tolerance window — after that the timestamp check rejects them anyway —
  // so in production this is a Redis SETNX with a TTL of `toleranceSec`, not an unbounded Set.
  if (seen) {
    const key = candidates.find((c) => {
      const buf = Buffer.from(c, 'hex');
      return buf.length === expected.length && crypto.timingSafeEqual(buf, expected);
    });
    if (seen.has(key)) return fail('replayed request');
    seen.add(key);
  }

  return { ok: true, timestamp };
}

/*
THE ORDER OF THE CHECKS IS PART OF THE DESIGN

  1. parse the header — cheap, and rejects garbage before you touch a crypto primitive
  2. the timestamp window — cheap, and it bounds everything below
  3. the HMAC — the expensive one, and the one that must be constant-time
  4. replay — only meaningful once you know the request is genuine

Doing the replay check before the signature would let anyone fill your dedupe store with junk.

WHAT ELSE A WEBHOOK RECEIVER NEEDS

  · RETURN 2xx FAST, then do the work. Providers time out in seconds and retry on anything else,
    so a receiver that processes inline turns one slow database call into a duplicate delivery
    storm. Verify, enqueue, return 200 (jobs-and-messaging drill 01).
  · BE IDEMPOTENT ANYWAY. Signature-replay protection covers a repeat of the same BYTES; a
    provider legitimately retrying sends a new timestamp and a new signature for the same event
    id. Deduplicate on the event id in your database, with a unique constraint
    (caching-and-queues drill 03). The two protections are not the same and you need both.
  · ORDER IS NOT GUARANTEED. `payment.succeeded` can arrive before `payment.created`. Handle
    events by their own state, or use the event's own sequence/version if it has one.
  · IP ALLOW-LISTS ARE NOT AUTHENTICATION. Providers change ranges, and anything inside your
    network can spoof one. Signatures are the control; an allow-list is defence in depth.
  · ONE SECRET PER ENDPOINT, rotatable, in a secret manager. The multiple-v1 header exists
    precisely so rotation needs no downtime: accept both for an overlap window, then drop the old.
  · CAP THE BODY SIZE before you read it (node-runtime drill 11). This endpoint is public.

AND FROM THE SENDING SIDE
If you are the one delivering webhooks, everything above is your contract to honour, plus retries
with backoff, a dead-letter queue, and a way for the receiver to see and replay failed
deliveries — which is drill 04.
*/
