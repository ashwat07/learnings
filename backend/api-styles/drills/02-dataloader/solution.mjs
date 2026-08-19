/**
 * Drill 02 — DataLoader.
 *
 * The starting point has no loader at all. It is the version everybody writes first, it is
 * correct, and it issues 81 queries for a page that needs 3.
 *
 * Three exports:
 *
 *   createLoader(batchFn, { maxBatchSize })  ->  { load(key), loadMany(keys) }
 *   createLoaders(db)                        ->  the loaders your resolvers use
 *   resolvers                                ->  the same resolvers, going through the loaders
 *
 * The contract for batchFn, and it is the whole thing:
 *
 *     batchFn(uniqueKeys) must resolve to an array of the SAME LENGTH, in the SAME ORDER,
 *     where result[i] corresponds to uniqueKeys[i].
 *
 * Your database will not do that. `SELECT * FROM users WHERE id = ANY($1)` returns rows in
 * whatever order the plan produced, drops the ids that do not exist, and has no idea what you
 * asked for. Mapping its answer back onto the key array is your job, and getting it wrong does
 * not throw — it silently returns user 12's email to user 11.
 *
 * Note also WHEN to flush. DataLoader batches everything requested in the current tick of the
 * event loop, which for GraphQL means "one level of the resolver tree". process.nextTick or
 * queueMicrotask; never setTimeout, which adds a millisecond to every single field.
 * (node-runtime drill 01, applied.)
 */

export function createLoader(batchFn, options = {}) {
  return {
    async load(key) {
      const [value] = await batchFn([key]);
      return value;
    },
    async loadMany(keys) {
      return Promise.all(keys.map((k) => this.load(k)));
    },
  };
}

export function createLoaders(db) {
  return { db };
}

export const resolvers = {
  Query: {
    users: (_p, { limit = 40 }, { db }) => db.usersAll(limit),
    posts: (_p, { limit = 30 }, { db }) => db.postsAll(limit),
  },

  User: {
    // Called once per user. Forty users, forty queries.
    async team(user, _a, { db }) {
      const [t] = await db.teamsByIds([user.teamId]);
      return t ?? null;
    },
    async posts(user, _a, { db }) {
      return db.postsByAuthorIds([user.id]);
    },
  },

  Post: {
    async author(post, _a, { db }) {
      const [u] = await db.usersByIds([post.authorId]);
      return u ?? null;
    },
    async comments(post, _a, { db }) {
      return db.commentsByPostIds([post.id]);
    },
  },

  Comment: {
    async author(comment, _a, { db }) {
      const [u] = await db.usersByIds([comment.authorId]);
      return u ?? null;
    },
  },
};
