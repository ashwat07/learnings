// The product route. Imports directly from the modules it needs, not from the barrel.
import { formatPrice } from '../lib/format.js';
import { relativeTime } from '../lib/dates.js';

export function render(el, product) {
  el.innerHTML = `<h2>${product.name}</h2>
    <p class="price">${formatPrice(product.price)}</p>
    <p><small>updated ${relativeTime(product.updatedAt)}</small></p>`;
  return product.id;
}
