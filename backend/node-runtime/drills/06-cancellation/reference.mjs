/** Drill 06 — reference. */

const abortError = (reason) =>
  Object.assign(new Error('The operation was aborted'), { name: 'AbortError', cause: reason });

export async function download({ signal, pool, io, ms, value }) {
  // 1. CHECK BEFORE YOU START. A signal that is already aborted must not cause any work — no
  //    connection, no request, nothing. Every wrapper that only calls addEventListener misses
  //    this, and it matters most in exactly the case you care about: a retry loop whose deadline
  //    expired during the previous attempt.
  if (signal.aborted) throw abortError(signal.reason);

  const token = await pool.acquire();
  const op = io(ms, value);

  let onAbort;
  try {
    const aborted = new Promise((_, reject) => {
      onAbort = () => {
        // 2. CANCEL THE WORK, do not merely stop waiting for it. This is the line that makes it
        //    cancellation rather than abandonment. Without it the socket stays open, the server
        //    finishes the query, and your "timeout" saved nobody any load at all.
        op.cancel(abortError(signal.reason));
        reject(abortError(signal.reason));
      };
      // `once: true` is not enough on its own — it removes the listener only when the event
      // FIRES, and the overwhelming majority of operations complete without ever aborting.
      signal.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([op.promise, aborted]);
  } finally {
    // 3. UNSUBSCRIBE, ALWAYS. The signal outlives the operation. Five thousand operations on one
    //    request-scoped signal means five thousand retained closures, each holding a pool token,
    //    a response buffer and whatever else the closure captured. It is a textbook leak and it
    //    does not show up until the signal is long-lived, which is to say: in production.
    signal.removeEventListener('abort', onAbort);
    // 4. RELEASE ON EVERY PATH. finally, not "after the await". A pool leak is a deadlock with a
    //    delay fuse: it looks fine until the Nth request, and then everything hangs at once.
    pool.release(token);
  }
}

/*
THE FIVE RULES, IN THE ORDER THEY GET BROKEN

  1. check signal.aborted first
  2. propagate cancellation DOWNWARD (op.cancel), do not just stop awaiting
  3. remove the listener in a finally
  4. release resources in a finally
  5. reject with name === 'AbortError' and cause === signal.reason

RULE 2 IS THE ONE THAT COSTS MONEY

`Promise.race([work, timeout])` is the pattern everyone knows, and on its own it is a LIE about
cancellation: the losing promise keeps running to completion. If `work` was a database query, the
query still runs. If it was an HTTP request, the connection is still held. Under load, a timeout
that does not cancel makes things strictly worse — you now have the original slow work AND the
retry, competing for the same pool. That is how a slow dependency turns into an outage instead of
a slow endpoint.

WHAT NODE GIVES YOU FOR FREE

  AbortSignal.timeout(ms)          a signal that aborts itself; reason is a TimeoutError
  AbortSignal.any([a, b])          composed cancellation — request signal + deadline signal
  events.on/once(e, ev, {signal})  auto-removes the listener on abort
  fetch(url, { signal })           actually closes the socket
  fs / streams / readline          most accept { signal }
  setTimeout(fn, ms, { signal })   from node:timers/promises

Note the trap in AbortSignal.any: the composite signal subscribes to every source, so a composite
built per-operation from a long-lived parent has exactly the leak this drill is about, unless you
drop your reference to it. Node ≥20 makes those subscriptions weak, which helps, but the habit of
unsubscribing explicitly is what you should keep.

THE HTTP END OF THIS
  server: req.signal aborts when the client disconnects — plumb it into your database call and
          stop doing work nobody will read
  client: one AbortController per request, aborted in a finally, plus AbortSignal.timeout for the
          deadline, combined with AbortSignal.any
*/
