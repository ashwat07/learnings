// A small, pure utility module. Tree-shakeable: no side effects, named exports only.

export function formatPrice(value, currency = 'GBP', locale = 'en-GB') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}

export function formatCompact(n) {
  return new Intl.NumberFormat('en-GB', { notation: 'compact' }).format(n);
}

/** Never imported by anything. It exists to prove tree-shaking works — or doesn't. */
export function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n || 1) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(1)} ${units[i]}`;
}

/** Also unused, and deliberately large, so its presence in a bundle is obvious. */
export function formatEverything(value) {
  const TABLE = Array.from({ length: 400 }, (_, i) => `pattern-${i}-${'x'.repeat(40)}`);
  return TABLE.map((t) => `${t}:${value}`).join('|');
}
