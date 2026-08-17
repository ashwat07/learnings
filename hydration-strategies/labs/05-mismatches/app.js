// Lab 05 — Hydration mismatches.
//
// Each demo shows the markup the server produced next to what the client produces now, and
// highlights the difference. The server output is fixed (as it would be, having been generated
// minutes ago on another machine); the client output is generated live.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

function show(serverHTML, clientHTML) {
  $('server').textContent = serverHTML;
  $('client').textContent = clientHTML;
  const same = serverHTML === clientHTML;
  log.line(same ? 'match' : 'MISMATCH', same ? 'good' : 'bad');
  return same;
}

// A server render that happened "8 minutes ago, in UTC, on a Linux box in Frankfurt".
const SERVER_RENDER_TIME = new Date(Date.now() - 8 * 60 * 1000);

on('time', () => {
  log.head('— 1. time & dates —');
  const server = `<span>Posted 8 minutes ago</span>`;
  const client = `<span>Posted ${Math.round((Date.now() - SERVER_RENDER_TIME) / 60000)} minutes ago</span>`;
  show(server, client);
  out.textContent =
    'The server rendered "8 minutes ago". By the time the client hydrates it may be 9, or the page\n' +
    'may have been served from a cache and it is now 40.\n\n' +
    'Anything derived from the CURRENT TIME is a mismatch by construction:\n' +
    '  • relative timestamps ("3 minutes ago")\n' +
    '  • countdowns and "expires in"\n' +
    '  • "today" / "this week" labels\n' +
    '  • greetings based on the hour\n' +
    '  • anything with Date.now(), new Date(), or performance.now() in the render path\n\n' +
    'The fix is not to make the server and client agree — they cannot, and a cached page makes it\n' +
    'worse. Render the ABSOLUTE value on the server (a machine-readable timestamp), and compute\n' +
    'the relative form on the client after mount:\n\n' +
    '    <time datetime="2026-08-17T12:00:00Z">17 August 2026</time>\n' +
    '    // then, in an effect: replace the text with "8 minutes ago"\n\n' +
    'That also degrades correctly with JS disabled, and it is what <time> is for.';
});

on('random', () => {
  log.head('— 2. random values & generated ids —');
  const server = `<div id="tooltip-a1b2c3" aria-describedby="tooltip-a1b2c3">…</div>`;
  const client = `<div id="tooltip-${Math.random().toString(36).slice(2, 8)}" aria-describedby="tooltip-…">…</div>`;
  show(server, client);
  out.textContent =
    'Every randomly generated id is a mismatch, and they are everywhere: tooltips, dialogs, form\n' +
    'labels, aria-describedby, anything a component library generates to link two elements.\n\n' +
    'The consequences go beyond a warning — a broken aria-describedby link is an accessibility bug\n' +
    'that only exists in the hydrated page, so it survives every server-side test.\n\n' +
    'Fixes:\n' +
    '  • React 18+: useId(). It generates ids that are stable across server and client by deriving\n' +
    '    them from the component\'s position in the tree, which is exactly why it exists.\n' +
    '  • otherwise: derive ids from something stable — a record id, an index, a slug\n' +
    '  • never Math.random(), Date.now(), or a module-level counter (the counter starts at zero\n' +
    '    in both places and then diverges the moment rendering order differs)\n\n' +
    'Same class: shuffling an array, picking a random variant for an A/B test in the render path,\n' +
    'or seeding anything from an uninitialised value.';
});

on('locale', () => {
  log.head('— 3. locale & timezone —');
  const price = 1234.5;
  const server = `<span>€1.234,50</span>  (de-DE, Europe/Berlin — the server's locale)`;
  const client = `<span>${price.toLocaleString(undefined, { style: 'currency', currency: 'EUR' })}</span>` +
    `  (${Intl.DateTimeFormat().resolvedOptions().locale}, ${Intl.DateTimeFormat().resolvedOptions().timeZone} — yours)`;
  show(server, client);
  out.textContent =
    'The server formatted with ITS locale and timezone; the browser formats with the USER\'S. Number\n' +
    'separators, currency placement, date order and the actual DAY can all differ.\n\n' +
    'The timezone one is the nastiest, because it changes the VALUE and not just the formatting: a\n' +
    'timestamp at 23:30 UTC is "today" on the server and "tomorrow" for a user in Tokyo. A\n' +
    'mismatch warning is the good outcome; a silently wrong date is the normal one.\n\n' +
    'Fixes:\n' +
    '  • decide the locale on the SERVER from a signal you actually have (the URL, the user\'s\n' +
    '    saved preference, Accept-Language) and pass it explicitly to every format call so both\n' +
    '    sides use the same one\n' +
    '  • never rely on the ambient locale/timezone — toLocaleString() with no arguments is a\n' +
    '    different function on every machine\n' +
    '  • for timezone-dependent output, either render in a fixed zone with the zone shown, or\n' +
    '    render the absolute instant and convert on the client after mount\n' +
    '  • put the locale in the URL if it changes the content — it is a cache key (see the HTTP\n' +
    '    caching course, lab 05)';
});

