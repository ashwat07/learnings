/**
 * The program you must predict. Read it; do not run it yet.
 *
 * Everything that matters happens INSIDE an fs.readFile callback. That is deliberate: at the top
 * level of a module, setTimeout(fn, 0) and setImmediate(fn) race — whether the first loop
 * iteration has already passed the 1ms timer threshold depends on how long the process took to
 * boot. Inside an I/O callback there is no race at all, because you know exactly which phase you
 * are standing in.
 *
 * That distinction is the whole reason this program is shaped the way it is.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function run() {
  return new Promise((resolve) => {
    const seen = [];
    const log = (s) => seen.push(s);

    fs.readFile(fileURLToPath(import.meta.url), () => {
      // --- we are now in the POLL phase, in an I/O callback ---

      setTimeout(() => log('H timeout 0'), 0);

      setImmediate(() => {
        log('E immediate');
        process.nextTick(() => log('F nextTick inside immediate'));
        Promise.resolve().then(() => log('G promise inside immediate'));
      });

      process.nextTick(() => {
        log('B nextTick');
        Promise.resolve().then(() => log('D promise queued by the nextTick'));
      });

      Promise.resolve().then(() => log('C promise'));

      log('A sync');

      setTimeout(() => resolve(seen), 40);   // just the harness stopping the clock
    });
  });
}
