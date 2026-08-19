import { makeDb, DATA } from '../../world.mjs';
import { makeExecutableSchema, graphql } from '../../graphql-lib.mjs';

export const title = 'DataLoader — the N+1 that GraphQL makes structural';
export const task = `A resolver is called once per PARENT OBJECT. Ask for 40 users and their
teams, and the team resolver runs 40 times — 41 queries for data that is 2 queries wide. In REST
you write the join once and see it; in GraphQL the fan-out is invisible until you count.

DataLoader fixes it with one idea: collect every key requested during this tick of the event
loop, issue ONE batched query, and hand each caller its own result back.

Implement createLoader(batchFn), then createLoaders(db) and resolvers that use them.

  createLoader(batchFn, { maxBatchSize })  ->  { load(key), loadMany(keys) }
  batchFn(uniqueKeys) -> Promise<values in the SAME ORDER as uniqueKeys>

The hard part is not the batching. It is that the database returns rows in whatever order it
likes, and if you hand them back positionally you will serve one user's data to another.`;
export const passIf = '41 queries become 3, keys line up with values, misses are null, and a failing batch does not poison the loader';

const TYPEDEFS = `
  type Team { id: ID!  name: String! }
  type Comment { id: ID!  text: String!  author: User }
  type Post { id: ID!  title: String!  author: User  comments: [Comment!]! }
  type User { id: ID!  name: String!  team: Team  posts: [Post!]! }
  type Query { users(limit: Int): [User!]!  posts(limit: Int): [Post!]! }
`;

const run = (s, db, query) => graphql({
  schema: makeExecutableSchema(TYPEDEFS, s.resolvers),
  source: query,
  contextValue: { db, loaders: s.createLoaders(db) },
});

