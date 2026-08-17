// Lab 05 — The RSC model.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

async function bytesOf(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  return { text, bytes: new TextEncoder().encode(text).length, res };
}

on('wire', async () => {
  log.clear();
  log.head('— the same page, three wire formats —');

  const ssr = await bytesOf('/render/ssr-par/product/3');
  const rsc = await bytesOf('/render/rsc/product/3');
  const csr = await bytesOf('/render/csr/product/3');

  // For CSR and RSC, the document is only part of the story: the client also needs JS, and for
  // CSR it then needs data. Measure all three legs.
  const clientJs = await bytesOf('/shared/app/client.js');
  const rscJs = await bytesOf('/shared/app/rsc-client.js');
  const templates = await bytesOf('/shared/app/templates.js');
  const islands = await bytesOf('/shared/app/islands.js');
  const dataLegs = await Promise.all([
    bytesOf('/api/data/product/3?delay=0'),
    bytesOf('/api/data/recommends/3?delay=0'),
    bytesOf('/api/data/reviews/3?delay=0'),
  ]);
  const dataBytes = dataLegs.reduce((a, d) => a + d.bytes, 0);

  const flight = rsc.text.match(/<script id="flight"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const flightBytes = new TextEncoder().encode(flight).length;

  const rows = [
    {
      strategy: 'ssr',
      'document': fmt.bytes(ssr.bytes),
      'client JS needed': fmt.bytes(islands.bytes),
      'extra data requests': '0 B',
      'total to first paint': fmt.bytes(ssr.bytes),
      'round trips to paint': 1,
    },
    {
      strategy: 'rsc',
      'document': `${fmt.bytes(rsc.bytes)} (payload ${fmt.bytes(flightBytes)})`,
      'client JS needed': fmt.bytes(rscJs.bytes + templates.bytes + islands.bytes),
      'extra data requests': '0 B',
      'total to first paint': fmt.bytes(rsc.bytes + rscJs.bytes + templates.bytes),
      'round trips to paint': 2,
    },
    {
      strategy: 'csr',
      'document': fmt.bytes(csr.bytes),
      'client JS needed': fmt.bytes(clientJs.bytes + templates.bytes + islands.bytes),
      'extra data requests': fmt.bytes(dataBytes),
      'total to first paint': fmt.bytes(csr.bytes + clientJs.bytes + templates.bytes + dataBytes),
      'round trips to paint': 3,
    },
  ];
  renderTable('#results', rows, {
    columns: ['strategy', 'document', 'client JS needed', 'extra data requests', 'total to first paint', 'round trips to paint'],
  });

  log.line(`ssr document ${fmt.bytes(ssr.bytes)} · rsc payload ${fmt.bytes(flightBytes)} · csr shell ${fmt.bytes(csr.bytes)}`, 'macro');

  out.textContent =
    'The column that decides the argument is "round trips to paint", not bytes:\n\n' +
    '  ssr  1 — the HTML IS the paint. Nothing else is required.\n' +
    '  rsc  2 — document, then the renderer JS. The payload is not paintable.\n' +
    '  csr  3 — document, then JS, then data. Each leg is a full round trip on the network.\n\n' +
    'On a 150ms-RTT connection those extra legs are 150ms and 300ms of dead time that no amount of\n' +
    'byte-shaving removes. This is why "our JSON is smaller than your HTML" is not the argument\n' +
    'people think it is.\n\n' +
    'What RSC actually buys is on the other side of the wire, and this table cannot show it:\n' +
    '  • the data-fetching code, its dependencies and its secrets never ship\n' +
    '  • a server component costs ZERO client JS, no matter how big it is\n' +
    '  • the payload is diffable, so a navigation can update part of a tree (next demo)\n\n' +
    'Note also that real RSC STREAMS its payload, so it is closer to "1.5 round trips" than 2 —\n' +
    'the client can start rendering the parts that have arrived. This sandbox sends it in one\n' +
    'blob to keep the model readable.';
});

on('boundary', async () => {
  log.clear();
  log.head('— the client boundary, and why it leaks —');

  // A realistic dependency-weight table. The point is the shape, not the exact numbers.
  const deps = [
    { module: 'date formatting library', kb: 22, usedBy: 'a server component that formats a date' },
    { module: 'markdown renderer', kb: 48, usedBy: 'a server component rendering a description' },
    { module: 'database client', kb: 180, usedBy: 'the data layer' },
    { module: 'a chart component', kb: 96, usedBy: 'a client component (interactive)' },
    { module: 'the cart button', kb: 3, usedBy: 'a client component (interactive)' },
  ];

  const serverOnly = deps.filter((d) => d.usedBy.startsWith('a server') || d.usedBy.includes('data layer'));
  const clientNeeded = deps.filter((d) => d.usedBy.startsWith('a client'));

  renderTable('#results', [
    ...deps.map((d) => ({ module: d.module, KB: d.kb, 'used by': d.usedBy,
      'ships to the browser?': d.usedBy.startsWith('a client') ? 'YES' : 'no',
      _shipsClass: d.usedBy.startsWith('a client') ? 'meh' : 'ok' })),
  ], { columns: ['module', 'KB', 'used by', 'ships to the browser?'] });

  const saved = serverOnly.reduce((a, d) => a + d.kb, 0);
  const shipped = clientNeeded.reduce((a, d) => a + d.kb, 0);

  log.ok(`stays on the server: ${saved}KB`);
  log.line(`ships to the browser: ${shipped}KB`, 'macro');

  out.textContent =
    `${saved}KB never leaves the server; ${shipped}KB ships because it is genuinely interactive.\n\n` +
    'That is the RSC pitch, and it is a real one — a markdown renderer or a date library used only\n' +
    'for server-rendered output is pure server cost.\n\n' +
    'Now the failure mode, which you will meet in every real Next.js codebase:\n\n' +
    'The boundary is ONE-WAY. Once a module is in a client component, everything it imports comes\n' +
    'with it. So putting "use client" at the top of a shared utility file — or a barrel file that\n' +
    're-exports forty things — drags all of it into the bundle. That single line is often the most\n' +
    'expensive line of code in the app, and nothing in the type system tells you.\n\n' +
    'The habits that keep the boundary tight:\n' +
    '  • push "use client" as far DOWN the tree as possible: a client leaf, not a client page\n' +
    '  • never put "use client" in a barrel/index file\n' +
    '  • pass server-rendered markup INTO client components as children, rather than importing\n' +
    '    server logic into them\n' +
    '  • only serialisable props cross the boundary — no functions, no class instances, no Dates\n' +
    '    in some versions. The error message when you get this wrong is much better than it used\n' +
    '    to be, but the constraint is permanent (it is the structured-clone problem from the\n' +
    '    web-workers course, again)\n' +
    '  • measure it: a bundle analyser is the only way to see what crossed. That is the\n' +
    '    bundle-strategy course.';
});

on('nav', async () => {
  log.clear();
  log.head('— navigation: re-render the tree, or re-request the document? —');

  const full = await bytesOf('/render/ssr-par/product/7');
  const rsc = await bytesOf('/render/rsc/product/7');
  const flight = rsc.text.match(/<script id="flight"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const flightBytes = new TextEncoder().encode(flight).length;

  renderTable('#results', [
    { navigation: 'full document (MPA / plain SSR)', bytes: fmt.bytes(full.bytes),
      'what the client does': 'discards everything and reparses; scroll and state are gone' },
    { navigation: 'RSC payload only', bytes: fmt.bytes(flightBytes),
      'what the client does': 'diffs into the existing tree; client state survives' },
  ], { columns: ['navigation', 'bytes', 'what the client does'] });

  out.textContent =
    'This is the part of the RSC model that is genuinely hard to get any other way.\n\n' +
    'On a client-side navigation, the framework requests the PAYLOAD, not the document, and merges\n' +
    'it into the tree that is already mounted. Consequences:\n' +
    '  • layouts that did not change are not re-rendered or re-fetched\n' +
    '  • client component state (an open dropdown, a half-filled form, video playback) survives\n' +
    '  • scroll position is under the framework\'s control rather than the browser\'s\n' +
    '  • the payload is smaller than the equivalent HTML, and much smaller than "HTML + the JS to\n' +
    '    hydrate it"\n\n' +
    'The cost is that you now own routing, and the router has a cache with its own staleness rules\n' +
    'that will surprise you — which is exactly the nextjs-caching course, lab 04. A user clicking\n' +
    '"back" and seeing 30-second-old data is that cache, not your data layer.\n\n' +
    'And the honest comparison: a plain MPA with good caching and a small page gets most of the\n' +
    'perceived speed with none of the router. Cross-document view transitions and speculation\n' +
    'rules (resource-hints lab 04) close much of the remaining gap. Choose the router when you\n' +
    'genuinely need surviving client state across navigations — not by default.';
});

on('clear', () => { log.clear(); $('#results').textContent = ''; });
