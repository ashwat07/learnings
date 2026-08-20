/**
 * Drills for the auth flow as a SYSTEM.
 *
 *   node auth-flow/drills/run.mjs           all
 *   node auth-flow/drills/run.mjs 01        one
 *   node auth-flow/drills/run.mjs 01 --solution
 *
 * auth-and-security/ has the primitives: password storage, timing-safe comparison, IDOR, SSRF,
 * refresh rotation. Each of those is a correct component and each of those drills is passable on
 * its own.
 *
 * These are the seams. Every failure here comes from two correct pieces meeting: a stateless
 * token and a logout button, a rotation scheme and two tabs refreshing at once, a password change
 * and a session on another device.
 */
import { runDrills } from '../../lib/drill-runner.mjs';
await runDrills(import.meta.url);
