/**
 * Drill 03 — cursor pagination, and a ceiling on query cost.
 *
 * The starting point paginates by offset and counts fields. Both are the version that ships and
 * neither survives contact with a live list or a determined client.
 *
 * Export five things:
 *
 *   encodeCursor(node)        -> an OPAQUE string identifying this row's position in the sort
 *   decodeCursor(cursor)      -> the values back; throw on anything you did not produce
 *   connection(db, { first, after })
 *                             -> { edges: [{ node, cursor }], pageInfo: { hasNextPage, endCursor } }
 *   analyse(query)            -> { depth, complexity }
 *   guard(query, { maxDepth, maxComplexity }) -> { ok: boolean, reason?: string }
 *
 * db.postsPage({ afterCreatedAt, afterId, limit }) returns rows sorted by (createdAt, id),
 * strictly after that pair, and gives you limit + 1 so you can tell whether there is another page
 * without a second query. Read ../../world.mjs.
 *
 * The ordering has TIES: every third post shares a createdAt with its neighbours. That is not a
 * contrived edge case — it is what happens whenever your sort key is a timestamp, a score, a
 * price, or a name.
 *
 * For analyse(), `parse` from the `graphql` package gives you an AST. You do not need a schema:
 * walk the selection sets, and read the `first`/`limit` arguments as multipliers.
 */

import { parse } from 'graphql';

export function encodeCursor(node) {
  return String(node.createdAt);
}

export function decodeCursor(cursor) {
  return { createdAt: Number(cursor), id: null };
}

export async function connection(db, { first = 10, after = null }) {
  const { createdAt } = after ? decodeCursor(after) : { createdAt: null };
  const rows = await db.postsPage({ afterCreatedAt: createdAt, afterId: null, limit: first });
  const edges = rows.map((node) => ({ node, cursor: encodeCursor(node) }));
  return {
    edges,
    pageInfo: {
      hasNextPage: edges.length > 0,
      endCursor: edges.at(-1)?.cursor ?? null,
    },
  };
}

export function analyse(query) {
  const ast = parse(query);
  let fields = 0;
  const walk = (node) => {
    for (const sel of node.selectionSet?.selections ?? []) {
      fields++;
      walk(sel);
    }
  };
  for (const def of ast.definitions) walk(def);
  return { depth: 1, complexity: fields };
}

export function guard(query, { maxDepth, maxComplexity }) {
  const { depth, complexity } = analyse(query);
  if (depth > maxDepth) return { ok: false, reason: `depth ${depth} > ${maxDepth}` };
  if (complexity > maxComplexity) return { ok: false, reason: `complexity ${complexity} > ${maxComplexity}` };
  return { ok: true };
}
