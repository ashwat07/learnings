/**
 * Drills for API styles: GraphQL, DataLoader, cursor pagination, and the protobuf wire format.
 *
 *   node api-styles/drills/run.mjs           all
 *   node api-styles/drills/run.mjs 02        one
 *   node api-styles/drills/run.mjs 02 --solution
 *
 * No containers. The "database" is in memory and COUNTS ITS QUERIES, which is the only number
 * that matters for most of this.
 */
import { runDrills } from '../../lib/drill-runner.mjs';
await runDrills(import.meta.url);
