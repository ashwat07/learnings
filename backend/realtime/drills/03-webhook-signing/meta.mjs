import crypto from 'node:crypto';

export const title = 'Signing webhooks — and the runner is the attacker';
export const task = `You expose POST /webhooks/payments. So does everyone. The endpoint is public,
the payload says "this customer paid", and the only thing standing between that and free money is
whether you can prove the request came from your provider.

  sign(rawBody, secret, timestamp) -> "t=<unix>,v1=<hex>"
  verify({ rawBody, header, secret, toleranceSec, seen }) -> { ok, reason }
  secureCompare(a, b) -> boolean          used by verify, and timed directly by the checks

"seen" is a Set you may use to remember what you have already accepted.

Every check below is an attack, and each is something that has actually been shipped: comparing
signatures with ===, signing the re-serialised JSON instead of the bytes that arrived, and
accepting a replay of a request that was legitimate an hour ago.`;
export const passIf = 'every forgery and replay is refused, comparison is constant-time, and the signature covers the RAW BYTES';

const SECRET = 'whsec_test_9f2b4c8e1a';
const OTHER = 'whsec_someone_elses_key';

export async function check(s) {
  for (const fn of ['sign', 'verify', 'secureCompare']) {
    if (typeof s[fn] !== 'function') return [{ check: `exports ${fn}()`, actual: 'missing', pass: false }];
  }
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 64), pass: false }); }
  };

  const now = () => Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', amount: 500 });
  const ok = (extra = {}) => s.verify({ rawBody: body, header: s.sign(body, SECRET, now()), secret: SECRET, toleranceSec: 300, seen: new Set(), ...extra });

  await guard('a genuine request is accepted', async () => {
    const r = await ok();
    return r.ok === true || `rejected a valid request: ${r.reason}`;
  });

  await guard('the signature is an HMAC over the timestamp AND the body', async () => {
    const t = now();
    const header = s.sign(body, SECRET, t);
    const v1 = /v1=([0-9a-f]+)/.exec(header)?.[1];
    if (!v1) return `header has no v1=<hex>: ${header}`;
    const expected = crypto.createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
    if (v1 === expected) return true;
    const bodyOnly = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    return v1 === bodyOnly
      ? 'the signature covers the body but NOT the timestamp — so an attacker can change t and replay forever'
      : `v1 does not match HMAC-SHA256(secret, "<t>.<body>")`;
  });

  await guard('a missing header is refused', async () => {
    const r = await s.verify({ rawBody: body, header: undefined, secret: SECRET, toleranceSec: 300, seen: new Set() });
    return r.ok === false || 'accepted a request with no signature at all';
  });

  await guard('a malformed header is refused, not crashed on', async () => {
    for (const header of ['', 'garbage', 't=,v1=', 'v1=abc', 't=abc,v1=zz', '{}', 't=1,v1=' + 'f'.repeat(64)]) {
      const r = await s.verify({ rawBody: body, header, secret: SECRET, toleranceSec: 300, seen: new Set() });
      if (r.ok) return `accepted the header ${JSON.stringify(header)}`;
    }
    return true;
  });

  await guard('a signature made with a DIFFERENT secret is refused', async () => {
    const r = await s.verify({ rawBody: body, header: s.sign(body, OTHER, now()), secret: SECRET, toleranceSec: 300, seen: new Set() });
    return r.ok === false || 'accepted a signature from a different key';
  });

  await guard('a tampered body with a valid signature is refused', async () => {
    const t = now();
    const header = s.sign(body, SECRET, t);
    const tampered = body.replace('500', '50000');
    const r = await s.verify({ rawBody: tampered, header, secret: SECRET, toleranceSec: 300, seen: new Set() });
    return r.ok === false || 'the amount was changed from 500 to 50000 and it was accepted';
  });

  // The bug that breaks EVERY webhook integration at least once.
  await guard('the signature covers the RAW BYTES, not a re-serialised object', async () => {
    // The bytes on the wire, with the provider's key order and spacing.
    const wire = '{"amount":500,"id":"evt_1","type":"payment.succeeded"}';
    const header = s.sign(wire, SECRET, now());
    // What your body parser hands you if you sign JSON.stringify(req.body) instead: same data,
    // different bytes.
    const reserialised = JSON.stringify(JSON.parse(wire));
    const good = await s.verify({ rawBody: wire, header, secret: SECRET, toleranceSec: 300, seen: new Set() });
    if (!good.ok) return `the original bytes were rejected: ${good.reason}`;
    const spaced = wire.replace(/,/g, ', ');
    const bad = await s.verify({ rawBody: spaced, header, secret: SECRET, toleranceSec: 300, seen: new Set() });
    if (bad.ok) return 'whitespace-different bytes verified — you are not hashing what arrived';
    void reserialised;
    return true;
  });

  await guard('a timestamp outside the tolerance is refused', async () => {
    const old = now() - 3600;
    const r = await s.verify({ rawBody: body, header: s.sign(body, SECRET, old), secret: SECRET, toleranceSec: 300, seen: new Set() });
    return r.ok === false || 'accepted an hour-old request — a captured request is valid forever';
  });

  await guard('a timestamp from the FUTURE is refused too', async () => {
    const future = now() + 3600;
    const r = await s.verify({ rawBody: body, header: s.sign(body, SECRET, future), secret: SECRET, toleranceSec: 300, seen: new Set() });
    return r.ok === false || 'accepted a request timestamped an hour from now — clock skew is minutes, not hours';
  });

  await guard('a request within tolerance is still accepted (not too strict)', async () => {
    const recent = now() - 100;
    const r = await s.verify({ rawBody: body, header: s.sign(body, SECRET, recent), secret: SECRET, toleranceSec: 300, seen: new Set() });
    return r.ok === true || `a 100-second-old request was rejected with a 300s tolerance: ${r.reason}`;
  });

  // THE replay.
  await guard('the same signed request cannot be delivered twice', async () => {
    const seen = new Set();
    const header = s.sign(body, SECRET, now());
    const first = await s.verify({ rawBody: body, header, secret: SECRET, toleranceSec: 300, seen });
    const second = await s.verify({ rawBody: body, header, secret: SECRET, toleranceSec: 300, seen });
    if (!first.ok) return `the first delivery was rejected: ${first.reason}`;
    return second.ok === false
      ? true : 'replayed it — capture one "payment.succeeded" and you can spend it as often as you like';
  });

  await guard('...but a genuinely different event is not mistaken for a replay', async () => {
    const seen = new Set();
    const t = now();
    const a = JSON.stringify({ id: 'evt_A', type: 'payment.succeeded', amount: 100 });
    const b = JSON.stringify({ id: 'evt_B', type: 'payment.succeeded', amount: 100 });
    const r1 = await s.verify({ rawBody: a, header: s.sign(a, SECRET, t), secret: SECRET, toleranceSec: 300, seen });
    const r2 = await s.verify({ rawBody: b, header: s.sign(b, SECRET, t), secret: SECRET, toleranceSec: 300, seen });
    return (r1.ok && r2.ok) ? true : `${r1.ok} / ${r2.ok} — two different events at the same second must both be accepted`;
  });

  // Rotation: during a key change the provider signs with BOTH.
  await guard('several v1 signatures in one header — any valid one is enough (key rotation)', async () => {
    const t = now();
    const mine = /v1=([0-9a-f]+)/.exec(s.sign(body, SECRET, t))[1];
    const header = `t=${t},v1=${'0'.repeat(64)},v1=${mine}`;
    const r = await s.verify({ rawBody: body, header, secret: SECRET, toleranceSec: 300, seen: new Set() });
    return r.ok === true
      ? true : 'only the first signature was checked — you cannot rotate a webhook secret without downtime';
  });

  await guard('secureCompare is correct', async () => {
    if (!s.secureCompare('abc', 'abc')) return 'equal strings compared as different';
    if (s.secureCompare('abc', 'abd')) return 'different strings compared as equal';
    if (s.secureCompare('abc', 'abcd')) return 'different lengths compared as equal';
    return true;
  });

  // Timing, measured rather than assumed. Long inputs, because that is what makes a byte-at-a-time
  // leak visible on a laptop; at 64 hex characters the leak is identical in kind and merely
  // harder to see — which is why you fix it by construction rather than by benchmark.
  await guard('secureCompare is CONSTANT-TIME', async () => {
    const base = 'a'.repeat(4096);
    const earlyDiff = 'b' + base.slice(1);
    const lateDiff = base.slice(0, 4095) + 'b';
    const time = (other) => {
      const samples = [];
      for (let i = 0; i < 3000; i++) {
        const t0 = process.hrtime.bigint();
        s.secureCompare(base, other);
        samples.push(Number(process.hrtime.bigint() - t0));
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)];
    };
    time(earlyDiff); time(lateDiff);                   // warm up, so JIT is not the measurement
    const early = time(earlyDiff);
    const late = time(lateDiff);
    const ratio = late / Math.max(early, 1);
    return (ratio > 0.7 && ratio < 1.4)
      ? true
      : `differing at the LAST byte takes ${ratio.toFixed(1)}x as long as differing at the first ` +
        `(${early}ns vs ${late}ns) — that is the signature, leaked one byte at a time`;
  });

  await guard('verify() uses it — a signature differing only in its last byte is refused', async () => {
    const t = now();
    const real = /v1=([0-9a-f]+)/.exec(s.sign(body, SECRET, t))[1];
    const nearly = real.slice(0, 63) + (real[63] === 'a' ? 'b' : 'a');
    const r = await s.verify({ rawBody: body, header: `t=${t},v1=${nearly}`, secret: SECRET, toleranceSec: 300, seen: new Set() });
    return r.ok === false || 'accepted a signature that differs by one character';
  });

  await guard('verify() never throws, whatever it is handed', async () => {
    const nasty = [
      { rawBody: null, header: 't=1,v1=aa' },
      { rawBody: body, header: null },
      { rawBody: Buffer.from(body), header: s.sign(body, SECRET, now()) },
      { rawBody: body, header: 't=' + Number.MAX_SAFE_INTEGER + ',v1=aa' },
      { rawBody: '', header: s.sign('', SECRET, now()) },
    ];
    for (const args of nasty) {
      try { await s.verify({ secret: SECRET, toleranceSec: 300, seen: new Set(), ...args }); }
      catch (e) { return `threw on ${JSON.stringify(args.header)}: ${e.message}`.slice(0, 70); }
    }
    return true;
  });

  return out;
}
