import { a } from './cycle-a.mjs';
// At this point cycle-a.mjs has NOT finished evaluating, so `a` is in the temporal dead zone.
export const seenAtEval = (() => { try { return a; } catch (e) { return `${e.constructor.name}: ${e.message}`; } })();
export const b = 'B';
