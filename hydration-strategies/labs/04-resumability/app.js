// Lab 04 — Resumability (the measurement side).

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

PerfHUD.start({ note: 'resumability' });

const log = new Log('#log');
const out = $('out');
const rows = [];

document.addEventListener('resume:handled', (e) => {
  const { ref, importMs, totalMs, cached } = e.detail;
  log.line(`${ref} → ${cached ? 'module already loaded' : `imported in ${fmt.ms(importMs)}`}, ` +
    `handled in ${fmt.ms(totalMs)}`, cached ? 'good' : 'macro');
});

const transferOf = (part) => {
  const entries = performance.getEntriesByType('resource').filter((r) => r.name.includes(part));
  return entries.reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0);
};

on('measure', () => {
  const resumeBytes = transferOf('resume.js');
  const handlerBytes = transferOf('handlers.js');
  const components = document.querySelectorAll('[data-component]').length;
  const handlers = document.querySelectorAll('[data-on-click]').length;

  renderTable('#results', [
    { thing: 'components on the page', value: components },
    { thing: 'event handlers referenced', value: handlers },
    { thing: 'component code executed on load', value: '0 bytes, 0 functions' },
    { thing: 'runtime shipped on load', value: fmt.bytes(resumeBytes) + ' (resume.js)' },
    { thing: 'handler module loaded so far', value: handlerBytes ? fmt.bytes(handlerBytes) : 'not yet — click something' },
    { thing: 'TBT contribution of "hydration"', value: '0ms — there is no hydration' },
  ], { columns: ['thing', 'value'] });

  out.textContent =
    'Nothing about this page scales with component count. Ten components or ten thousand, the\n' +
    'load-time cost is the same 30-line listener, because nothing walks the tree.\n\n' +
    'That is the property resumability is chasing: O(1) startup instead of O(components).\n\n' +
    'What made it possible is that the server wrote down what it knew:\n' +
    '  • WHICH element has a handler        → the data-on-click attribute\n' +
    '  • WHICH function, in which module    → "./handlers.js#increment"\n' +
    '  • WHAT state it operates on          → data-state on the closest component\n\n' +
    'Hydration has to re-execute your components to rediscover all three. Resumability replaces\n' +
    'that rediscovery with a lookup.';
});

on('compare', () => {
  const N = 500;
  const perComponentMs = 2;
  renderTable('#results', [
    {
      model: 'full hydration',
      'load-time cost': `${N} × ${perComponentMs}ms = ${N * perComponentMs}ms`,
      'scales with': 'component count',
      'first interaction': 'instant (already hydrated)',
      'what ships on load': 'the framework + every component',
    },
    {
      model: 'lazy / islands',
      'load-time cost': 'only eager islands',
      'scales with': 'eager island count',
      'first interaction': 'instant, or the island\'s cost',
      'what ships on load': 'the framework + eager islands',
    },
    {
      model: 'resumability',
      'load-time cost': '~0ms',
      'scales with': 'nothing',
      'first interaction': 'one dynamic import (then free)',
      'what ships on load': 'a small listener',
    },
  ], { columns: ['model', 'load-time cost', 'scales with', 'first interaction', 'what ships on load'] });

  out.textContent =
    'The honest comparison, including the parts resumability advocates skip:\n\n' +
    'WHAT IT WINS\n' +
    '  • O(1) startup. A page with 5,000 components costs the same as one with 5.\n' +
    '  • No uncanny valley: the page is interactive as soon as the HTML is parsed, because\n' +
    '    interactivity is one document listener rather than N attachments.\n' +
    '  • Code is loaded per interaction, so code nobody triggers is never downloaded.\n\n' +
    'WHAT IT COSTS\n' +
    '  • The first interaction with each handler pays a network round trip. On a fast connection\n' +
    '    that is invisible; on 3G it is a click that hangs. Frameworks mitigate with speculative\n' +
    '    prefetching on hover/idle — which is the interaction-triggered idea from lab 03, again.\n' +
    '  • ALL state must be serialisable into the HTML. No functions, no class instances, no DOM\n' +
    '    references, no closures over things that cannot be written down. (Same constraint as\n' +
    '    postMessage and RSC props — it keeps coming back.)\n' +
    '  • The HTML gets bigger: every handler reference and every piece of state is bytes.\n' +
    '  • It requires a compiler. You cannot write ordinary closures and have them split into\n' +
    '    separately-loadable chunks by hand — that is Qwik\'s entire optimiser.\n\n' +
    'The idea worth stealing even if you never use Qwik: PUT WHAT THE SERVER ALREADY KNEW INTO THE\n' +
    'HTML, instead of making the client recompute it. That is the same principle as SSR, applied\n' +
    'to behaviour rather than to markup.';
});

on('serialise', () => {
  log.head('— what can and cannot be written into the HTML —');

  const cases = [
    ['a number, string, boolean', 3, true],
    ['a plain object / array', { a: 1, b: [2, 3] }, true],
    ['a Date', new Date(), 'as a string, and it comes back as a string'],
    ['a Map / Set', new Map([['a', 1]]), 'not with JSON — needs a custom codec'],
    ['a function', () => {}, false],
    ['a DOM node', document.body, false],
    ['a closure over a variable', null, false],
    ['a reference to another component\'s state', null, 'only with an id-based scheme'],
  ];

  const out2 = cases.map(([what, value, ok]) => {
    let result;
    try {
      const json = JSON.stringify(value);
      result = json === undefined ? 'JSON.stringify → undefined (dropped silently)' : `${json.slice(0, 40)}`;
    } catch (err) {
      result = `${err.name}: ${err.message.slice(0, 40)}`;
    }
    return { 'state value': what, 'serialisable?': ok === true ? 'yes' : ok === false ? 'NO' : String(ok),
      'JSON.stringify': result, _serialisableClass: ok === true ? 'ok' : ok === false ? 'no' : 'meh' };
  });
  renderTable('#results', out2, { columns: ['state value', 'serialisable?', 'JSON.stringify'] });

  out.textContent =
    'Note the silent failures: a function does not throw, it just disappears — JSON.stringify\n' +
    'returns undefined for a bare function and omits function-valued properties from objects. A\n' +
    'Date survives as a string and comes back as a string, so `state.createdAt.getTime()` throws\n' +
    'on the second interaction and not the first.\n\n' +
    'This is why real resumability frameworks ship their own serialiser rather than using JSON:\n' +
    'they handle Dates, Maps, Sets, circular references, and — the hard one — references BETWEEN\n' +
    'pieces of state, so two components sharing an object still share it after resuming.\n\n' +
    'It is the same family of constraint as structured clone (web-workers lab 02) and RSC props\n' +
    '(rendering-strategies lab 05). Any time state crosses a boundary — thread, network, or time —\n' +
    'you are limited to what can be written down.';
});

on('clear', () => { log.clear(); $('#results').textContent = ''; });
