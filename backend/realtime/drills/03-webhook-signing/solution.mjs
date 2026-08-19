/**
 * Drill 03 — verifying a webhook.
 *
 * The starting point is the version in a hundred blog posts and a fair number of production
 * codebases. It computes the right HMAC and then throws away every property that made it worth
 * computing:
 *
 *   · `===` on the digests, which leaks the answer one character at a time
 *   · no timestamp, so a request captured today is valid forever
 *   · no replay memory, so one legitimate "payment.succeeded" can be delivered a thousand times
 *   · one signature per header, so the provider can never rotate its secret
 *
 * Header format, the one Stripe/Svix/GitHub all use a variant of:
 *
 *     t=1700000000,v1=<hex>,v1=<hex during rotation>
 *
 * and the signed string is `${timestamp}.${rawBody}` — the timestamp is INSIDE the HMAC, or it
 * is just a number an attacker can edit.
 *
 *   sign(rawBody, secret, timestamp) -> header string
 *   verify({ rawBody, header, secret, toleranceSec, seen }) -> { ok, reason }
 *
 * And the one that is not in this file at all, because it is in your framework: the signature
 * covers the BYTES THAT ARRIVED. If your JSON body parser has already run, `JSON.stringify(req.body)`
 * is a different string — different key order, different spacing — and nothing will ever verify.
 * You need the raw body: `express.raw({type: 'application/json'})`, Fastify's `addContentTypeParser`
 * with `parseAs: 'buffer'`, or `await request.text()` before you parse.
 */

import crypto from 'node:crypto';

export function sign(rawBody, secret, timestamp) {
  const mac = crypto.createHmac('sha256', secret).update(String(rawBody)).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

// A hand-rolled comparison. It looks careful — it checks the length first — and it returns as
// soon as it finds a difference, which is precisely the information an attacker wants.
export function secureCompare(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function verify({ rawBody, header, secret }) {
  const provided = /v1=([0-9a-f]+)/.exec(header)?.[1];
  const expected = crypto.createHmac('sha256', secret).update(String(rawBody)).digest('hex');
  if (provided && secureCompare(provided, expected)) return { ok: true };
  return { ok: false, reason: 'bad signature' };
}
