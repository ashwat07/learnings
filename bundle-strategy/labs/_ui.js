/**
 * _ui.js — shared browser-side view over the build metafiles, so the CLI labs have something
 * to look at without leaving the browser. Everything here is also available from
 * `node analyse.mjs <variant>`; this is the same data, rendered.
 */
import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const DIST = '/bundle-strategy/dist';

export async function loadMeta(variant) {
  const res = await fetch(`${DIST}/${variant}/meta.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`no metafile for "${variant}" — run: cd bundle-strategy && node build.mjs --all`);
  return res.json();
}

/** The initial download: the entry plus everything it statically imports, transitively. */
export function eagerOutputs(meta) {
  const outputs = meta.outputs;
  const eager = new Set();
  const roots = Object.keys(outputs).filter((f) => /(^|\/)main\.js$/.test(outputs[f].entryPoint || ''));
  const visit = (f) => {
    if (!f || eager.has(f) || !outputs[f]) return;
    eager.add(f);
    for (const imp of outputs[f].imports || []) if (imp.kind === 'import-statement') visit(imp.path);
  };
  for (const r of roots.length ? roots : Object.keys(outputs)) visit(r);
  return eager;
}

export function summarise(meta) {
  const eager = eagerOutputs(meta);
  const initial = [...eager].reduce((a, f) => a + meta.outputs[f].bytes, 0);
  const total = Object.values(meta.outputs).reduce((a, o) => a + o.bytes, 0);
  return { initial, total, files: Object.keys(meta.outputs).length, eager };
}

export function moduleTable(meta) {
  const eager = eagerOutputs(meta);
  const modules = new Map();
  for (const [file, o] of Object.entries(meta.outputs)) {
    for (const [input, info] of Object.entries(o.inputs || {})) {
      const cur = modules.get(input) ?? { bytes: 0, initial: false, files: new Set() };
      cur.bytes += info.bytesInOutput;
      cur.initial = cur.initial || eager.has(file);
      cur.files.add(file);
      modules.set(input, cur);
    }
  }
  return [...modules]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .map(([name, m]) => ({
      module: name,
      bytes: fmt.bytes(m.bytes),
      where: m.initial ? 'INITIAL' : 'lazy',
      outputs: m.files.size > 1 ? `${m.files.size} ⚠ duplicated` : '1',
      _whereClass: m.initial ? 'meh' : 'ok',
    }));
}

/** Wire up a standard "compare variants" page. */
export function comparePage(variants) {
  const log = new Log('#log');
  const out = $('out');

  on('compare', async () => {
    const rows = [];
    for (const v of variants) {
      try {
        const meta = await loadMeta(v);
        const s = summarise(meta);
        rows.push({
          variant: v,
          'initial download': fmt.bytes(s.initial),
          'total shipped': fmt.bytes(s.total),
          files: s.files,
          _initialClass: s.initial < 20000 ? 'ok' : s.initial < 100000 ? 'meh' : 'no',
        });
        log.line(`${v.padEnd(14)} initial ${fmt.bytes(s.initial)}  total ${fmt.bytes(s.total)}`, 'macro');
      } catch (err) {
        log.bad(err.message);
      }
      renderTable('#results', rows, { columns: ['variant', 'initial download', 'total shipped', 'files'] });
    }
  });

  on('modules', async () => {
    const v = $('variant')?.value ?? variants[0];
    try {
      renderTable('#results', moduleTable(await loadMeta(v)).slice(0, 20),
        { columns: ['module', 'bytes', 'where', 'outputs'] });
      log.line(`largest modules in "${v}"`, 'macro');
    } catch (err) { log.bad(err.message); }
  });

  return { log, out };
}
