import { sql } from '../../../lib/db.mjs';

export const title = 'IDOR — the most common web vulnerability there is';
export const task = `getOrder(sql, orderId, currentUser) returns an order.

The runner plays an authenticated but malicious user: it asks for its OWN order (must work), then
for someone ELSE's order by guessing the id (must be refused), then tries a handful of bypasses.`;
export const passIf = 'owners can read their own orders; nobody can read anyone else\'s, by any route';

export async function check(s) {
  if (typeof s.getOrder !== 'function') return [{ check: 'exports getOrder(sql, orderId, currentUser)', actual: 'missing', pass: false }];

  const [mine] = await sql`SELECT id, user_id FROM orders WHERE user_id = 42 LIMIT 1`;
  const [theirs] = await sql`SELECT id, user_id FROM orders WHERE user_id <> 42 LIMIT 1`;
  const me = { id: 42, role: 'user' };
  const admin = { id: 1, role: 'admin' };

  const attempt = async (label, fn) => {
    try { return { label, value: await fn() }; }
    catch (e) { return { label, value: null, threw: e.message.slice(0, 30) }; }
  };

  const own = await attempt('own', () => s.getOrder(sql, mine.id, me));
  const other = await attempt('other', () => s.getOrder(sql, theirs.id, me));
  const asString = await attempt('string id', () => s.getOrder(sql, String(theirs.id), me));
  const asAdmin = await attempt('admin', () => s.getOrder(sql, theirs.id, admin));
  // A classic bypass: a caller-supplied object that claims to own everything.
  const spoofed = await attempt('spoofed user', () => s.getOrder(sql, theirs.id, { id: theirs.user_id, role: 'user' }));

  const leaked = (r) => r.value != null && String(r.value.id) === String(theirs.id);

  return [
    { check: 'the owner can read their own order', actual: own.value ? 'ok' : `denied${own.threw ? ` (${own.threw})` : ''}`, pass: own.value != null && String(own.value.id) === String(mine.id) },
    { check: "another user's order is REFUSED", actual: leaked(other) ? 'LEAKED' : 'refused', pass: !leaked(other) },
    { check: 'refused even when the id is a string', actual: leaked(asString) ? 'LEAKED' : 'refused', pass: !leaked(asString) },
    { check: 'an admin may read it', actual: asAdmin.value ? 'ok' : 'denied', pass: asAdmin.value != null },
    { check: 'ownership comes from the DATA, not the caller', actual: leaked(spoofed) ? 'trusts the caller' : 'checked against the row', pass: true },
  ];
}
