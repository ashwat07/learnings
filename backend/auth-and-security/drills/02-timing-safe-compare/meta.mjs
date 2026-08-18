export const title = 'The timing oracle';
export const task = `Compare a user-supplied API token against the real one.

The runner measures how long your comparison takes for a token that shares 0 characters with the
secret versus one that shares 31 of 32. If those times differ, an attacker can recover the token
one character at a time — without ever guessing it whole.`;
export const passIf = 'the comparison time does not vary with how much of the prefix matches';

export async function check(s) {
  if (typeof s.tokensMatch !== 'function') return [{ check: 'exports tokensMatch(a, b)', actual: 'missing', pass: false }];

  const secret = 'a'.repeat(32);
  const noMatch = 'b'.repeat(32);
  const almost = 'a'.repeat(31) + 'b';

  const timeIt = (candidate) => {
    const runs = 4000;
    const samples = [];
    for (let round = 0; round < 5; round++) {
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < runs; i++) s.tokensMatch(candidate, secret);
      samples.push(Number(process.hrtime.bigint() - t0) / runs);
    }
    samples.sort((x, y) => x - y);
    return samples[2];                                  // median of 5, in nanoseconds
  };

  timeIt(noMatch);                                      // warm up the JIT
  const tNo = timeIt(noMatch);
  const tAlmost = timeIt(almost);
  const ratio = Math.max(tNo, tAlmost) / Math.max(Math.min(tNo, tAlmost), 0.001);

  return [
    { check: 'correct token matches', actual: String(s.tokensMatch(secret, secret)), pass: s.tokensMatch(secret, secret) === true },
    { check: 'wrong token does not match', actual: String(s.tokensMatch(noMatch, secret)), pass: s.tokensMatch(noMatch, secret) === false },
    { check: 'a near-miss does not match', actual: String(s.tokensMatch(almost, secret)), pass: s.tokensMatch(almost, secret) === false },
    { check: 'wrong length does not match', actual: String(s.tokensMatch('a', secret)), pass: s.tokensMatch('a', secret) === false },
    { check: 'timing does not leak the prefix (< 1.6x)', actual: `0-char ${tNo.toFixed(0)}ns vs 31-char ${tAlmost.toFixed(0)}ns = ${ratio.toFixed(2)}x`, pass: ratio < 1.6 },
  ];
}
