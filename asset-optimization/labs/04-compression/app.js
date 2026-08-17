// Lab 04 — Compression.
//
// The server compresses explicitly (see /api/text in server.mjs) and reports both the encode
// time and the uncompressed length, so the trade is visible from the page.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

async function probe(encoding, level) {
  const url = `/api/text?kind=${$('kind').value}&bytes=${$('bytes').value}` +
    `&encoding=${encoding}${level ? `&level=${level}` : ''}&t=${Math.random()}`;
  const t0 = performance.now();
  const res = await fetch(url, { cache: 'no-store' });
  await res.arrayBuffer();
  const wall = performance.now() - t0;

  return {
    encoding,
    level: level ?? '(default)',
    raw: Number(res.headers.get('x-uncompressed-length')),
    sent: Number(res.headers.get('content-length')),
    encodeMs: Number(res.headers.get('x-encode-ms')),
    wall,
  };
}

on('compare', async () => {
  log.head(`— ${$('kind').value}, ${fmt.bytes(Number($('bytes').value))} —`);
  const rows = [];
  for (const enc of ['identity', 'gzip', 'br']) {
    const r = await probe(enc);
    rows.push({
      encoding: enc,
      'bytes sent': fmt.bytes(r.sent),
      'ratio': `${((r.sent / r.raw) * 100).toFixed(1)}%`,
      'saved': fmt.bytes(r.raw - r.sent),
      'encode ms': r.encodeMs.toFixed(1),
      'transfer at 4G (1.5 MB/s)': `${Math.round((r.sent / 1_500_000) * 1000)}ms`,
      _ratioClass: r.sent / r.raw < 0.3 ? 'ok' : r.sent / r.raw < 0.8 ? 'meh' : 'no',
    });
    log.line(`${enc.padEnd(9)} ${fmt.bytes(r.sent).padStart(10)}  ${((r.sent / r.raw) * 100).toFixed(1)}%  ` +
      `encode ${r.encodeMs.toFixed(1)}ms`, r.sent / r.raw < 0.5 ? 'good' : 'macro');
    renderTable('#results', rows, {
      columns: ['encoding', 'bytes sent', 'ratio', 'saved', 'encode ms', 'transfer at 4G (1.5 MB/s)'],
    });
  }

  const gzip = rows.find((r) => r.encoding === 'gzip');
  const br = rows.find((r) => r.encoding === 'br');

  out.textContent = $('kind').value === 'random'
    ? 'Already-compressed bytes: the ratio is ~100% or slightly WORSE than the original, and you\n' +
      'paid CPU for it.\n\n' +
      'This is why you exclude images, video, fonts (woff2 is already brotli-compressed), and\n' +
      'archives from compression. A misconfigured server that gzips a JPEG spends CPU on every\n' +
      'request to add bytes — and on a busy origin that is measurable.\n\n' +
      'Compress: HTML, CSS, JS, JSON, SVG, XML, plain text, source maps.\n' +
      'Do not compress: JPEG/PNG/WebP/AVIF, woff2, MP4, zip/gz.'
    : `gzip cuts this to ${gzip.ratio}; brotli to ${br.ratio}.\n\n` +
      'Two things worth internalising:\n\n' +
      '1. The RATIO depends on repetitiveness, not on size. Structured JSON with repeated keys\n' +
      '   compresses to a few percent; already-random data does not compress at all. That is why\n' +
      '   "our API returns 2MB of JSON" is usually a smaller problem than it sounds — and why the\n' +
      '   fix is still to send less, because the client still has to PARSE all of it.\n\n' +
      '2. Brotli beats gzip by roughly 15–25% on text, at a higher CPU cost that only matters for\n' +
      '   dynamic responses. For STATIC files you precompress at build time and the cost is zero\n' +
      '   forever — there is no reason to serve a static file with anything less than brotli 11.';
});