on('browser', () => {
  log.head('— 4. browser-only APIs —');
  const server = `<div class="sidebar">…</div>  (server: no window, so the desktop branch)`;
  const client = window.innerWidth < 900
    ? `<div class="drawer">…</div>  (client: window.innerWidth ${window.innerWidth} → mobile branch)`
    : `<div class="sidebar">…</div>  (client: window.innerWidth ${window.innerWidth} → same branch, this time)`;
  show(server, client);
  out.textContent =
    'Any render that branches on something only the browser knows will diverge:\n' +
    '  window.innerWidth · matchMedia · localStorage (theme!) · navigator · document.cookie read\n' +
    '  client-side · IntersectionObserver state · anything in a try/catch around `window`\n\n' +
    'The classic is dark mode: the server has no idea what the user chose, so it renders light,\n' +
    'and the client renders dark. You get a mismatch AND a flash of the wrong theme.\n\n' +
    'Fixes, in order of quality:\n' +
    '  1. Move the decision to a place the server can see: a cookie the server reads, or a URL\n' +
    '     segment. Then both sides render the same thing and there is no flash at all.\n' +
    '  2. Render the neutral/server version, then correct it in an effect after mount (two-pass).\n' +
    '     Correct, but you get one frame of the wrong thing.\n' +
    '  3. For theme specifically: a tiny blocking inline script in <head> that sets a class on\n' +
    '     <html> before first paint. It is render-blocking on purpose, it is ~200 bytes, and it is\n' +
    '     the only way to avoid the flash when the server genuinely cannot know.\n' +
    '  4. CSS media queries instead of JS branching, wherever the difference is presentational —\n' +
    '     the browser applies them before paint and the server never has to guess.';
});

on('nesting', () => {
  log.head('— 5. invalid HTML nesting: a mismatch with no bug in your code —');

  // The server sends this exact string. It is what your component "rendered".
  const serverString = '<p>Intro text <div>a block inside a paragraph</div> more text</p>';

  // The browser's HTML parser applies the spec's error recovery rules, which move things.
  const host = document.createElement('div');
  host.innerHTML = serverString;
  const parsed = host.innerHTML;

  show(serverString, parsed);
  log.muted('the client did not render anything different — the PARSER moved the nodes');

  const cases = [
    ['<div> inside <p>', '<p>a<div>b</div>c</p>'],
    ['<div> inside <button>', '<button><div>x</div></button>'],
    ['<p> inside <p>', '<p>a<p>b</p></p>'],
    ['<tr> not inside <table>', '<tr><td>x</td></tr>'],
    ['<li> not inside a list', '<li>x</li>'],
    ['whitespace between <td>s', '<table><tbody><tr> <td>x</td> </tr></tbody></table>'],
  ];
  const rows = cases.map(([name, html]) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return {
      'markup you wrote': html,
      'what the DOM became': d.innerHTML,
      'same?': d.innerHTML === html ? 'yes' : 'NO',
      _sameClass: d.innerHTML === html ? 'ok' : 'no',
    };
  });
  renderTable('#results', rows, { columns: ['markup you wrote', 'what the DOM became', 'same?'] });

  out.textContent =
    'This is the mismatch that makes people doubt their sanity, because their render function is\n' +
    'perfectly deterministic.\n\n' +
    'The HTML parser is not a passive reader — it applies the spec\'s error-recovery rules and\n' +
    'RESTRUCTURES invalid markup. A <div> inside a <p> closes the paragraph. A <tr> outside a\n' +
    '<table> is dropped entirely. So the DOM the browser built is genuinely not the tree your\n' +
    'server described, and hydration compares its expectation against that rebuilt DOM.\n\n' +
    'The tells: it only happens in SSR (client-only rendering builds the tree via DOM APIs, which\n' +
    'do not apply parser recovery), and the offending component often looks fine visually.\n\n' +
    'How to find it: run your server HTML through an HTML validator, or compare\n' +
    'document.body.innerHTML against the response body. React 19 error messages now name the\n' +
    'offending tag pair, which is a large improvement over "text content did not match".';
});

