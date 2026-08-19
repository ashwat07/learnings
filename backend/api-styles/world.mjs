/**
 * The world every api-styles drill runs against.
 *
 * A tiny in-memory database that COUNTS QUERIES and charges 2ms for each one. That counter is the
 * point: N+1 is not a style problem, it is a number, and it stays the same number whether the
 * store behind it is Postgres, Mongo or an HTTP service.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const USERS = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  name: `user-${i + 1}`,
  email: `user${i + 1}@example.com`,
  passwordHash: `$scrypt$never-send-this-${i + 1}`,   // present on purpose: it must never escape
  teamId: (i % 5) + 1,
}));

const TEAMS = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `team-${i + 1}` }));

const POSTS = Array.from({ length: 120 }, (_, i) => ({
  id: i + 1,
  title: `post-${i + 1}`,
  body: `body of post ${i + 1}`,
  authorId: (i % 40) + 1,
  // A deterministic, strictly increasing timestamp, so cursor pagination has something honest to
  // sort by. Ties are on purpose: every third post shares a timestamp with its neighbour.
  createdAt: 1_700_000_000_000 + Math.floor(i / 3) * 60_000,
}));

const COMMENTS = Array.from({ length: 400 }, (_, i) => ({
  id: i + 1,
  postId: (i % 120) + 1,
  authorId: (i % 40) + 1,
  text: `comment ${i + 1}`,
}));

export function makeDb({ latencyMs = 2 } = {}) {
  const log = [];
  const record = (label) => { log.push(label); };

  const db = {
    get queries() { return log.length; },
    get log() { return [...log]; },
    reset() { log.length = 0; },

    async usersAll(limit = 40) {
      record(`usersAll(${limit})`);
      await sleep(latencyMs);
      return USERS.slice(0, limit).map((u) => ({ ...u }));
    },
    async postsAll(limit = 30) {
      record(`postsAll(${limit})`);
      await sleep(latencyMs);
      return POSTS.slice(0, limit).map((p) => ({ ...p }));
    },
    async usersByIds(ids) {
      record(`usersByIds(${ids.length})`);
      await sleep(latencyMs);
      const set = new Set(ids.map(Number));
      return USERS.filter((u) => set.has(u.id)).map((u) => ({ ...u }));
    },
    async teamsByIds(ids) {
      record(`teamsByIds(${ids.length})`);
      await sleep(latencyMs);
      const set = new Set(ids.map(Number));
      return TEAMS.filter((t) => set.has(t.id)).map((t) => ({ ...t }));
    },
    async postsByAuthorIds(ids) {
      record(`postsByAuthorIds(${ids.length})`);
      await sleep(latencyMs);
      const set = new Set(ids.map(Number));
      return POSTS.filter((p) => set.has(p.authorId)).map((p) => ({ ...p }));
    },
    async commentsByPostIds(ids) {
      record(`commentsByPostIds(${ids.length})`);
      await sleep(latencyMs);
      const set = new Set(ids.map(Number));
      return COMMENTS.filter((c) => set.has(c.postId)).map((c) => ({ ...c }));
    },
    /** Keyset page: everything strictly after (createdAt, id), ordered, limit + 1 to peek. */
    async postsPage({ afterCreatedAt = null, afterId = null, limit = 10 }) {
      record(`postsPage(limit=${limit})`);
      await sleep(latencyMs);
      const sorted = [...POSTS].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
      const start = afterCreatedAt == null
        ? 0
        : sorted.findIndex((p) => p.createdAt > afterCreatedAt || (p.createdAt === afterCreatedAt && p.id > afterId)) ;
      if (start === -1) return [];
      return sorted.slice(start, start + limit + 1).map((p) => ({ ...p }));
    },
    async totalPosts() {
      record('totalPosts()');
      await sleep(latencyMs);
      return POSTS.length;
    },
    /** Fails on purpose, so error handling has something real to handle. */
    async brokenField() {
      record('brokenField()');
      await sleep(latencyMs);
      const err = new Error('connection to shard 3 refused: user=svc_api password=hunter2');
      err.code = 'ECONNREFUSED';
      throw err;
    },
  };
  return db;
}

export const DATA = { USERS, TEAMS, POSTS, COMMENTS };
