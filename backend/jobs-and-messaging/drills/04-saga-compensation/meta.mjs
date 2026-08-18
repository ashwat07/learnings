import { sql } from '../../../lib/db.mjs';

export const title = 'A saga, and what happens when step 3 fails';
export const task = `Placing an order touches three systems that DO NOT SHARE A TRANSACTION:
reserve inventory, charge the card, then book a courier slot.

The courier service fails 100% of the time in this drill. Without compensation you have taken the
customer's money and reserved stock for an order that will never ship.

Write placeOrder(steps) so that a failure at any point leaves the world as it was.`;
export const passIf = 'inventory and payment are both rolled back, compensation runs in REVERSE order, and it is safe to retry';

export async function check(s) {
  if (typeof s.placeOrder !== 'function') return [{ check: 'exports placeOrder(steps)', actual: 'missing', pass: false }];

  const world = { inventory: 100, charged: 0, courier: 0 };
  const log = [];

  const makeSteps = ({ courierFails = true } = {}) => ([
    {
      name: 'reserve-inventory',
      run: async () => { world.inventory -= 5; log.push('do:inventory'); return { reserved: 5 }; },
      compensate: async () => { world.inventory += 5; log.push('undo:inventory'); },
    },
    {
      name: 'charge-card',
      run: async () => { world.charged += 4999; log.push('do:charge'); return { chargeId: 'ch_1' }; },
      compensate: async () => { world.charged -= 4999; log.push('undo:charge'); },
    },
    {
      name: 'book-courier',
      run: async () => {
        log.push('do:courier');
        if (courierFails) throw new Error('courier service unavailable');
        world.courier += 1;
        return { slot: 'A' };
      },
      compensate: async () => { world.courier -= 1; log.push('undo:courier'); },
    },
  ]);

  let threw = null;
  try { await s.placeOrder(makeSteps()); } catch (e) { threw = e.message; }

  // Snapshot the world AFTER the failed saga, before anything is reset.
  const afterFailure = { ...world };

  const undos = log.filter((l) => l.startsWith('undo:'));
  // Compensation must unwind in REVERSE: charge before inventory.
  const reverseOrder = undos.join(',') === 'undo:charge,undo:inventory';
  // The failed step never completed, so compensating it would be wrong.
  const noPhantomUndo = !undos.includes('undo:courier');

  // And the happy path must still work, on a clean world.
  Object.assign(world, { inventory: 100, charged: 0, courier: 0 });
  log.length = 0;
  let happy = null;
  try { await s.placeOrder(makeSteps({ courierFails: false })); } catch (e) { happy = e.message; }

  return [
    { check: 'the failure is surfaced to the caller', actual: threw ?? 'swallowed', pass: Boolean(threw) },
    { check: 'inventory restored to 100', actual: afterFailure.inventory, pass: afterFailure.inventory === 100 },
    { check: 'the card was refunded (charged back to 0)', actual: afterFailure.charged, pass: afterFailure.charged === 0 },
    { check: 'compensation ran in REVERSE order', actual: undos.length ? undos.join(' → ') : 'nothing compensated', pass: reverseOrder },
    { check: 'the FAILED step was not compensated', actual: noPhantomUndo ? 'correct' : 'undid a step that never ran', pass: noPhantomUndo },
    { check: 'the happy path completes all three steps', actual: happy ?? `courier=${world.courier}, charged=${world.charged}`, pass: !happy && world.courier === 1 && world.charged === 4999 },
  ];
}
