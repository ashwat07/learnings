import { makeDb } from '../../world.mjs';
import { makeExecutableSchema, graphql } from '../../graphql-lib.mjs';

export const title = 'A schema, resolvers, and errors that do not leak';
export const task = `Write the schema and the resolvers for a small API, then make its errors
safe to send to a stranger.

GraphQL's default error behaviour is the problem: an exception in a resolver is serialised into
the response with its MESSAGE INTACT. So a connection string, a failed query with its parameters,
or a stack trace goes straight to whoever asked. Every GraphQL server needs a formatError, and
most of them get written after the first incident.

You export: typeDefs, resolvers, and formatError(error).`;
export const passIf = 'the queries resolve, no password hash exists in the schema at all, and an internal failure is masked while a user error is not';

const run = (s, query, { variables, context } = {}) =>
  graphql({
    schema: makeExecutableSchema(s.typeDefs, s.resolvers),
    source: query,
    variableValues: variables,
    contextValue: context,
  }).then((res) => ({
    data: res.data,
    errors: (res.errors ?? []).map((e) => (s.formatError ? s.formatError(e) : e)),
  }));

export async function check(s) {
  if (!s.typeDefs || !s.resolvers) {
    return [{ check: 'exports typeDefs and resolvers', actual: 'missing', pass: false }];
  }
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 64), pass: false }); }
  };

  await guard('a flat query resolves', async () => {
    const db = makeDb();
    const r = await run(s, `{ user(id: 3) { id name email } }`, { context: { db, userId: 3 } });
    if (r.errors.length) return `errors: ${JSON.stringify(r.errors[0]).slice(0, 60)}`;
    const u = r.data?.user;
    return (u?.id === '3' || u?.id === 3) && u?.name === 'user-3' && u?.email === 'user3@example.com'
      ? true : JSON.stringify(u);
  });

  await guard('a nested field resolves through a second type', async () => {
    const db = makeDb();
    const r = await run(s, `{ user(id: 7) { name team { id name } } }`, { context: { db, userId: 7 } });
    if (r.errors.length) return `errors: ${r.errors[0].message}`;
    return r.data?.user?.team?.name === 'team-2' ? true : JSON.stringify(r.data);
  });

  await guard('a list field resolves', async () => {
    const db = makeDb();
    const r = await run(s, `{ user(id: 1) { posts { id title } } }`, { context: { db, userId: 1 } });
    if (r.errors.length) return `errors: ${r.errors[0].message}`;
    const posts = r.data?.user?.posts;
    return Array.isArray(posts) && posts.length === 3 && posts[0].title === 'post-1'
      ? true : `got ${posts?.length} posts`;
  });

  await guard('variables work', async () => {
    const db = makeDb();
    const r = await run(s, `query U($id: ID!) { user(id: $id) { name } }`,
      { variables: { id: '12' }, context: { db, userId: 12 } });
    return r.data?.user?.name === 'user-12' ? true : JSON.stringify(r.data ?? r.errors[0]);
  });

  await guard('a missing user is null, with an error the client can branch on', async () => {
    const db = makeDb();
    const r = await run(s, `{ user(id: 9999) { name } }`, { context: { db, userId: 1 } });
    const nulled = r.data?.user === null || r.data === null;
    const coded = r.errors.length > 0 && (r.errors[0].extensions?.code ?? '').toString().length > 0;
    return (nulled && coded) || `data=${JSON.stringify(r.data)} errors=${JSON.stringify(r.errors).slice(0, 70)}`;
  });

  // The schema IS the access control surface. A field you never expose cannot be leaked by a
  // resolver bug, a logging change, or a junior adding `...on User { __typename }`.
  await guard('passwordHash does not exist in the schema at all', async () => {
    const r = await run(s, `{ __type(name: "User") { fields { name } } }`, { context: { db: makeDb(), userId: 1 } });
    const names = (r.data?.__type?.fields ?? []).map((f) => f.name);
    if (!names.length) return 'no User type found';
    return names.includes('passwordHash') || names.includes('password')
      ? `User exposes ${names.filter((n) => /pass/i.test(n)).join(', ')}` : true;
  });

  await guard('an unknown field is a validation error, not a crash', async () => {
    const r = await run(s, `{ user(id: 1) { nonsense } }`, { context: { db: makeDb(), userId: 1 } });
    return r.errors.length > 0 ? true : 'the query was accepted';
  });

  // The one this drill exists for.
  await guard('an internal failure is MASKED: no secret, no stack', async () => {
    const db = makeDb();
    const r = await run(s, `{ health }`, { context: { db, userId: 1 } });
    if (!r.errors.length) return 'the failing field produced no error at all';
    const blob = JSON.stringify(r.errors);
    if (/hunter2|svc_api|shard 3/.test(blob)) return `the message leaked: ${r.errors[0].message}`.slice(0, 80);
    if (/\bat .*\.mjs:/.test(blob)) return 'a stack trace leaked into the response';
    return true;
  });

  await guard('...but it still carries a code and an id you can grep the logs for', async () => {
    const db = makeDb();
    const r = await run(s, `{ health }`, { context: { db, userId: 1 } });
    const ext = r.errors[0]?.extensions ?? {};
    const hasCode = typeof ext.code === 'string' && ext.code.length > 0;
    const hasId = Object.entries(ext).some(([k, v]) => /id|ref|trace/i.test(k) && String(v).length >= 6);
    return (hasCode && hasId) || `extensions = ${JSON.stringify(ext)}`;
  });

  await guard('a partial failure still returns the fields that worked', async () => {
    const db = makeDb();
    const r = await run(s, `{ health user(id: 5) { name } }`, { context: { db, userId: 5 } });
    return r.data?.user?.name === 'user-5' ? true :
      `data = ${JSON.stringify(r.data)} — one broken field must not null the whole response`;
  });

  await guard('context is threaded: `me` resolves from the caller, not an argument', async () => {
    const db = makeDb();
    const a = await run(s, `{ me { id name } }`, { context: { db, userId: 4 } });
    const b = await run(s, `{ me { id name } }`, { context: { db, userId: 21 } });
    return (a.data?.me?.name === 'user-4' && b.data?.me?.name === 'user-21')
      ? true : `${a.data?.me?.name} / ${b.data?.me?.name}`;
  });

  return out;
}
