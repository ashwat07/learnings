/**
 * Drills where the bug is EMERGENT — it comes from two correct things interacting.
 *
 *   node distributed/drills/run.mjs           all
 *   node distributed/drills/run.mjs 01        one
 *   node distributed/drills/run.mjs 01 --solution
 *
 * Every other course in this repo teaches one primitive in a controlled world: a timeout, a
 * retry, an idempotency key, a saga. Each of those drills is passable with the primitive alone.
 *
 * These are not. Here the primitives are already correct and the system is still broken, because
 * a timeout that does not shrink across a hop plus a retry that is not budgeted is a load
 * amplifier — and neither component is wrong on its own.
 *
 * No containers. The services are in-process and the fault injection is SEEDED, so a failure is
 * reproducible.
 */
import { runDrills } from '../../lib/drill-runner.mjs';
await runDrills(import.meta.url);
