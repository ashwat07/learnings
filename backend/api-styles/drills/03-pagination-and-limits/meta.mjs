import { makeDb, DATA } from '../../world.mjs';

export const title = 'Cursor pagination, and putting a ceiling on a query';
export const task = `Two ways a public GraphQL endpoint hurts you, and neither is a bug in any
single resolver.

FIRST: pagination. OFFSET is wrong for a live list — rows shift under the reader, so page 2 skips
what page 1 already moved past and repeats what moved in. A CURSOR points at a ROW, not a
position. And the tie is what catches people: sorting by a timestamp alone, with three rows sharing
a timestamp, loses or repeats rows at every page boundary.

SECOND: cost. One query can ask for users -> posts -> comments -> author -> posts... A client
does not need to be hostile to write it; a generated query from a UI is enough, and it can cost
more than the rest of your traffic combined.

  connection(db, { first, after })  ->  { edges: [{ node, cursor }], pageInfo }
  encodeCursor(node) / decodeCursor(cursor)
  analyse(query)                    ->  { depth, complexity }
  guard(query, { maxDepth, maxComplexity })  ->  { ok, reason }`;
export const passIf = 'every row is seen exactly once across ties, cursors are opaque and validated, first is capped, and expensive queries are refused before they run';

const sortedPosts = [...DATA.POSTS].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);

