// A "date library". Pure, but chunky — it stands in for the 20–70KB date dependency that ends
// up in a bundle because one component formats one timestamp.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// The bulk of this "library" lives in a generated module, so its bytes are real.
import { LOCALE_DATA } from './locale-data.js';

export function formatDate(d, style = 'long') {
  const date = new Date(d);
  if (style === 'iso') return date.toISOString().slice(0, 10);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function relativeTime(d) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins} minutes ago`;
  return `${Math.round(mins / 60)} hours ago`;
}

export const locales = () => LOCALE_DATA.length;
