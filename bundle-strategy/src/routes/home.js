// The home route. Uses two functions from the barrel.
import { formatPrice, formatDate } from '../lib/index.js';

export function render(el, products) {
  el.innerHTML = `<h2>Home</h2><ul>${products.map((p) =>
    `<li>${p.name} — ${formatPrice(p.price)} <small>${formatDate(p.updatedAt, 'iso')}</small></li>`).join('')}</ul>`;
  return products.length;
}
