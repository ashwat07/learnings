// A tiny island: 1 dependency, a few hundred bytes of logic.
export default function counter(el, props) {
  let n = Number(props.start || 0);
  const out = el.querySelector('[data-value]');
  const paint = () => { out.textContent = String(n); };
  el.querySelector('[data-inc]').addEventListener('click', () => { n++; paint(); publish(n); });
  el.querySelector('[data-dec]').addEventListener('click', () => { n--; paint(); publish(n); });
  paint();

  // Cross-island communication. Islands are separate roots — they cannot share a framework
  // context, a provider, or a hook. A DOM event is the lowest-common-denominator channel and it
  // works between islands written in different frameworks, which is the point.
  function publish(value) {
    el.dispatchEvent(new CustomEvent('island:count', { bubbles: true, detail: { value } }));
  }
}