on('extension', () => {
  log.head('— 6. things outside your control —');
  const server = '<body><div id="root">…</div></body>';
  const client = '<body><div id="root">…</div><div class="grammar-tool-overlay">…</div></body>';
  show(server, client);
  out.textContent =
    'Browser extensions inject nodes and attributes before your JS runs: grammar checkers, password\n' +
    'managers, ad blockers removing elements, translation tools rewriting text.\n\n' +
    'These cause real hydration warnings that you cannot fix and cannot reproduce, and they are a\n' +
    'meaningful share of the hydration errors in any production error tracker.\n\n' +
    'What to do:\n' +
    '  • test in a clean profile before believing a report\n' +
    '  • suppressHydrationWarning (React) on the specific elements that third parties touch, e.g.\n' +
    '    the <body> or a text node a translator rewrites — narrowly, never globally\n' +
    '  • treat mismatches on <body>/<html> attributes as noise; treat mismatches inside your\n' +
    '    components as bugs\n' +
    '  • do not chase a 100% clean rate: filter known-external causes in your error tracker so the\n' +
    '    real ones are visible';
});

on('fixes', () => {
  log.head('— the four fixes —');
  const table = [
    { fix: 'Make the server able to decide', how: 'cookie / URL / header the server reads',
      'use for': 'theme, locale, feature flags, A/B variant', quality: 'best — no mismatch, no flash' },
    { fix: 'Render neutral, correct after mount', how: 'useEffect / onMounted, two-pass render',
      'use for': 'anything genuinely client-only', quality: 'correct, one frame of the wrong thing' },
    { fix: 'Client-only component', how: 'dynamic import with ssr:false, <ClientOnly>',
      'use for': 'a map, an editor, anything that cannot render on the server', quality: 'no SSR benefit for that subtree' },
    { fix: 'Suppress the warning', how: 'suppressHydrationWarning on ONE element',
      'use for': 'timestamps you accept, extension-touched nodes', quality: 'last resort; it hides, it does not fix' },
  ];
  renderTable('#results', table, { columns: ['fix', 'how', 'use for', 'quality'] });
  out.textContent =
    'Ranked, because the order matters:\n\n' +
    '1. MAKE THE SERVER ABLE TO DECIDE. Most mismatches are "the server did not know something the\n' +
    '   client knows". Give it that information — a cookie, a URL segment, a header — and the\n' +
    '   mismatch disappears along with the flash of wrong content. This is nearly always available\n' +
    '   and nearly always skipped.\n\n' +
    '2. TWO-PASS: render what the server rendered, then correct it in an effect. Always correct,\n' +
    '   costs one frame and a second render.\n\n' +
    '3. CLIENT-ONLY for subtrees that genuinely cannot render on the server. You lose SSR for that\n' +
    '   subtree — which is fine for a map widget and wrong for your main content.\n\n' +
    '4. SUPPRESS the warning, on one element, when you have decided the difference is acceptable.\n' +
    '   It silences the report; it does not make the two trees agree.';
});

on('cost', () => {
  log.head('— what a mismatch costs —');
  renderTable('#results', [
    { framework: 'React 18', 'on mismatch': 'discards the server HTML for that root and re-renders on the client' },
    { framework: 'React 19', 'on mismatch': 'same recovery, much better error message (names the element, shows a diff)' },
    { framework: 'Vue 3', 'on mismatch': 'warns in dev; patches the DOM to match the client render' },
    { framework: 'Svelte / Astro', 'on mismatch': 'warns; behaviour varies by adapter and version' },
  ], { columns: ['framework', 'on mismatch'] });
  out.textContent =
    'The consequence depends on the framework and the version, and the trend is towards being\n' +
    'louder rather than quieter:\n\n' +
    'React 18: a mismatch in a hydrated tree causes React to DISCARD the server HTML for that root\n' +
    'and re-render it entirely on the client. You paid for SSR, shipped the HTML, and then threw\n' +
    'it away — the page flashes and every metric that SSR was supposed to improve gets worse.\n' +
    'React 19 improves the error messages substantially (it names the offending element and\n' +
    'shows a diff) but the recovery is the same: fall back to client rendering.\n\n' +
    'Vue: warns in development, and patches the DOM to match the client render — quieter, and it\n' +
    'can leave you with a subtly wrong DOM in production where the warning is stripped.\n\n' +
    'Svelte/SvelteKit and Astro: warn, and behaviour varies by adapter and version.\n\n' +
    'The universal points:\n' +
    '  • a mismatch means the fast path was abandoned, so the cost is exactly the SSR benefit\n' +
    '  • it is usually invisible in development, where the server and client are the same machine,\n' +
    '    same locale, same timezone, same clock\n' +
    '  • it is therefore a PRODUCTION-ONLY bug class, which is why it deserves monitoring:\n' +
    '    count hydration errors per release in your error tracker, filtered for extension noise';
});

on('clear', () => { log.clear(); $('server').textContent = '—'; $('client').textContent = '—'; });
