/**
 * Drills for real-time transport, fan-out and webhooks.
 *
 *   node realtime/drills/run.mjs           all
 *   node realtime/drills/run.mjs 03        one
 *   node realtime/drills/run.mjs 03 --solution
 *
 * No containers. The cross-instance bus in world.mjs behaves like Redis pub/sub — fire and
 * forget, no ordering guarantees between instances, no delivery to anyone not currently
 * subscribed — so the lessons transfer, and the tests are deterministic.
 */
import { runDrills } from '../../lib/drill-runner.mjs';
await runDrills(import.meta.url);