export async function check(s) {
  if (typeof s.createLoader !== 'function' || typeof s.createLoaders !== 'function' || !s.resolvers) {
    return [{ check: 'exports createLoader, createLoaders and resolvers', actual: 'missing', pass: false }];
  }
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 64), pass: false }); }
  };

  // ---- the loader itself ----

  await guard('one tick of load() calls makes ONE batch call', async () => {
    let calls = 0, seen = null;
    const loader = s.createLoader(async (keys) => { calls++; seen = keys; return keys.map((k) => `v${k}`); });
    const got = await Promise.all([loader.load(1), loader.load(2), loader.load(3)]);
    return (calls === 1 && got.join(',') === 'v1,v2,v3') || `${calls} calls, keys ${JSON.stringify(seen)}, got ${got}`;
  });

  await guard('duplicate keys in one tick are deduped', async () => {
    let seen = null;
    const loader = s.createLoader(async (keys) => { seen = keys; return keys.map((k) => `v${k}`); });
    const got = await Promise.all([loader.load(7), loader.load(7), loader.load(8), loader.load(7)]);
    return (seen.length === 2 && got.join(',') === 'v7,v7,v8,v7') || `batch keys ${JSON.stringify(seen)}, got ${got}`;
  });

  await guard('a key loaded twice is only fetched once (per-loader cache)', async () => {
    let calls = 0;
    const loader = s.createLoader(async (keys) => { calls++; return keys.map((k) => `v${k}`); });
    await loader.load(1);
    await loader.load(1);
    await loader.load(1);
    return calls === 1 || `${calls} batch calls for the same key`;
  });

  await guard('two loaders do not share a cache', async () => {
    const mk = () => { let n = 0; return s.createLoader(async (keys) => { n++; return keys.map(() => n); }); };
    const a = mk(), b = mk();
    const [x, y] = [await a.load(1), await b.load(1)];
    return (x === 1 && y === 1) || `${x} / ${y} — a module-level cache leaks between requests`;
  });

  // THE one. The batch function must map values back BY KEY, not by position.
  await guard('values line up with keys even when the batch returns them shuffled', async () => {
    const loader = s.createLoader(async (keys) => {
      // A database returning rows in whatever order it likes — which is what they do.
      const rows = keys.map((k) => ({ id: k, name: `name-${k}` })).reverse();
      return keys.map((k) => rows.find((r) => r.id === k) ?? null);
    });
    const got = await Promise.all([loader.load(1), loader.load(2), loader.load(3)]);
    return got.map((g) => g?.name).join(',') === 'name-1,name-2,name-3' || `got ${JSON.stringify(got)}`;
  });

  await guard('a key with no row resolves to null, and does not shift the others', async () => {
    const loader = s.createLoader(async (keys) => keys.map((k) => (k === 2 ? null : `v${k}`)));
    const got = await Promise.all([loader.load(1), loader.load(2), loader.load(3)]);
    return JSON.stringify(got) === '["v1",null,"v3"]' || `got ${JSON.stringify(got)}`;
  });

  await guard('a per-key Error rejects only that key', async () => {
    const loader = s.createLoader(async (keys) => keys.map((k) => (k === 2 ? new Error('no access') : `v${k}`)));
    const [a, b, c] = await Promise.allSettled([loader.load(1), loader.load(2), loader.load(3)]);
    return (a.status === 'fulfilled' && b.status === 'rejected' && c.status === 'fulfilled')
      ? true : `${a.status}/${b.status}/${c.status}`;
  });

  await guard('a batch that throws rejects every key in it, and the loader still works after', async () => {
    let fail = true;
    const loader = s.createLoader(async (keys) => {
      if (fail) throw new Error('database down');
      return keys.map((k) => `v${k}`);
    });
    const settled = await Promise.allSettled([loader.load(1), loader.load(2)]);
    if (!settled.every((r) => r.status === 'rejected')) return `${settled.map((r) => r.status)}`;
    fail = false;
    const after = await loader.load(3).then((v) => v, (e) => `still broken: ${e.message}`);
    return after === 'v3' || String(after);
  });

  await guard('loadMany works and is one batch', async () => {
    let calls = 0;
    const loader = s.createLoader(async (keys) => { calls++; return keys.map((k) => `v${k}`); });
    const got = await loader.loadMany([1, 2, 3, 1]);
    return (calls === 1 && got.join(',') === 'v1,v2,v3,v1') || `${calls} calls, got ${got}`;
  });

  await guard('maxBatchSize splits a large batch', async () => {
    const sizes = [];
    const loader = s.createLoader(async (keys) => { sizes.push(keys.length); return keys.map((k) => k); },
      { maxBatchSize: 10 });
    await Promise.all(Array.from({ length: 25 }, (_, i) => loader.load(i)));
    return (sizes.length === 3 && Math.max(...sizes) <= 10) || `batch sizes ${JSON.stringify(sizes)}`;
  });

  await guard('it batches on the microtask queue, not a timer', async () => {
    const loader = s.createLoader(async (keys) => keys.map((k) => k));
    const t0 = performance.now();
    await Promise.all([loader.load(1), loader.load(2)]);
    const ms = performance.now() - t0;
    return ms < 3 || `${ms.toFixed(1)}ms — a setTimeout adds a millisecond to EVERY field`;
  });

  // ---- and now the actual point ----

  await guard('40 users + team + posts: 3 queries, not 81', async () => {
    const db = makeDb();
    const r = await run(s, db, `{ users(limit: 40) { name team { name } posts { id } } }`);
    if (r.errors) return `errors: ${r.errors[0].message}`.slice(0, 70);
    if (r.data.users.length !== 40) return `${r.data.users.length} users`;
    if (r.data.users[0].team?.name !== 'team-1') return `team resolved to ${JSON.stringify(r.data.users[0].team)}`;
    return db.queries <= 3 || `${db.queries} queries: ${db.log.join(' ')}`.slice(0, 90);
  });

  // Batching is only worth anything if the values still land on the right parents. Every
  // expectation here is computed from the data, so a passing batch is a correct one.
  await guard('and every user still gets their OWN team and posts', async () => {
    const db = makeDb();
    const r = await run(s, db, `{ users(limit: 40) { id name team { name } posts { title } } }`);
    const wrong = [];
    for (const u of r.data.users) {
      const seed = DATA.USERS.find((x) => x.name === u.name);
      const wantTeam = `team-${seed.teamId}`;
      const wantPosts = DATA.POSTS.filter((p) => p.authorId === seed.id).map((p) => p.title).sort();
      if (u.team?.name !== wantTeam) wrong.push(`${u.name}: team ${u.team?.name} != ${wantTeam}`);
      const gotPosts = u.posts.map((p) => p.title).sort();
      if (JSON.stringify(gotPosts) !== JSON.stringify(wantPosts)) {
        wrong.push(`${u.name}: ${gotPosts.length} posts != ${wantPosts.length}`);
      }
    }
    return wrong.length === 0 || `${wrong.length} users got someone else's data, e.g. ${wrong[0]}`;
  });

  await guard('three levels deep — posts, comments, and both sets of authors — stays bounded', async () => {
    const db = makeDb();
    const r = await run(s, db, `{ posts(limit: 30) { title author { name } comments { text author { name } } } }`);
    if (r.errors) return `errors: ${r.errors[0].message}`.slice(0, 70);
    const first = r.data.posts[0];
    if (!first.author?.name || !first.comments?.[0]?.author?.name) return 'a nested author did not resolve';
    return db.queries <= 5 || `${db.queries} queries: ${db.log.join(' ')}`.slice(0, 100);
  });

  await guard('a fresh request gets a fresh cache (no stale data between requests)', async () => {
    const db1 = makeDb();
    await run(s, db1, `{ users(limit: 5) { name } }`);
    const db2 = makeDb();
    await run(s, db2, `{ users(limit: 5) { name } }`);
    return db2.queries > 0 || 'the second request served everything from the first request\'s cache';
  });

  return out;
}
