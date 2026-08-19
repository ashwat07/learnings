/**
 * The 20 lines of glue that graphql-js deliberately does not ship.
 *
 * `buildSchema(sdl)` gives you a schema with no resolvers; every server library (Apollo, Yoga,
 * Mercurius) then bolts a resolver map onto it. This is that step, written out, so the drills need
 * one dependency instead of four — and so you can see that a "GraphQL server" is a schema, a
 * resolver map, and an execute() call.
 */
import { buildSchema, graphql, GraphQLError } from 'graphql';

export function makeExecutableSchema(typeDefs, resolvers = {}) {
  const schema = buildSchema(typeDefs);
  for (const [typeName, fields] of Object.entries(resolvers)) {
    const type = schema.getType(typeName);
    if (!type || typeof type.getFields !== 'function') continue;
    const fieldMap = type.getFields();
    for (const [fieldName, fn] of Object.entries(fields)) {
      if (fieldMap[fieldName]) fieldMap[fieldName].resolve = fn;
    }
  }
  return schema;
}

export { graphql, GraphQLError };
