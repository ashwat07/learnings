/** @type {import('next').NextConfig} */
export default {
  // Nothing clever. The labs are about the default caching behaviour, and a config that
  // overrides it would defeat the point.
  logging: { fetches: { fullUrl: true } },   // dev-only: prints cache HIT/MISS per fetch
};
