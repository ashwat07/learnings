/** Drill 03 — reference. */

import crypto from 'node:crypto';
import { parse } from 'graphql';

const MAX_PAGE = 100;

// The cursor carries EVERY column in the sort key. That is the whole fix for ties: (createdAt)
// alone is ambiguous when three rows share it, so the reader either sees a row twice or misses
// it. (createdAt, id) is unique because id is, and "strictly after this pair" is a total order.
//
// The general rule: a keyset cursor must contain enough columns to be UNIQUE. If your sort is not
// unique, append the primary key — always.
const SECRET = process.env.CURSOR_SECRET ?? 'lab-only-not-a-real-secret';

export function encodeCursor(node) {
  const payload = JSON.stringify({ v: 1, createdAt: node.createdAt, id: node.id });
  // Signed, so a client cannot craft one. This matters more than it looks: an unsigned cursor is
  // an input into your WHERE clause chosen by the caller, and "page from this arbitrary point"
  // can leak rows a filter was supposed to exclude.
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url').slice(0, 16);
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length === 0) throw new Error('invalid cursor');
  let raw;
  try { raw = Buffer.from(cursor, 'base64url').toString('utf8'); }
  catch { throw new Error('invalid cursor'); }

  const idx = raw.lastIndexOf('.');
  if (idx < 0) throw new Error('invalid cursor');
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url').slice(0, 16);
  // timingSafeEqual needs equal lengths; compare digests of the same size.
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('invalid cursor');
  }

  let parsed;
  try { parsed = JSON.parse(payload); } catch { throw new Error('invalid cursor'); }
  if (parsed.v !== 1 || typeof parsed.createdAt !== 'number' || parsed.id == null) {
    throw new Error('invalid cursor');
  }
  return parsed;
  // The `v` field is why this is worth versioning: the day you change the sort order, old
  // cursors mean something different. Bump v, reject v:1, and clients get a clean error instead
  // of silently wrong pages.
}

