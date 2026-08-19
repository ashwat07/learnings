/** Drill 02 — reference. */

export function createLoader(batchFn, { maxBatchSize = Infinity, cache = true } = {}) {
  const cached = new Map();     // key -> Promise, so two loads of one key share ONE promise
  let queue = [];               // { key, resolve, reject } awaiting the next flush
  let scheduled = false;

  const flush = async () => {
    scheduled = false;
    const batch = queue;
    queue = [];
    if (batch.length === 0) return;

    // Dedupe within the batch. A page of 40 users on 5 teams asks for 40 team ids; 5 are
    // distinct, and the database should see 5.
    const keys = [];
    const byKey = new Map();
    for (const item of batch) {
      const k = String(item.key);
      if (!byKey.has(k)) { byKey.set(k, []); keys.push(item.key); }
      byKey.get(k).push(item);
    }

    // maxBatchSize exists because `WHERE id = ANY($1)` with 100,000 ids is not one fast query, it
    // is one query that plans badly and blows past your statement timeout. Chunk it.
    for (let i = 0; i < keys.length; i += maxBatchSize) {
      const chunk = keys.slice(i, i + maxBatchSize);
      try {
        const values = await batchFn(chunk);
        if (!Array.isArray(values) || values.length !== chunk.length) {
          throw new TypeError(
            `batchFn must return ${chunk.length} values for ${chunk.length} keys, got ` +
            `${Array.isArray(values) ? values.length : typeof values}`);
        }
        chunk.forEach((key, idx) => {
          const value = values[idx];
          for (const waiter of byKey.get(String(key))) {
            // An Error IN the array is a per-key failure — "this row exists but you may not see
            // it" — and rejects only that key. An Error THROWN by batchFn is a batch failure.
            if (value instanceof Error) waiter.reject(value); else waiter.resolve(value);
          }
        });
      } catch (err) {
        for (const key of chunk) {
          for (const waiter of byKey.get(String(key))) waiter.reject(err);
          // Evict on failure. A cached REJECTED promise means one transient blip poisons this key
          // for the rest of the request — and if the loader is long-lived, forever.
          cached.delete(String(key));
        }
      }
    }
  };

  const enqueue = (key) => new Promise((resolve, reject) => {
    queue.push({ key, resolve, reject });
    if (!scheduled) {
      scheduled = true;
      // The whole design rests on this line. A microtask runs after the CURRENT synchronous work
      // — which for GraphQL is "after every resolver at this level of the tree has been called" —
      // and before the event loop advances a phase. So every sibling resolver's key lands in the
      // same batch, at no latency cost. setTimeout(0) would work and would add ~1ms per level,
      // per request, forever.
      queueMicrotask(flush);
    }
  });

  return {
    load(key) {
      const k = String(key);
      if (cache && cached.has(k)) return cached.get(k);
      const promise = enqueue(key);
      if (cache) cached.set(k, promise);
      return promise;
    },
    loadMany(keys) {
      // Promise.all, not allSettled: loadMany rejecting if any key fails matches load()'s
      // behaviour. DataLoader itself returns errors in the array instead; either is defensible
      // as long as callers know which.
      return Promise.all(keys.map((k) => this.load(k)));
    },
    clear(key) { cached.delete(String(key)); return this; },
    clearAll() { cached.clear(); return this; },
    prime(key, value) { if (!cached.has(String(key))) cached.set(String(key), Promise.resolve(value)); return this; },
  };
}

/**
 * ONE SET OF LOADERS PER REQUEST. This function is called from the request handler, and the
 * loaders live and die with it.
 *
 * Making them module-level would "work" and be two bugs: a cache that never expires (so an edit
 * is invisible until deploy) and a cache shared across users (so a permission check that passed
 * for one request serves cached data to another). The per-request lifetime is not a detail —
 * it is what makes caching by primary key safe without any invalidation at all.
 */
