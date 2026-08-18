export const title = 'Kill the N+1';
export const task = `An endpoint returns 50 recent orders, each with its user and its line items.
It currently issues 101 queries. Rewrite it in solution.mjs to produce IDENTICAL output using at
most 3 queries.

Edit solution.mjs — it exports  async function load(sql) → the same array of orders.`;
export const passIf = 'identical output to the reference, in 3 queries or fewer';
export const query = `SELECT 1`;
export const behavioural = true;

export async function setup(sql) {
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_d10_items ON order_items (order_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_d10_created ON orders (created_at DESC)`);
}
export async function teardown(sql) {
  await sql.unsafe('DROP INDEX IF EXISTS idx_d10_items');
  await sql.unsafe('DROP INDEX IF EXISTS idx_d10_created');
}

/** The shape every answer must produce, built the slow-but-obviously-correct way. */
async function reference(sql) {
  const orders = await sql`SELECT id, user_id, total_cents FROM orders ORDER BY created_at DESC, id DESC LIMIT 50`;
  const out = [];
  for (const o of orders) {
    const [u] = await sql`SELECT name FROM users WHERE id = ${o.user_id}`;
    const items = await sql`SELECT product_id, quantity FROM order_items WHERE order_id = ${o.id} ORDER BY product_id`;
    out.push({ id: String(o.id), name: u.name, items: items.map((i) => `${i.product_id}x${i.quantity}`).join(',') });
  }
  return out;
}

export async function custom(sql, _ctx) {
  const mod = await import(`./solution.mjs?t=${Date.now()}`).catch(() => null);
  if (!mod?.load) return [{ check: 'solution.mjs exports load()', actual: 'not found', pass: false }];

  // Count queries by wrapping the tagged-template handle the candidate is given.
  let queries = 0;
  const counting = new Proxy(sql, {
    apply(target, thisArg, args) { queries++; return Reflect.apply(target, thisArg, args); },
    get(target, prop) {
      const v = Reflect.get(target, prop);
      if (prop === 'unsafe') return (...a) => { queries++; return v.apply(target, a); };
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });

  let yours;
  try { yours = await mod.load(counting); }
  catch (e) { return [{ check: 'load() ran', actual: e.message.split('\n')[0].slice(0, 60), pass: false }]; }

  const expected = await reference(sql);
  const norm = (rows) => JSON.stringify((rows ?? []).map((r) => ({
    id: String(r.id), name: r.name, items: r.items,
  })));
  const same = norm(yours) === norm(expected);

  return [
    { check: 'returns 50 orders', actual: yours?.length ?? 0, pass: yours?.length === 50 },
    { check: 'output identical to the reference', actual: same ? 'identical' : 'differs', pass: same },
    { check: 'at most 3 queries', actual: queries, pass: queries > 0 && queries <= 3 },
  ];
}
