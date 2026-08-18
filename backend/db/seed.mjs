/**
 * Seed the lab database.
 *
 *   node db/seed.mjs            ~200k orders  (the default; fast enough to re-run)
 *   node db/seed.mjs --big      ~2M orders    (slower, and index effects get much more dramatic)
 *
 * Deterministic: the same seed produces the same data, so your numbers are comparable with the
 * ones in the lab READMEs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, rule, good, note } from '../lib/db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIG = process.argv.includes('--big');
const N_USERS = BIG ? 200_000 : 50_000;
const N_PRODUCTS = BIG ? 20_000 : 5_000;
const N_ORDERS = BIG ? 2_000_000 : 200_000;
const N_EVENTS = BIG ? 4_000_000 : 400_000;

// A tiny deterministic PRNG (mulberry32), so runs are reproducible.
let state = 0x9e3779b9;
const rnd = () => {
  state |= 0; state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));

const COUNTRIES = ['IN', 'US', 'GB', 'DE', 'FR', 'JP', 'BR', 'AU', 'CA', 'SG'];
const CATEGORIES = ['audio', 'wearables', 'laptops', 'phones', 'home', 'gaming', 'cameras'];
const WORDS = ['nimbus', 'atlas', 'orbit', 'vector', 'lumen', 'quartz', 'ember', 'delta', 'zenith', 'aurora',
  'compact', 'pro', 'max', 'lite', 'wireless', 'studio', 'travel', 'edition', 'series', 'mini'];
const KINDS = ['view', 'add_to_cart', 'checkout_start', 'purchase', 'search', 'login', 'refund_request'];
const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(' ');

// Anchored to TODAY, not to a fixed date, so that "the last 7 days" means something in every lab.
// The distribution shapes are still deterministic; only the absolute dates move.
const DAY = 86400000;
const NOW = Math.floor(Date.now() / DAY) * DAY;

async function main() {
  rule(`seeding ${BIG ? 'BIG' : 'standard'} dataset`);
  note(`${N_USERS.toLocaleString()} users, ${N_PRODUCTS.toLocaleString()} products, ` +
       `${N_ORDERS.toLocaleString()} orders, ${N_EVENTS.toLocaleString()} events`);

  await sql.unsafe(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  good('schema created');

  // COPY, not INSERT. This is itself a lesson: bulk-loading via INSERT is 10–50x slower, and
  // "the import takes four hours" is nearly always someone looping over single-row INSERTs.
  await copy('users', ['email', 'name', 'country', 'prefs', 'created_at'], function* () {
    for (let i = 1; i <= N_USERS; i++) {
      const created = new Date(NOW - int(0, 900) * DAY);
      yield [
        `user${i}@example.com`,
        `${pick(WORDS)}-${i}`,
        pick(COUNTRIES),
        JSON.stringify({
          theme: pick(['dark', 'light']),
          newsletter: rnd() < 0.3,
          // A nested key, so the JSONB path/GIN lab has something non-trivial.
          notify: { email: rnd() < 0.7, push: rnd() < 0.2 },
          tags: Array.from({ length: int(0, 3) }, () => pick(CATEGORIES)),
        }),
        created.toISOString(),
      ];
    }
  });

  await copy('products', ['sku', 'title', 'description', 'category', 'price_cents', 'active', 'created_at'], function* () {
    for (let i = 1; i <= N_PRODUCTS; i++) {
      yield [
        `SKU-${String(i).padStart(7, '0')}`,
        `${pick(WORDS)} ${pick(WORDS)} ${i}`,
        words(int(12, 40)),
        pick(CATEGORIES),
        int(500, 250000),
        rnd() < 0.9,
        new Date(NOW - int(0, 900) * DAY).toISOString(),
      ];
    }
  });

  // Orders are skewed on purpose:
  //  · status is heavily 'delivered', so a partial index on the rare statuses is a big win
  //  · created_at is recency-weighted, so "last 7 days" selects a small slice of a big table
  //  · a small number of users have very many orders, so the planner's row estimates get
  //    interesting and correlated statistics matter
  await copy('orders', ['user_id', 'status', 'total_cents', 'created_at', 'shipped_at'], function* () {
    for (let i = 1; i <= N_ORDERS; i++) {
      const whale = rnd() < 0.02;
      const userId = whale ? int(1, Math.max(1, Math.floor(N_USERS * 0.001))) : int(1, N_USERS);
      const r = rnd();
      const status = r < 0.70 ? 'delivered' : r < 0.85 ? 'shipped' : r < 0.93 ? 'paid'
        : r < 0.985 ? 'pending' : 'cancelled';
      const ageDays = Math.floor((rnd() ** 3) * 720);        // cubic → most orders are recent
      const created = new Date(NOW - ageDays * DAY - int(0, 86399) * 1000);
      const shipped = status === 'shipped' || status === 'delivered'
        ? new Date(created.getTime() + int(1, 5) * DAY).toISOString() : null;
      yield [userId, status, int(500, 400000), created.toISOString(), shipped];
    }
  });

  await copy('order_items', ['order_id', 'product_id', 'quantity', 'price_cents'], function* () {
    for (let orderId = 1; orderId <= N_ORDERS; orderId++) {
      const seen = new Set();
      for (let k = 0, n = int(1, 4); k < n; k++) {
        const productId = int(1, N_PRODUCTS);
        if (seen.has(productId)) continue;                    // the PK is (order_id, product_id)
        seen.add(productId);
        yield [orderId, productId, int(1, 3), int(500, 250000)];
      }
    }
  });

  await copy('events', ['user_id', 'kind', 'payload', 'occurred_at'], function* () {
    for (let i = 1; i <= N_EVENTS; i++) {
      const ageDays = Math.floor((rnd() ** 2) * 400);
      yield [
        int(1, N_USERS),
        pick(KINDS),
        JSON.stringify({ session: `s${int(1, 999999)}`, source: pick(['web', 'ios', 'android']), value: int(0, 5000) }),
        new Date(NOW - ageDays * DAY - int(0, 86399) * 1000).toISOString(),
      ];
    }
  });

  rule('analyzing');
  // Without ANALYZE the planner has no statistics and every lab measures the wrong thing.
  await sql.unsafe('ANALYZE');
  good('statistics collected');

  const sizes = await sql`
    SELECT relname AS table,
           to_char(n_live_tup, 'FM999,999,999') AS rows,
           pg_size_pretty(pg_total_relation_size(relid)) AS size
    FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC`;
  rule('result');
  console.table(sizes.map((r) => ({ table: r.table, rows: r.rows, size: r.size })));
  note('indexes: only the primary keys and unique constraints. Every other index is a lab.');
  await sql.end();
}

/**
 * Stream rows into COPY FROM STDIN. The generator means we never materialise the whole dataset in
 * memory — 2M orders as an array of arrays would be gigabytes.
 */
async function copy(tableName, columns, rows) {
  const t0 = performance.now();
  const stream = await sql.unsafe(`COPY ${tableName} (${columns.join(', ')}) FROM STDIN WITH (FORMAT text)`).writable();
  let n = 0;
  for (const row of rows()) {
    const line = row.map(encode).join('\t') + '\n';
    n++;
    if (!stream.write(line)) await new Promise((r) => stream.once('drain', r));
  }
  await new Promise((resolve, reject) => { stream.end(); stream.on('finish', resolve); stream.on('error', reject); });
  good(`${tableName}: ${n.toLocaleString()} rows in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

// COPY text format: \N is NULL, and tab/newline/backslash must be escaped.
const encode = (v) => (v === null || v === undefined ? '\\N'
  : String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));

main().catch((e) => { console.error(e); process.exit(1); });
