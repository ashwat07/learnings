/**
 * export function tokensMatch(candidate, secret) -> boolean
 *
 * The loop below returns EARLY on the first mismatched character, so it takes measurably longer
 * the more of the prefix is correct. That is a side channel, and it is enough to extract a token.
 *
 * Node has the right primitive: crypto.timingSafeEqual(bufA, bufB).
 * It THROWS if the buffers are different lengths — think about what that means for your check,
 * and about what comparing lengths first leaks.
 */
export function tokensMatch(candidate, secret) {
  if (candidate.length !== secret.length) return false;
  for (let i = 0; i < secret.length; i++) {
    if (candidate[i] !== secret[i]) return false;      // <- the leak
  }
  return true;
}
