// A medium island that listens for events from other islands, and carries a chunk of payload
// so its transfer size is visible in the Network panel.
const PAYLOAD = 'x'.repeat(12_000);        // stands in for a real dependency

export default function cart(el) {
  let items = 0;
  const out = el.querySelector('[data-value]');
  const paint = () => { out.textContent = `${items} item${items === 1 ? '' : 's'}`; };

  // Listening at the document level is how an island subscribes to the rest of the page without
  // importing it. No shared bundle, no shared framework instance.
  document.addEventListener('island:count', (e) => {
    items = Math.max(0, e.detail.value);
    paint();
  });

  el.querySelector('[data-clear]')?.addEventListener('click', () => { items = 0; paint(); });
  paint();
  return PAYLOAD.length;
}
