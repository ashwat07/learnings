// Lab 01 — The cost of hydration.

import { $, on, Log, renderTable, fmt, sleep, busy } from '/shared/lab-ui.js';

PerfHUD.start({ note: 'watch long tasks\nduring hydration' });

const log = new Log('#log');
const out = $('out');
const stage = $('#stage');
const rows = [];

let handled = 0, lost = 0;
const bump = () => {
  $('#clicks').textContent = `${handled} handled`;
  $('#lost').textContent = `${lost} lost`;
};

/**
 * Render "server HTML": markup that is complete and visible, with no behaviour attached.
 *
 * Two thirds of these components are static — a label and a value. Only a third are interactive.
 * That ratio is deliberately realistic: most of a page is not interactive, which is the entire
 * argument for islands.
 */
function renderServerHTML(n) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'row';
    const interactive = i % 3 === 0;

    const label = document.createElement('span');
    label.style.flex = '1';
    label.textContent = `component ${i} — ${interactive ? 'interactive' : 'static text, no behaviour needed'}`;
    row.append(label);

    if (interactive) {
      const btn = document.createElement('button');
      btn.textContent = 'press';
      btn.dataset.component = String(i);
      // A click before hydration is LOST: nothing is listening yet. This listener exists only to
      // count those losses, and is not what makes the component work.
      btn.addEventListener('click', () => {
        if (!btn.dataset.hydrated) { lost++; bump(); }
      });
      row.append(btn);
    }
    frag.append(row);
  }
  stage.textContent = '';
  stage.append(frag);
  return n;
}

/** "Hydrating" one component: the synthetic per-component cost, then attach the real behaviour. */
function hydrateOne(btn, cost) {
  if (cost) busy(cost);
  btn.addEventListener('click', () => { handled++; bump(); });
  btn.dataset.hydrated = '1';
}

/** Hydrate EVERY component, including the ones with no behaviour to attach. */
function hydrateEverything(n, cost) {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const row = stage.children[i];
    const btn = row.querySelector('button');
    // The framework walks every component whether or not it needs anything: it has to
    // reconstruct the tree to know that nothing changed.
    if (cost) busy(cost);
    if (btn) hydrateOne(btn, 0);
  }
  return performance.now() - t0;
}

/** Hydrate only the interactive components. */
function hydrateOnlyIslands(cost) {
  const t0 = performance.now();
  for (const btn of stage.querySelectorAll('button')) hydrateOne(btn, cost);
  return performance.now() - t0;
}

async function run(label, fn) {
  const n = Number($('n').value);
  const cost = Number($('cost').value);
  handled = 0; lost = 0; bump();

  log.head(`— ${label}: ${n} components, ${cost}ms each —`);
  renderServerHTML(n);

  // Let the browser paint the "server HTML" first — that is the moment the page looks ready.
  const paintedAt = performance.now();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  log.ok(`server HTML painted after ${fmt.ms(performance.now() - paintedAt)} — the page now LOOKS ready`);
  log.muted('mash the buttons NOW');
  await sleep(400);

  const before = PerfHUD.stats.longestTask;
  const duration = fn(n, cost);
  await sleep(200);
  const interactive = stage.querySelectorAll('button').length;
  const total = stage.children.length;

  rows.push({
    strategy: label,
    components: total,
    'interactive': interactive,
    'hydration ms': Math.round(duration),
    'longest task ms': Math.round(Math.max(PerfHUD.stats.longestTask, before)),
    'clicks lost': lost,
    _hydrationClass: duration > 200 ? 'no' : duration > 50 ? 'meh' : 'ok',
  });
  renderTable('#results', rows, {
    columns: ['strategy', 'components', 'interactive', 'hydration ms', 'longest task ms', 'clicks lost'],
  });
  log.line(`${label}: ${fmt.ms(duration)} of blocking work, ${lost} click(s) lost`,
    duration > 200 ? 'bad' : 'good');
  return duration;
}

on('hydrateAll', async () => {
  await run('hydrate everything', hydrateEverything);
  out.textContent =
    'One long task, during which the page was visibly complete and completely dead.\n\n' +
    'Three things to take from the numbers:\n\n' +
    '1. The work is proportional to COMPONENT COUNT, not to how much of the page is interactive.\n' +
    '   A framework has to reconstruct the whole tree to know that nothing changed.\n\n' +
    '2. It lands as ONE long task, so it is invisible to FCP and LCP — the page painted before it\n' +
    '   started. It shows up in TBT, in long tasks, and in the INP of anything the user tries.\n\n' +
    '3. The lost clicks are the user-visible symptom. Not "slow" — WRONG. The button looked\n' +
    '   pressable, the user pressed it, and nothing happened. Some frameworks queue and replay\n' +
    '   those events, which turns "nothing happened" into "everything happened at once".\n\n' +
    'This is the uncanny valley, and it is why server rendering alone does not make an app feel\n' +
    'fast.';
});

on('hydrateIslands', async () => {
  await run('hydrate islands only', (n, cost) => hydrateOnlyIslands(cost));
  const all = rows.find((r) => r.strategy === 'hydrate everything');
  const islands = rows.filter((r) => r.strategy === 'hydrate islands only').at(-1);
  out.textContent =
    (all ? `${Math.round(all['hydration ms'])}ms → ${Math.round(islands['hydration ms'])}ms, ` +
      `about ${(all['hydration ms'] / Math.max(islands['hydration ms'], 1)).toFixed(1)}× less work.\n\n` : '') +
    'Same page, same behaviour, one third of the components touched — because two thirds of them\n' +
    'were static text that needed nothing.\n\n' +
    'That ratio is the whole argument for islands, and in real pages it is usually more extreme:\n' +
    'a product page is a lot of markup and about four interactive things.\n\n' +
    'What it costs you: someone has to decide which components are islands. Frameworks make that\n' +
    'decision explicit (Astro\'s client: directives, React\'s "use client"), which is better than\n' +
    'hiding it — but it is a real design constraint, and the boundary leaks (see the RSC lab).\n\n' +
    'Next: lab 02 does this properly with real islands, and lab 03 defers even those.';
});

on('reset', () => {
  rows.length = 0;
  renderTable('#results', rows);
  stage.textContent = '';
  handled = lost = 0; bump();
  log.clear();
  PerfHUD.reset();
});

bump();
