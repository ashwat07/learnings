/** Drill 01 — reference. */

import crypto from 'node:crypto';

// The schema is the FIRST line of defence, and the only one that cannot be bypassed by a bug.
// passwordHash is not marked private here — it does not exist. There is no resolver to forget to
// guard, no logging change that can print it, and no future field selection that can reach it.
export const typeDefs = `
  type Team { id: ID!  name: String! }

  type Post { id: ID!  title: String!  body: String! }

  type User {
    id: ID!
    name: String!
    email: String!
    team: Team
    posts: [Post!]!
  }

  type Query {
    user(id: ID!): User
    me: User
    health: String
  }
`;

// A user-facing error: the message is part of the API and is meant to be read.
class PublicError extends Error {
  constructor(message, code) {
    super(message);
    this.extensions = { code };
    this.isPublic = true;
  }
}

export const resolvers = {
  Query: {
    async user(_parent, { id }, { db }) {
      const [u] = await db.usersByIds([id]);
      if (!u) throw new PublicError(`No user with id ${id}`, 'NOT_FOUND');
      return u;
    },
    async me(_parent, _args, { db, userId }) {
      if (!userId) throw new PublicError('Not authenticated', 'UNAUTHENTICATED');
      const [u] = await db.usersByIds([userId]);
      return u;
    },
    async health(_parent, _args, { db }) {
      return db.brokenField();
    },
  },

  User: {
    async team(user, _args, { db }) {
      const [t] = await db.teamsByIds([user.teamId]);
      return t ?? null;
    },
    async posts(user, _args, { db }) {
      return db.postsByAuthorIds([user.id]);
    },
  },
};

/*
 * The allow-list, not the deny-list. Anything explicitly marked public keeps its message;
 * EVERYTHING ELSE is replaced. A deny-list ("hide errors containing 'password'") fails the first
 * time a new dependency phrases its failure differently, which is always.
 */
export const formatError = (error) => {
  const original = error.originalError ?? error;
  const publicCode = original?.extensions?.code ?? error.extensions?.code;

  // graphql-js's own validation and syntax errors have no originalError — they are about the
  // QUERY, not about your data, so they are safe and useful to return verbatim.
  const isValidation = !error.originalError;
  if (isValidation || original?.isPublic) {
    return {
      message: error.message,
      path: error.path,
      locations: error.locations,
      extensions: { code: publicCode ?? 'BAD_USER_INPUT' },
    };
  }

  // An internal failure. The client gets a correlation id and nothing else; the id is what makes
  // "it broke" into a support conversation that can actually be resolved.
  const errorId = crypto.randomUUID();
  console.error(JSON.stringify({
    level: 'error', msg: 'graphql resolver failed', errorId,
    path: error.path?.join('.'), code: original?.code,
    error: original?.message, stack: original?.stack,
  }));

  return {
    message: 'Internal server error',
    path: error.path,
    extensions: { code: 'INTERNAL_SERVER_ERROR', errorId },
  };
};

/*
WHY GRAPHQL ERRORS ARE DIFFERENT, AND WHY IT MATTERS

REST has one status per response, so a failure is a failure. GraphQL resolves a TREE, so half of
it can succeed. That produces two things people find surprising:

  · a response can have BOTH `data` and `errors`. A client that checks `if (res.errors) return`
    throws away perfectly good data — check per field, or use the error `path`.
  · the HTTP status is 200. Your monitoring, your load balancer's error rate, and your alerting
    all see success. Instrument the `errors` array, or you will not know you are broken. This is
    the single most common observability gap in a GraphQL service.

NULL PROPAGATION — the rule that decides how much of your response survives.
If a resolver for a NON-NULL field (`String!`) errors, GraphQL cannot put null there, so it nulls
the PARENT. If the parent is also non-null, it climbs again — up to nulling `data` entirely. Hence:

  · `health: String` (nullable) means a broken health field nulls only itself
  · `health: String!` would null the whole query root, and the user query alongside it

So `!` is not "this is required", it is "if this fails, take my parent down with it". Default to
nullable on anything that can fail — especially anything that crosses a network — and reserve `!`
for values that genuinely cannot be absent.

THE OTHER THINGS EVERY REAL SERVER NEEDS
  · disable introspection in production, or at least require auth for it. The __type query the
    checks use is also how an attacker maps your entire API in one request.
  · depth and complexity limits, and persisted queries — drill 03.
  · a DataLoader per request — drill 02.
  · never trust `info` to decide authorisation. Authorise on the DATA, in the resolver, from the
    context — the same rule as the IDOR drill in auth-and-security.
*/
