/**
 * Drill 06 — cancellation.
 *
 * The starting point is what "I added AbortSignal support" usually means in practice: the signal
 * is accepted, stored, and never actually connected to anything. The function returns early when
 * the signal fires, the caller sees a rejection, everybody is happy — and the request is still
 * running on the server, still holding the connection, still going to write to the database.
 *
 * Racing a promise against an abort is not cancellation. It is ignoring the result.
 *
 *   download({ signal, pool, io, ms, value }) -> Promise<value>
 *
 *   pool.acquire() -> Promise<token>     4 slots. Forget one release and the 5th caller waits
 *   pool.release(token)                  forever.
 *   io(ms, value) -> { promise, cancel(reason) }
 *
 * An AbortError, by convention and by what fetch() actually throws:
 *   const err = new Error('The operation was aborted'); err.name = 'AbortError';
 * Set `cause` to signal.reason so the caller can tell a timeout from a user cancelling.
 */

export async function download({ signal, pool, io, ms, value }) {
  const token = await pool.acquire();
  const op = io(ms, value);

  const aborted = new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });

  const result = await Promise.race([op.promise, aborted]);
  pool.release(token);
  return result;
}
