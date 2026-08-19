/**
 * Lab 01 — REST vs GraphQL vs gRPC vs tRPC, in numbers.
 *
 *   node api-styles/labs/01-choosing/lab.mjs
 *
 * The comparison is usually argued in adjectives. This measures the three things that actually
 * differ — bytes on the wire, round trips, and what happens when the schema changes — and then
 * says plainly which one each style wins.
 */

import zlib from 'node:zlib';
import { makeDb, DATA } from '../../world.mjs';
import { makeExecutableSchema, graphql } from '../../graphql-lib.mjs';
import { encode as protoEncode } from '../../drills/04-protobuf-wire/reference.mjs';
import { rule, note, table, good } from '../../../lib/console.mjs';

const gzip = (s) => zlib.gzipSync(Buffer.from(s)).length;
const bytes = (n) => `${n.toLocaleString()} B`;

// The screen we are building: a post list with each post's author name and comment count.
const POSTS = DATA.POSTS.slice(0, 20);
const authorOf = (p) => DATA.USERS.find((u) => u.id === p.authorId);
const commentsOf = (p) => DATA.COMMENTS.filter((c) => c.postId === p.id);

rule('THE SCREEN');
console.log(`
  Twenty posts. For each one: the title, the author's NAME, and how many comments it has.
  That is all the UI needs. Every measurement below delivers exactly that.
`);

// ---------------------------------------------------------------------------
rule('1. bytes on the wire');

// (a) REST as it usually exists: one endpoint per resource, full representations.
const restFat = JSON.stringify({
  posts: POSTS.map((p) => ({ ...p })),                                  // body, authorId, createdAt...
  users: DATA.USERS.map((u) => ({ id: u.id, name: u.name, email: u.email, teamId: u.teamId })),
  comments: DATA.COMMENTS.filter((c) => POSTS.some((p) => p.id === c.postId)),
});

// (b) REST with a purpose-built endpoint — the "backend for frontend" answer.
const restExact = JSON.stringify({
  posts: POSTS.map((p) => ({ id: p.id, title: p.title, author: authorOf(p).name, comments: commentsOf(p).length })),
});

// (c) GraphQL: the client asked for these fields, so these are the fields it gets.
const gqlBody = JSON.stringify({
  data: { posts: POSTS.map((p) => ({ title: p.title, author: { name: authorOf(p).name }, commentCount: commentsOf(p).length })) },
});

// (d) protobuf, carrying the same three values per post.
const PostRow = { 1: { name: 'title', type: 'string' }, 2: { name: 'author', type: 'string' }, 3: { name: 'commentCount', type: 'int32' } };
const Rows = { 1: { name: 'posts', type: 'message', message: PostRow, repeated: true } };
const proto = protoEncode(Rows, {
  posts: POSTS.map((p) => ({ title: p.title, author: authorOf(p).name, commentCount: commentsOf(p).length })),
});

const rows = [
  { style: 'REST, resource endpoints (over-fetch)', raw: restFat.length, gz: gzip(restFat) },
  { style: 'REST, purpose-built endpoint (BFF)', raw: restExact.length, gz: gzip(restExact) },
  { style: 'GraphQL, exactly the fields asked for', raw: gqlBody.length, gz: gzip(gqlBody) },
  { style: 'gRPC / protobuf', raw: proto.length, gz: gzip(proto) },
];
table(rows.map((r) => ({
  style: r.style,
  'raw': bytes(r.raw),
  'gzipped': bytes(r.gz),
  'vs the fat REST': `${(r.gz / rows[0].gz * 100).toFixed(0)}%`,
})), ['style', 'raw', 'gzipped', 'vs the fat REST']);

console.log(`
  Read the GZIPPED column, not the raw one. That is the number that crosses the network, and it
  is where most of the "GraphQL saves bandwidth" argument quietly dies: JSON's repeated field
  names compress extremely well, so the gap between a fat REST payload and a precise GraphQL one
  is far smaller after gzip than before it.

  Protobuf keeps its advantage because it never sends the field names at all — only tags. That
  advantage also shrinks with gzip, and stays real.

  So: if your only complaint about REST is payload size, the honest fix is usually a
  purpose-built endpoint and Brotli, not a new protocol.`);

// ---------------------------------------------------------------------------
rule('2. round trips — where the time actually goes');

const RTT = 80;   // a mobile connection to another continent
const scenarios = [
  { style: 'REST, resource endpoints', trips: 3, why: 'GET /posts, then GET /users?ids=.., then GET /comments?postIds=..' },
  { style: 'REST, N+1 from the client', trips: 1 + POSTS.length, why: 'GET /posts, then GET /users/:id per post — the mobile-app classic' },
  { style: 'REST, purpose-built endpoint', trips: 1, why: 'GET /screens/post-list' },
  { style: 'GraphQL', trips: 1, why: 'one POST /graphql, whatever the screen needs' },
  { style: 'gRPC', trips: 1, why: 'one unary call, multiplexed over an existing HTTP/2 connection' },
];
table(scenarios.map((s) => ({
  style: s.style,
  'round trips': s.trips,
  [`at ${RTT}ms RTT`]: `${(s.trips * RTT).toLocaleString()}ms before any server work`,
})), ['style', 'round trips', `at ${RTT}ms RTT`]);
for (const s of scenarios) note(`${s.style}: ${s.why}`);

