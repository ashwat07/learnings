/**
 * Drill 08 — bounded concurrency.
 *
 *   const limit = createLimiter(5);
 *   const results = await Promise.all(urls.map(url => limit(() => fetch(url))));
 *
 * The starting point below is what "I limited the concurrency" usually turns out to mean. Chaining
 * every task onto the previous one does bound the concurrency — to one. It is safe, it is in
 * order, it never overwhelms anything, and it is ten times slower than it needs to be. The
 * parameter `n` is not even read.
 *
 * This is worth recognising because it is invisible in a test with three items and obvious in
 * production at three thousand: you have written a queue with no pool.
 */

export function createLimiter(n) {
  let last = Promise.resolve();
  function limit(fn) {
    const result = last.then(fn);
    last = result.catch(() => {});     // keep the chain alive through failures
    return result;
  }
  return limit;
}