export async function connection(db, { first = 10, after = null } = {}) {
  if (!Number.isInteger(first) || first < 1) throw new Error('`first` must be a positive integer');
  // CAP IT. `first` is a number chosen by whoever is calling you, and an uncapped page size is an
  // uncapped query, an uncapped response, and an uncapped amount of memory on both ends.
  const limit = Math.min(first, MAX_PAGE);

  // `after == null` means "start from the beginning". ANYTHING ELSE is a cursor and must be
  // valid — including the empty string. `after ? ... : null` treats "" as "start", so a client
  // bug that produces an empty cursor silently returns page 1 forever and the user's infinite
  // scroll repeats itself. Falsy is not the same as absent.
  const cur = after == null ? null : decodeCursor(after);
  // limit + 1 — fetch one extra to learn whether there is a next page, instead of running a
  // second COUNT query that is both slow and wrong by the time it returns.
  const rows = await db.postsPage({
    afterCreatedAt: cur?.createdAt ?? null,
    afterId: cur?.id ?? null,
    limit,
  });

  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;

  return {
    edges: page.map((node) => ({ node, cursor: encodeCursor(node) })),
    pageInfo: {
      hasNextPage,
      hasPreviousPage: after != null,
      startCursor: page.length ? encodeCursor(page[0]) : null,
      endCursor: page.length ? encodeCursor(page.at(-1)) : null,
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * Static cost analysis over the query AST. No schema and no data required, which is the point:
 * this runs BEFORE a single resolver, so an expensive query costs you a parse rather than a
 * database.
 */
export function analyse(query) {
  const ast = parse(query);   // throws on a syntax error; guard() catches it

  let maxDepth = 0;
  let complexity = 0;

  const listArg = (node) => {
    for (const arg of node.arguments ?? []) {
      if (!['first', 'last', 'limit'].includes(arg.name.value)) continue;
      if (arg.value.kind === 'IntValue') return Number(arg.value.value);
      // A variable: assume the worst. `first: $n` with no default is not a small page until you
      // have checked the variables, and a limiter that assumes 1 is a limiter you can bypass by
      // moving the number into a variable.
      return MAX_PAGE;
    }
    return null;
  };

  // `multiplier` is how many times this subtree will be evaluated: 50 users x 50 posts each is
  // 2,500 comment resolutions, not 100. Counting FIELDS instead of ROWS is the mistake that makes
  // a complexity limit decorative — the expensive query and the cheap one have the same field
  // count and differ only in `first`.
  const walk = (node, depth, multiplier) => {
    if (depth > maxDepth) maxDepth = depth;
    for (const sel of node.selectionSet?.selections ?? []) {
      if (sel.kind === 'Field') {
        const n = listArg(sel);
        const childMultiplier = n == null ? multiplier : multiplier * n;
        complexity += childMultiplier;
        walk(sel, depth + 1, childMultiplier);
      } else {
        // Inline fragments and fragment spreads do not add depth themselves.
        walk(sel, depth, multiplier);
      }
    }
  };

  for (const def of ast.definitions) {
    if (def.kind === 'OperationDefinition') walk(def, 0, 1);
  }
  return { depth: maxDepth, complexity };
}

export function guard(query, { maxDepth = 12, maxComplexity = 10_000 } = {}) {
  let stats;
  try { stats = analyse(query); }
  catch (err) { return { ok: false, reason: `could not parse the query: ${err.message}` }; }

  if (stats.depth > maxDepth) {
    return { ok: false, reason: `query depth ${stats.depth} exceeds the maximum of ${maxDepth}`, ...stats };
  }
  if (stats.complexity > maxComplexity) {
    return { ok: false, reason: `query complexity ${stats.complexity} exceeds the maximum of ${maxComplexity}`, ...stats };
  }
  return { ok: true, ...stats };
}

/*
WHY OFFSET IS WRONG, IN ONE SENTENCE
`LIMIT 10 OFFSET 20` means "count 20 rows and skip them", so it gets slower the deeper you go
(the database really does count them) AND it is defined relative to a list that is changing:
delete one row on page 1 and page 2 silently skips a row; insert one and page 2 repeats one.
The full measurement is in postgres lab 08 — keyset pagination is faster at page 1 and the gap
widens without bound.

THE RELAY CONNECTION SHAPE, AND WHY IT LOOKS LIKE THAT

    { edges: [{ node, cursor }], pageInfo: { hasNextPage, endCursor } }

`edges` rather than a plain list exists so each item can carry data ABOUT the relationship — the
cursor, and things like `role` on a membership edge — without polluting the node. It is more
verbose than most APIs need, and worth adopting anyway because every GraphQL client already knows
it: Relay and Apollo both do cursor-based cache merging for free if your API has this shape.

`hasPreviousPage` is honestly hard with pure keyset paging (you would have to look backwards), and
the spec permits false when you cannot know. Do not fake it.

WHAT NOT TO SHIP
  · `totalCount` on a large table. It is a full count on every page request; the number is stale
    before the response is sent. Offer an approximate count (pg_class.reltuples) or none.
  · unsigned cursors that are just an id or an offset. Clients WILL do arithmetic on them, and
    then you can never change the ordering.

THE THREE LIMITS EVERY PUBLIC GRAPHQL ENDPOINT NEEDS, IN ORDER OF VALUE
  1. PERSISTED QUERIES. The client registers its queries at build time and sends a hash. The
     server executes nothing else. This makes depth and complexity limits almost redundant, kills
     the whole class of hostile-query attacks, and shrinks the request. If you control both ends,
     do this and stop reading.
  2. depth + complexity limits, as above, plus a cap on aliases — `{ a: user(id:1) b: user(id:1)
     ... }` repeated 1,000 times is one field, depth 2, and a thousand resolutions.
  3. timeouts and a per-client rate limit priced in COMPLEXITY POINTS, not requests. One GraphQL
     request is not one unit of work, so a request-per-minute limit prices the cheap query and the
     expensive one identically. GitHub's public API does exactly this and publishes the formula.

And turn off introspection in production, or require auth for it. It is how an attacker learns
which of these queries to write.
*/