console.log(`
  This is the argument that survives scrutiny. On a slow link, latency is the product, and 21
  sequential round trips is ${(21 * RTT / 1000).toFixed(1)} seconds of doing nothing at all.

  Note that GraphQL and the purpose-built REST endpoint are TIED. GraphQL's real advantage is not
  that one request beats twenty-one — it is that the client decides what to ask for WITHOUT you
  shipping a new endpoint every time a screen changes. If you own both ends and ship them
  together, a BFF endpoint gets you the same number for a fraction of the machinery.`);

// ---------------------------------------------------------------------------
rule('3. what one request costs the SERVER');

{
  const db = makeDb();
  const typeDefs = `
    type User { name: String! }
    type Post { title: String!  author: User  commentCount: Int! }
    type Query { posts(limit: Int): [Post!]! }`;

  // Deliberately without a DataLoader, to show what the same request costs unbatched.
  const naive = {
    Query: { posts: (_p, { limit }, { db }) => db.postsAll(limit) },
    Post: {
      author: async (post, _a, { db }) => (await db.usersByIds([post.authorId]))[0],
      commentCount: async (post, _a, { db }) => (await db.commentsByPostIds([post.id])).length,
    },
  };
  const t0 = performance.now();
  await graphql({ schema: makeExecutableSchema(typeDefs, naive), source: `{ posts(limit: 20) { title author { name } commentCount } }`, contextValue: { db } });
  const naiveMs = performance.now() - t0;
  const naiveQueries = db.queries;

  const db2 = makeDb();
  const { createLoaders } = await import('../../drills/02-dataloader/reference.mjs');
  const batched = {
    Query: { posts: (_p, { limit }, { db }) => db.postsAll(limit) },
    Post: {
      author: (post, _a, { loaders }) => loaders.user.load(post.authorId),
      commentCount: async (post, _a, { loaders }) => (await loaders.commentsByPost.load(post.id)).length,
    },
  };
  const t1 = performance.now();
  await graphql({ schema: makeExecutableSchema(typeDefs, batched), source: `{ posts(limit: 20) { title author { name } commentCount } }`, contextValue: { db: db2, loaders: createLoaders(db2) } });
  const batchedMs = performance.now() - t1;

  table([
    { 'the same GraphQL request': 'no DataLoader', queries: naiveQueries, ms: naiveMs.toFixed(0) },
    { 'the same GraphQL request': 'with DataLoader', queries: db2.queries, ms: batchedMs.toFixed(0) },
  ], ['the same GraphQL request', 'queries', 'ms']);

  console.log(`
  ONE round trip for the client, ${naiveQueries} queries for the database. That is the bill GraphQL
  hands you in exchange for the flexibility, and it arrives whether or not you knew about it —
  the client wrote the query, so the fan-out is not visible in any endpoint you can read.

  This is the honest cost of "the client asks for what it needs": you no longer control the shape
  of the work. DataLoader (drill 02) and complexity limits (drill 03) are not optimisations, they
  are the price of admission.`);
}

// ---------------------------------------------------------------------------
rule('4. what breaks when the schema changes');

table([
  { style: 'REST + OpenAPI', 'adding a field': 'safe; clients ignore it', 'removing one': 'breaks silently — nothing checks', 'who verifies': 'nobody, unless you run contract tests' },
  { style: 'GraphQL', 'adding a field': 'safe', 'removing one': 'BREAKS ONLY CLIENTS THAT ASKED FOR IT — and you can see who did', 'who verifies': 'the schema registry + field usage metrics' },
  { style: 'gRPC / protobuf', 'adding a field': 'safe (new number)', 'removing one': 'safe if you `reserved` it', 'who verifies': '`buf breaking` in CI, against the previous schema' },
  { style: 'tRPC', 'adding a field': 'safe', 'removing one': 'a TypeScript error, at build time', 'who verifies': 'the compiler — but only in one repo' },
], ['style', 'adding a field', 'removing one', 'who verifies']);

console.log(`
  This column is the one that should decide your choice, and it is the one nobody measures.

  GraphQL's genuine, underrated superpower is FIELD-LEVEL USAGE DATA: because clients name every
  field they read, the server knows exactly which fields are still used and by whom. Deprecating a
  field stops being a guess. No REST API can tell you that.`);

// ---------------------------------------------------------------------------
rule('5. so which one');

console.log(`
  REST
    Default. Cacheable by URL at every layer you already have — CDN, browser, proxy — which is a
    real advantage GraphQL gives up entirely (one POST /graphql is opaque to all of it). Debuggable
    with curl. Every tool understands it. Choose it unless something below is TRUE, not likely.

  GraphQL
    Choose it when MANY DIFFERENT CLIENTS need DIFFERENT SHAPES of the same data and you cannot
    ship a new endpoint per screen — several apps, several teams, a public API, or a product where
    the UI changes faster than the backend can follow.
    The bill: DataLoader everywhere, complexity limits, persisted queries, a caching story you now
    own, and 200 OKs that contain errors so your monitoring lies to you until you fix it.
    Not worth it for: one frontend, one team, one repo.

  gRPC
    Choose it for SERVICE-TO-SERVICE inside your own network. Compact, schema-checked in CI,
    deadlines propagate automatically, streaming in both directions, code generated for every
    language. Browsers cannot speak it without a proxy, and you cannot curl it — which matters far
    less between two of your own services than people expect.

  tRPC
    Choose it when the client and server are TypeScript IN THE SAME REPOSITORY. You get end-to-end
    types with no schema, no codegen and no build step, because the types ARE the schema. That is
    also its boundary: no schema means nothing for another language, another team or a third party
    to consume. It is the best answer to a narrow question.

  And the answer that is usually right and rarely said: START WITH REST, add a purpose-built
  endpoint per screen when a screen needs one, and adopt one of the others when you can name the
  specific pain it removes.
`);