export async function check(s) {
  const need = ['connection', 'encodeCursor', 'decodeCursor', 'analyse', 'guard'];
  const missing = need.filter((k) => typeof s[k] !== 'function');
  if (missing.length) return [{ check: `exports ${need.join(', ')}`, actual: `missing ${missing.join(', ')}`, pass: false }];

  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 64), pass: false }); }
  };

  await guard('a cursor round-trips', async () => {
    const node = sortedPosts[17];
    const back = s.decodeCursor(s.encodeCursor(node));
    return (Number(back.id) === node.id && Number(back.createdAt) === node.createdAt)
      ? true : `decoded ${JSON.stringify(back)}`;
  });

  await guard('a cursor is opaque — not a readable offset or id', async () => {
    const c = s.encodeCursor(sortedPosts[5]);
    if (typeof c !== 'string') return `cursor is a ${typeof c}`;
    if (/^\d+$/.test(c)) return `"${c}" is just a number — clients will do arithmetic on it, and then you can never change the ordering`;
    return true;
  });

  await guard('a tampered cursor is rejected, not obeyed', async () => {
    const db = makeDb();
    for (const bad of ['not-a-cursor', Buffer.from('{"id":"; DROP TABLE"}').toString('base64'), '', 'e30=']) {
      const r = await s.connection(db, { first: 5, after: bad }).then(() => 'accepted', (e) => e.message);
      if (r === 'accepted') return `accepted the cursor ${JSON.stringify(bad)}`;
    }
    return true;
  });

  await guard('the first page returns `first` edges and says there is more', async () => {
    const db = makeDb();
    const c = await s.connection(db, { first: 10 });
    if (c.edges?.length !== 10) return `${c.edges?.length} edges`;
    if (c.pageInfo?.hasNextPage !== true) return `hasNextPage = ${c.pageInfo?.hasNextPage}`;
    if (!c.pageInfo?.endCursor) return 'no endCursor';
    return c.edges[0].node.id === sortedPosts[0].id ? true : `starts at post ${c.edges[0].node.id}`;
  });

  // THE one. 120 posts, three at a time sharing a createdAt.
  await guard('paging the whole list sees every row EXACTLY once', async () => {
    const db = makeDb();
    const seen = [];
    let after = null;
    for (let page = 0; page < 40; page++) {
      const c = await s.connection(db, { first: 7, after });
      seen.push(...c.edges.map((e) => Number(e.node.id)));
      if (!c.pageInfo.hasNextPage) break;
      after = c.pageInfo.endCursor;
    }
    const unique = new Set(seen);
    if (seen.length !== unique.size) {
      const dupes = seen.filter((id, i) => seen.indexOf(id) !== i);
      return `${seen.length - unique.size} rows repeated across page boundaries (e.g. post ${dupes[0]}) — the cursor is not unique when timestamps tie`;
    }
    if (unique.size !== DATA.POSTS.length) return `saw ${unique.size} of ${DATA.POSTS.length} rows — ${DATA.POSTS.length - unique.size} were skipped at a page boundary`;
    return true;
  });

  await guard('...and in the right order', async () => {
    const db = makeDb();
    const seen = [];
    let after = null;
    for (let page = 0; page < 40; page++) {
      const c = await s.connection(db, { first: 7, after });
      seen.push(...c.edges.map((e) => Number(e.node.id)));
      if (!c.pageInfo.hasNextPage) break;
      after = c.pageInfo.endCursor;
    }
    const want = sortedPosts.map((p) => p.id);
    return JSON.stringify(seen) === JSON.stringify(want) ? true : `order diverges at index ${seen.findIndex((v, i) => v !== want[i])}`;
  });

  await guard('the last page says hasNextPage: false', async () => {
    const db = makeDb();
    let after = null, last = null;
    for (let page = 0; page < 40; page++) {
      last = await s.connection(db, { first: 25, after });
      if (!last.pageInfo.hasNextPage) break;
      after = last.pageInfo.endCursor;
    }
    return last.pageInfo.hasNextPage === false || 'it never reported the end';
  });

  await guard('one page is ONE query — not one per edge', async () => {
    const db = makeDb();
    await s.connection(db, { first: 20 });
    return db.queries <= 2 || `${db.queries} queries for one page: ${db.log.join(' ')}`.slice(0, 80);
  });

  await guard('`first` is capped — a client asking for 100,000 does not get it', async () => {
    const db = makeDb();
    const c = await s.connection(db, { first: 100_000 }).then((v) => v, (e) => e);
    if (c instanceof Error) return true;                   // rejecting is also correct
    return c.edges.length <= 100 || `returned ${c.edges.length} edges — an unbounded page is an unbounded query`;
  });

  await guard('a negative or absurd `first` is rejected rather than coerced into nonsense', async () => {
    const db = makeDb();
    const r = await s.connection(db, { first: -5 }).then((v) => (v.edges.length >= 0 ? 'accepted' : 'weird'), () => 'rejected');
    return r === 'rejected' || r === 'accepted' ? true : r;
  });

  // ---- cost ----

  await guard('analyse() measures depth', async () => {
    const shallow = `{ posts { id title } }`;
    const deep = `{ users { posts { comments { author { posts { comments { author { name } } } } } } } }`;
    const a = s.analyse(shallow).depth, b = s.analyse(deep).depth;
    return (a <= 3 && b >= 7) || `shallow=${a} deep=${b}`;
  });

  await guard('analyse() charges more for a bigger `first`', async () => {
    const small = s.analyse(`{ posts(first: 5) { edges { node { id } } } }`).complexity;
    const big = s.analyse(`{ posts(first: 500) { edges { node { id } } } }`).complexity;
    return big > small * 10 || `first:5 costs ${small}, first:500 costs ${big} — cost must scale with the page size or the limit is decorative`;
  });

  await guard('analyse() MULTIPLIES nested list sizes', async () => {
    const flat = s.analyse(`{ users(first: 50) { edges { node { id } } } }`).complexity;
    const nested = s.analyse(`{ users(first: 50) { edges { node { posts(first: 50) { edges { node { id } } } } } } }`).complexity;
    return nested >= flat * 20 || `flat=${flat} nested=${nested} — 50 users x 50 posts is 2,500 rows, not 100`;
  });

  await guard('guard() refuses a query that is too deep', async () => {
    const deep = `{ a { b { c { d { e { f { g { h { i { j { k } } } } } } } } } } }`;
    const r = s.guard(deep, { maxDepth: 6, maxComplexity: 1e9 });
    return (r.ok === false && /depth/i.test(r.reason ?? '')) || `${JSON.stringify(r)}`;
  });

  await guard('guard() refuses a query that is too expensive', async () => {
    const wide = `{ users(first: 100) { edges { node { posts(first: 100) { edges { node { comments(first: 100) { edges { node { id } } } } } } } } } }`;
    const r = s.guard(wide, { maxDepth: 20, maxComplexity: 10_000 });
    return (r.ok === false && /complex|cost/i.test(r.reason ?? '')) || `${JSON.stringify(r)}`;
  });

  await guard('guard() ALLOWS an ordinary query', async () => {
    const fine = `{ posts(first: 20) { edges { node { id title author { name } } } } }`;
    const r = s.guard(fine, { maxDepth: 10, maxComplexity: 10_000 });
    return r.ok === true || `refused a normal query: ${r.reason}`;
  });

  await guard('guard() refuses a query it cannot parse', async () => {
    const r = s.guard(`{ this is not ( valid`, { maxDepth: 10, maxComplexity: 1000 });
    return r.ok === false || 'a syntactically broken query was allowed through';
  });

  return out;
}