on('levels', async () => {
  log.head('— level sweep: where is the knee? —');
  const rows = [];
  for (const [enc, levels] of [['gzip', [1, 6, 9]], ['br', [1, 4, 5, 9, 11]]]) {
    for (const level of levels) {
      const r = await probe(enc, level);
      rows.push({
        encoding: enc,
        level,
        'bytes sent': fmt.bytes(r.sent),
        ratio: `${((r.sent / r.raw) * 100).toFixed(1)}%`,
        'encode ms': r.encodeMs.toFixed(1),
        'ms per KB saved': ((r.encodeMs / ((r.raw - r.sent) / 1024)) || 0).toFixed(3),
      });
      renderTable('#results', rows, {
        columns: ['encoding', 'level', 'bytes sent', 'ratio', 'encode ms', 'ms per KB saved'],
      });
    }
  }

  out.textContent =
    'The classic shape: most of the compression comes from the low levels, and the top levels cost\n' +
    'disproportionate CPU for a few more percent.\n\n' +
    'Which gives you two different answers depending on WHEN you compress:\n\n' +
    '  DYNAMIC responses (compressed per request): gzip 6 or brotli 4–5. The CPU is on your\n' +
    '    critical path — every millisecond of encoding is a millisecond of TTFB, per request, per\n' +
    '    user. Brotli 11 on a dynamic response can cost hundreds of milliseconds and is a classic\n' +
    '    self-inflicted latency bug.\n\n' +
    '  STATIC files (compressed once at build time): brotli 11, always. You pay once, ship the\n' +
    '    .br file, and every user gets the smallest possible bytes forever. If your server has\n' +
    '    gzip_static/brotli_static (or your CDN does it), turn it on.\n\n' +
    'The failure mode to avoid: compressing static assets at request time at level 11, which is\n' +
    'the worst of both — maximum CPU, repeated for every request, for a file that never changes.';
});

on('what', () => {
  renderTable('#results', [
    { asset: 'HTML', compress: 'YES', note: 'the response everything else waits on' },
    { asset: 'CSS, JS', compress: 'YES', note: 'precompress with brotli 11 at build time' },
    { asset: 'JSON APIs', compress: 'YES', note: 'usually the biggest ratio of anything you serve' },
    { asset: 'SVG', compress: 'YES', note: 'it is XML — often 70%+' },
    { asset: 'source maps', compress: 'YES', note: 'huge and highly compressible' },
    { asset: 'JPEG / PNG / WebP / AVIF', compress: 'no', note: 'already compressed; gzip ADDS bytes' },
    { asset: 'woff2', compress: 'no', note: 'woff2 IS brotli-compressed internally' },
    { asset: 'MP4 / audio', compress: 'no', note: 'already compressed, and range requests matter more' },
    { asset: 'zip / gz / tar.gz', compress: 'no', note: 'obviously' },
    { asset: 'anything under ~1KB', compress: 'no', note: 'the header and framing overhead exceeds the saving' },
  ], { columns: ['asset', 'compress', 'note'] });

  out.textContent =
    'Two operational details that catch people:\n\n' +
    '1. `Vary: Accept-Encoding` is MANDATORY on any compressed response. Without it, a cache can\n' +
    '   serve gzipped bytes to a client that did not ask for them — garbage on screen. (HTTP\n' +
    '   caching course, lab 05.)\n\n' +
    '2. Compression + secrets = BREACH/CRIME. If a response contains both attacker-influenced\n' +
    '   input and a secret (a CSRF token), compression ratios leak information about the secret.\n' +
    '   Mitigations: do not reflect user input next to secrets, rotate tokens per request, or mask\n' +
    '   them. It is a real attack, not a theoretical one — and it is the reason TLS-level\n' +
    '   compression was removed entirely.\n\n' +
    'And the thing compression does not fix: PARSE time. A 2MB JSON payload that gzips to 60KB is\n' +
    'still 2MB of parsing on the main thread (see the web-workers course). Compression saves\n' +
    'network, not CPU.';
});

on('clear', () => { log.clear(); $('#results').textContent = ''; });
