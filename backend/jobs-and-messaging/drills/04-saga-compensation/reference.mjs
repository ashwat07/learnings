/**
 * A SAGA is what you use when a business transaction spans systems that cannot share a database
 * transaction — a payment provider, a warehouse, a courier. There is no rollback, so you write the
 * undo yourself.
 *
 * Two details the drill checks, and both are easy to get wrong:
 *
 *   REVERSE ORDER. Undo the most recent step first. Later steps may depend on earlier ones, so
 *   unwinding forwards can compensate against a world that no longer exists.
 *
 *   DO NOT COMPENSATE THE STEP THAT FAILED. It never completed, so there is nothing to undo —
 *   and calling compensate() on it is how you end up refunding a charge that never happened.
 *   (This is why `completed` is pushed AFTER run() returns.)
 *
 * What a production saga adds:
 *   · COMPENSATIONS MUST BE IDEMPOTENT AND RETRYABLE. A compensation that itself fails is the
 *     worst state in the system; you retry it forever and alert a human if it will not settle.
 *   · PERSIST THE SAGA STATE. If the process dies mid-unwind, something must resume it — which is
 *     exactly what Temporal and other workflow engines are for.
 *   · SOME THINGS CANNOT BE COMPENSATED. You cannot un-send an email. Order the steps so the
 *     irreversible ones happen LAST, once everything reversible has already succeeded.
 *   · ORCHESTRATION (one coordinator, as here) is easier to reason about and debug than
 *     CHOREOGRAPHY (services reacting to each other's events), which scales better and is much
 *     harder to see. Start with orchestration.
 */
export async function placeOrder(steps) {
  const completed = [];

  try {
    for (const step of steps) {
      await step.run();
      completed.push(step);          // only AFTER it succeeded
    }
  } catch (err) {
    for (const step of completed.reverse()) {
      try { await step.compensate(); }
      catch (compErr) {
        // A failed compensation is not recoverable here — surface it loudly. In production this
        // is retried with backoff and, failing that, paged.
        throw new Error(`compensation failed for ${step.name}: ${compErr.message} (original: ${err.message})`);
      }
    }
    throw err;                       // the caller must know the saga did not complete
  }
}
