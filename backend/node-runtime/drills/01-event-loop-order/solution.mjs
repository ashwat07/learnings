/**
 * Drill 01 — your prediction.
 *
 * Read program.mjs. Fill this array in FROM REASONING. Running it first and copying the answer
 * teaches you nothing; the point of the drill is to find out whether your mental model of the
 * loop is correct, and that only works if you commit to an answer before you look.
 *
 * The eight labels, in alphabetical order (which is NOT the answer):
 *
 *   'A sync'
 *   'B nextTick'
 *   'C promise'
 *   'D promise queued by the nextTick'
 *   'E immediate'
 *   'F nextTick inside immediate'
 *   'G promise inside immediate'
 *   'H timeout 0'
 *
 * Four questions you have to answer to get it right:
 *   1. Does process.nextTick run before or after a resolved promise's .then?
 *   2. If a nextTick callback queues a promise, when does that promise run?
 *   3. Inside an I/O callback, does setImmediate or setTimeout(fn, 0) fire first — and why is the
 *      answer different at the top level of a module?
 *   4. When a check-phase (setImmediate) callback queues a nextTick and a promise, do they wait
 *      for the next loop iteration?
 */

export const ORDER = [
  // your answer here, one label per line
];
