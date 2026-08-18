export const title = 'Store a password';
export const task = `Implement hash(password) and verify(password, stored).

The runner plays the attacker: it checks that two users with the SAME password get DIFFERENT
stored values, that hashing is deliberately SLOW, and that a fast digest (sha256, md5) is rejected.`;
export const passIf = 'salted, slow (>=40ms), verifies correctly, and rejects the wrong password';

export async function check(s) {
  if (typeof s.hash !== 'function' || typeof s.verify !== 'function') {
    return [{ check: 'exports hash() and verify()', actual: 'missing', pass: false }];
  }
  const pw = 'correct horse battery staple';

  const t0 = performance.now();
  const a = await s.hash(pw);
  const hashMs = performance.now() - t0;
  const b = await s.hash(pw);                       // same password, second user

  const ok = await s.verify(pw, a);
  const wrong = await s.verify('Correct horse battery staple', a);
  const empty = await s.verify('', a);

  const str = String(a);
  // A bare 32-byte hex digest is what sha256 produces. A real KDF output carries parameters.
  const looksLikeRawDigest = /^[a-f0-9]{32,64}$/i.test(str.trim());

  return [
    { check: 'the same password hashes differently (per-user salt)', actual: a === b ? 'IDENTICAL — no salt' : 'different', pass: a !== b },
    { check: 'verify accepts the right password', actual: String(ok), pass: ok === true },
    { check: 'verify rejects a near-miss', actual: String(wrong), pass: wrong === false },
    { check: 'verify rejects an empty password', actual: String(empty), pass: empty === false },
    { check: 'hashing is slow on purpose (>= 40ms)', actual: `${hashMs.toFixed(0)}ms`, pass: hashMs >= 40 },
    { check: 'not a bare fast digest', actual: looksLikeRawDigest ? 'looks like a raw sha256/md5' : 'ok', pass: !looksLikeRawDigest },
  ];
}
