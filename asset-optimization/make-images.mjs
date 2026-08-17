#!/usr/bin/env node
/**
 * make-images.mjs — generate REAL images for the asset labs.
 *
 * No dependencies. PNG is encoded here (it is just zlib-compressed scanlines plus four chunks),
 * BMP is uncompressed by definition, and JPEG/WebP/AVIF are produced by shelling out to whatever
 * the machine already has — `sips` on macOS, `cwebp`/`avifenc` if installed. Whatever is missing
 * is reported rather than faked, because the whole point of the lab is comparing real bytes.
 *
 *   node make-images.mjs                 # the default set
 *   node make-images.mjs --clean
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'images');

if (process.argv.includes('--clean')) {
  if (existsSync(dir)) { rmSync(dir, { recursive: true }); console.log(`removed ${dir}`); }
  else console.log('nothing to clean');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Pixel source: a photo-like gradient with deterministic noise, so encoders have
// something real to work on. A flat colour would compress to nothing and prove nothing.
// ---------------------------------------------------------------------------

function paint(x, y, w, h, seed) {
  const nx = x / w, ny = y / h;
  // Mild noise: enough that the encoders have real work to do, not so much that the image
  // stops resembling a photograph (heavy noise is pathological for JPEG and would make the
  // format comparison misleading).
  const noise = ((x * 2654435761 + y * 40503 + seed * 7919) % 14) - 7;
  const t = (Math.sin((nx * 5 + ny * 3 + seed) * 1.9) + 1) / 2;
  const clamp = (v) => Math.max(0, Math.min(255, v | 0));
  return [
    clamp(30 + 210 * t * (0.4 + nx * 0.8) + noise),
    clamp(40 + 190 * (1 - t) * (0.3 + ny) + noise),
    clamp(70 + 150 * ((seed / 6 + t) % 1) + noise),
  ];
}

// ---------------------------------------------------------------------------
// PNG
//
// signature + IHDR + IDAT + IEND. Each scanline is prefixed with a filter byte; filter 1
// (Sub) is used because it compresses a horizontal gradient far better than filter 0, which
// is exactly the kind of choice a real encoder makes for you.
// ---------------------------------------------------------------------------

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function png(width, height, seed, { level = 9 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 2;      // colour type 2 = truecolour RGB
  ihdr[10] = 0;     // deflate
  ihdr[11] = 0;     // adaptive filtering
  ihdr[12] = 0;     // no interlace

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 1;                                   // filter: Sub
    let prevR = 0, prevG = 0, prevB = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y, width, height, seed);
      const p = rowStart + 1 + x * 3;
      raw[p] = (r - prevR) & 0xff;
      raw[p + 1] = (g - prevG) & 0xff;
      raw[p + 2] = (b - prevB) & 0xff;
      prevR = r; prevG = g; prevB = b;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 24-bit BMP: uncompressed, so its size is exactly width × height × 3 (+ padding). */
function bmp(width, height, seed) {
  const rowBytes = width * 3;
  const padding = (4 - (rowBytes % 4)) % 4;
  const stride = rowBytes + padding;
  const pixels = stride * height;
  const buf = Buffer.alloc(54 + pixels);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(54 + pixels, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixels, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y, width, height, seed);
      const p = row + x * 3;
      buf[p] = b; buf[p + 1] = g; buf[p + 2] = r;
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Optional converters
// ---------------------------------------------------------------------------

function has(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

const tools = { sips: has('sips'), cwebp: has('cwebp'), avifenc: has('avifenc') };

function convert(srcPng, outPath, kind, quality = 75) {
  try {
    if (kind === 'jpeg' && tools.sips) {
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality),
        srcPng, '--out', outPath], { stdio: 'ignore' });
      return true;
    }
    if (kind === 'webp' && tools.cwebp) {
      execFileSync('cwebp', ['-quiet', '-q', String(quality), srcPng, '-o', outPath], { stdio: 'ignore' });
      return true;
    }
    if (kind === 'avif' && tools.avifenc) {
      execFileSync('avifenc', ['-q', String(quality), srcPng, outPath], { stdio: 'ignore' });
      return true;
    }
  } catch { /* fall through */ }
  return false;
}

// ---------------------------------------------------------------------------

mkdirSync(dir, { recursive: true });

const WIDTHS = [400, 800, 1200, 2000];
const made = [];

console.log('generating…\n');

// 1. One hero image at several widths, in every format we can produce. This is the responsive
//    image set the labs use, and the raw material for the format comparison.
for (const w of WIDTHS) {
  const h = Math.round(w * 0.5625);            // 16:9
  const pngPath = join(dir, `hero-${w}.png`);
  writeFileSync(pngPath, png(w, h, 3));
  made.push(pngPath);

  for (const [kind, ext] of [['jpeg', 'jpg'], ['webp', 'webp'], ['avif', 'avif']]) {
    const outPath = join(dir, `hero-${w}.${ext}`);
    if (convert(pngPath, outPath, kind)) made.push(outPath);
  }
}

// 2. The uncompressed baseline, so "why does format matter" has a number attached.
const bmpPath = join(dir, 'hero-1200.bmp');
writeFileSync(bmpPath, bmp(1200, 675, 3));
made.push(bmpPath);

// 3. A thumbnail set for the loading labs.
for (let i = 0; i < 12; i++) {
  const p = join(dir, `thumb-${i}.png`);
  writeFileSync(p, png(320, 180, i + 10));
  made.push(p);
  const jpg = join(dir, `thumb-${i}.jpg`);
  if (convert(p, jpg, 'jpeg', 70)) made.push(jpg);
}

// ---------------------------------------------------------------------------

const size = (p) => statSync(p).size;
const fmt = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

console.log('hero at 1200px wide:');
for (const ext of ['bmp', 'png', 'jpg', 'webp', 'avif']) {
  const p = join(dir, `hero-1200.${ext}`);
  if (existsSync(p)) {
    const base = size(join(dir, 'hero-1200.bmp'));
    console.log(`  ${ext.padEnd(5)} ${fmt(size(p)).padStart(10)}   ${(size(p) / base * 100).toFixed(1)}% of uncompressed`);
  } else {
    console.log(`  ${ext.padEnd(5)} ${'—'.padStart(10)}   not generated (no encoder on this machine)`);
  }
}

console.log(`\n${made.length} files in ${dir}`);
console.log(`\nencoders found: ${Object.entries(tools).map(([k, v]) => `${k}=${v ? 'yes' : 'no'}`).join(' ')}`);
if (!tools.cwebp || !tools.avifenc) {
  console.log('\nFor the full format comparison, install what is missing:');
  if (!tools.cwebp) console.log('  brew install webp        # gives you cwebp');
  if (!tools.avifenc) console.log('  brew install libavif     # gives you avifenc');
  console.log('The labs work without them — the missing rows are simply reported as unavailable,');
  console.log('which is more useful than inventing numbers.');
}
console.log('\nNext: ./serve.sh   then open /asset-optimization/labs/01-images/');
console.log('When you are done: node make-images.mjs --clean');
