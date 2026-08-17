// The entry point. How it imports its routes is the whole subject of labs 02 and 04:
//
//   STATIC   import { render } from './routes/admin.js'   → admin is in the main bundle
//   DYNAMIC  await import('./routes/admin.js')            → admin is its own chunk, loaded on demand
//
// build.mjs rewrites this file's route loading between the two, so you can measure the difference
// rather than argue about it.
import { render as renderHome } from './routes/home.js';
import { render as renderProduct } from './routes/product.js';
import { track } from './lib/analytics.js';

const routes = {
  home: (el, data) => renderHome(el, data),
  product: (el, data) => renderProduct(el, data),
  // ROUTE_ADMIN
  admin: async (el, data) => (await import('./routes/admin.js')).render(el, data),
};

export async function navigate(name, el, data) {
  track('navigate', { name });
  const route = routes[name];
  if (!route) throw new Error(`no route ${name}`);
  return route(el, data);
}

globalThis.__app = { navigate };
