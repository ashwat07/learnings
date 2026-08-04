#!/usr/bin/env node
// Generates deliberately huge, uncompressed images for Lab 11.
//
// BMP is used on purpose: it's uncompressed, so the file size is exactly
// width × height × 3 bytes, every browser decodes it, and no encoder library is needed.
// That gives you a clean, predictable "before" measurement.
//
//   node make-images.mjs                 # 20 images, 1600×1200 (~5.7MB each, ~115MB total)
//   node make-images.mjs --count 8       # fewer, if disk is tight
//   node make-images.mjs --width 2400 --height 1800
//   node make-images.mjs --clean         # delete images/

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'images');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};

if (args.includes('--clean')) {
  if (existsSync(dir)) { rmSync(dir, { recursive: true }); console.log(`removed ${dir}`); }
  else console.log('nothing to clean');
  process.exit(0);
}

const COUNT = flag('count', 20);
const WIDTH = flag('width', 1600);   // 1600×3 = 4800 bytes/row → already 4-byte aligned
const HEIGHT = flag('height', 1200);

/** Minimal 24-bit BMP encoder. Rows are stored bottom-up and padded to 4 bytes. */
function bmp(width, height, paint) {
  const rowBytes = width * 3;
  const padding = (4 - (rowBytes % 4)) % 4;
  const stride = rowBytes + padding;
  const pixelBytes = stride * height;
  const fileSize = 54 + pixelBytes;

  const buf = Buffer.alloc(fileSize);
  // BITMAPFILEHEADER
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);
  // BITMAPINFOHEADER
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);            // planes
  buf.writeUInt16LE(24, 28);           // bits per pixel
  buf.writeUInt32LE(0, 30);            // BI_RGB, no compression
  buf.writeUInt32LE(pixelBytes, 34);
  buf.writeInt32LE(2835, 38);          // 72 DPI
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y++) {
    // BMP rows are bottom-up.
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const p = row + x * 3;
      buf[p] = b; buf[p + 1] = g; buf[p + 2] = r;   // BMP stores BGR
    }
  }
  return buf;
}

mkdirSync(dir, { recursive: true });

let total = 0;
for (let i = 0; i < COUNT; i++) {
  const hue = (i / COUNT) * 360;
  const buf = bmp(WIDTH, HEIGHT, (x, y) => {
    // A gradient plus deterministic noise, so the image has real detail (and so an
    // encoder can't compress it to nothing when you convert it later).
    const nx = x / WIDTH, ny = y / HEIGHT;
    const noise = ((x * 2654435761 + y * 40503) % 64) - 32;
    const t = (Math.sin((nx * 6 + ny * 4 + i) * 1.7) + 1) / 2;
    const r = Math.max(0, Math.min(255, 40 + 200 * t * nx + noise));
    const g = Math.max(0, Math.min(255, 40 + 200 * (1 - t) * ny + noise));
    const b = Math.max(0, Math.min(255, 60 + 160 * ((hue / 360 + t) % 1) + noise));
    return [r | 0, g | 0, b | 0];
  });
  const name = `photo-${String(i + 1).padStart(2, '0')}.bmp`;
  writeFileSync(join(dir, name), buf);
  total += buf.length;
  process.stdout.write(`\r${name}  (${(total / 1048576).toFixed(1)} MB written)`);
}

console.log(`\n\n${COUNT} images at ${WIDTH}×${HEIGHT} → ${(total / 1048576).toFixed(1)} MB in ${dir}`);
console.log(`Decoded, each one occupies ${((WIDTH * HEIGHT * 4) / 1048576).toFixed(1)} MB of bitmap memory`);
console.log(`— so all ${COUNT} decoded at once is about ${((COUNT * WIDTH * HEIGHT * 4) / 1048576).toFixed(0)} MB.`);
console.log(`That gap between file size and memory is the point of the lab.\n`);
console.log('Next: cd ../.. && ./serve.sh   then open /labs/11-image-disaster/');
console.log('When you are done: node make-images.mjs --clean');
