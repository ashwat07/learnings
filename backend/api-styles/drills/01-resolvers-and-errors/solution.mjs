/**
 * Drill 01 — schema, resolvers, and error masking.
 *
 * The starting point is what a first GraphQL server looks like: the schema mirrors the database
 * table, every field is exposed, resolvers throw whatever the database threw, and there is no
 * formatError at all.
 *
 * Export three things:
 *
 *   typeDefs      the SDL. This is your API's contract AND its access-control surface.
 *   resolvers     { TypeName: { fieldName(parent, args, context, info) } }
 *   formatError   (error) => error   the last chance to stop an internal message reaching a client
 *
 * The context you are given is { db, userId }. `db` is the world in ../../world.mjs; read it.
 *
 * Queries the checks use:
 *   user(id: ID!): User
 *   me: User
 *   health: String        — always fails, on purpose
 * and on User: id, name, email, team, posts.
 */

export const typeDefs = `
  type Team { id: ID!  name: String! }

  type Post { id: ID!  title: String!  body: String! }

  type User {
    id: ID!
    name: String!
    email: String!
    passwordHash: String!
    team: Team
    posts: [Post!]!
  }

  type Query {
    user(id: ID!): User
    me: User
    health: String
  }
`;

export const resolvers = {
  Query: {
    async user(_parent, { id }, { db }) {
      const [u] = await db.usersByIds([id]);
      return u;
    },
    async me(_parent, _args, { db, userId }) {
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
      return t;
    },
    async posts(user, _args, { db }) {
      return db.postsByAuthorIds([user.id]);
    },
  },
};

// No masking at all: whatever the resolver threw goes to the client, message and all.
export const formatError = (error) => error;