export function createLoaders(db) {
  // The index-by-key helper. Writing it once is the difference between this being routine and
  // being the place misalignment bugs live.
  const indexBy = (rows, keyOf) => {
    const m = new Map();
    for (const row of rows) m.set(String(keyOf(row)), row);
    return m;
  };
  const groupBy = (rows, keyOf) => {
    const m = new Map();
    for (const row of rows) {
      const k = String(keyOf(row));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(row);
    }
    return m;
  };

  return {
    // ONE-TO-ONE: a missing key is null. Never `rows[i]` — the row order is the database's
    // choice and the length is not even guaranteed to match.
    user: createLoader(async (ids) => {
      const rows = await db.usersByIds(ids);
      const byId = indexBy(rows, (r) => r.id);
      return ids.map((id) => byId.get(String(id)) ?? null);
    }),

    team: createLoader(async (ids) => {
      const rows = await db.teamsByIds(ids);
      const byId = indexBy(rows, (r) => r.id);
      return ids.map((id) => byId.get(String(id)) ?? null);
    }),

    // ONE-TO-MANY: a missing key is an EMPTY ARRAY, not null. A `[Post!]!` field that resolves to
    // null nulls its parent (drill 01's note on null propagation), so this distinction decides
    // whether a user with no posts disappears from your response.
    postsByAuthor: createLoader(async (authorIds) => {
      const rows = await db.postsByAuthorIds(authorIds);
      const grouped = groupBy(rows, (r) => r.authorId);
      return authorIds.map((id) => grouped.get(String(id)) ?? []);
    }),

    commentsByPost: createLoader(async (postIds) => {
      const rows = await db.commentsByPostIds(postIds);
      const grouped = groupBy(rows, (r) => r.postId);
      return postIds.map((id) => grouped.get(String(id)) ?? []);
    }),
  };
}

export const resolvers = {
  Query: {
    users: (_p, { limit = 40 }, { db }) => db.usersAll(limit),
    posts: (_p, { limit = 30 }, { db }) => db.postsAll(limit),
  },
  User: {
    team: (user, _a, { loaders }) => (user.teamId == null ? null : loaders.team.load(user.teamId)),
    posts: (user, _a, { loaders }) => loaders.postsByAuthor.load(user.id),
  },
  Post: {
    author: (post, _a, { loaders }) => loaders.user.load(post.authorId),
    comments: (post, _a, { loaders }) => loaders.commentsByPost.load(post.id),
  },
  Comment: {
    author: (comment, _a, { loaders }) => loaders.user.load(comment.authorId),
  },
};

/*
WHY THIS WORKS AT ALL — the bit that is not obvious

graphql-js resolves a level of the tree by calling every field resolver at that level
SYNCHRONOUSLY, collecting promises, and only then awaiting them. So all 40 `team` resolvers run
before any of them resumes, all 40 `load()` calls land in `queue`, and the microtask flush sees
all 40 keys at once.

That is why the flush must be a MICROTASK. It has to run after the synchronous fan-out and before
anything awaits — which is exactly the gap between "the loop's current callback finishes" and
"the loop advances". node-runtime drill 01 is that gap, and this is what it is for.

IT IS NOT A GRAPHQL TOOL

A DataLoader is a batching cache for any key-value fetch: REST controllers that call three
services, a gRPC server, a job that enriches 10,000 rows, a React server component tree.
Anywhere a function is called once per item with a different id, this shape applies.

WHAT IT DOES NOT SOLVE, AND WHAT PEOPLE EXPECT IT TO
  · it is not a cross-request cache. Per request, by design. If you want more, put Redis behind
    the batch function, and now you own invalidation (caching-and-queues lab 02).
  · it does not bound DEPTH or COST. `{ user { posts { author { posts { author { ... } } } } } }`
    is now efficiently exponential. That is drill 03.
  · it does not fix a slow query, only a repeated one. `WHERE id = ANY($1)` with no index on id
    is one bad query instead of forty (postgres lab 03).
  · a per-key `Error` in the returned array is a REJECTION for that key. Use it for "row exists,
    you may not see it" rather than returning null, or authorisation failures become
    indistinguishable from missing data.

THE INSTRUMENT THAT CATCHES THE REGRESSION
Count queries per request and log it. `db.queries` in this drill is the toy version; in
production it is a counter in your database wrapper plus the resolver path. A request that
suddenly issues 400 queries is a field somebody added without a loader, and the count finds it in
a dashboard rather than in an incident.
*/
