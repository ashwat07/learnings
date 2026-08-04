// Lab 04 — Paint storms.
// Modes 1 and 2 are implemented (badly). Modes 3 and 4 are yours.

PerfHUD.start();

const grid = document.getElementById('grid');
const out = document.getElementById('out');
const modeSelect = document.getElementById('mode');

let cells = [];
let detach = () => {};

function build(n) {
  grid.textContent = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.style.setProperty('--h', (i * 37) % 360);
    frag.appendChild(cell);
  }
  grid.appendChild(frag);
  cells = [...grid.children];
  report(`built ${n} cells`);
}

function report(msg) { out.textContent = msg; }

// ---------------------------------------------------------------------------
// 1. BROKEN — the class goes on the container, so the container's background changes
//    and every cell inside its layer has to be repainted on top of it.
// ---------------------------------------------------------------------------
function hoverAncestor() {
  const over = () => grid.classList.add('hot');
  const outFn = () => grid.classList.remove('hot');
  grid.addEventListener('mouseover', over);
  grid.addEventListener('mouseout', outFn);
  return () => {
    grid.removeEventListener('mouseover', over);
    grid.removeEventListener('mouseout', outFn);
    grid.classList.remove('hot');
  };
}

// ---------------------------------------------------------------------------
// 2. BROKEN — JS recolours all 500 cells because "they should all react a bit".
// ---------------------------------------------------------------------------
function hoverAll() {
  const over = e => {
    if (!e.target.classList.contains('cell')) return;
    const hovered = cells.indexOf(e.target);
    cells.forEach((c, i) => {
      const dist = Math.abs(i - hovered);
      c.style.background = `hsl(${(i * 37) % 360} 70% ${55 - Math.max(0, 20 - dist)}%)`;
    });
  };
  grid.addEventListener('mouseover', over);
  return () => {
    grid.removeEventListener('mouseover', over);
    cells.forEach(c => { c.style.background = ''; });
  };
}

// ---------------------------------------------------------------------------
// 3. TODO — hoverSelf.
//    Recolour ONLY the hovered cell, and do it with zero JavaScript: write a
//    :hover rule in index.html and return a no-op teardown here.
//    Then explain in a comment why the CSS version beats a JS handler that sets
//    the identical style.
// ---------------------------------------------------------------------------
function hoverSelf() {
  throw new Error('TODO: hoverSelf() — pure CSS :hover, no JS handler at all');
}

// ---------------------------------------------------------------------------
// 4. TODO — fadeOpacity.
//    Highlight by fading a composited overlay with `opacity` instead of changing colour.
//    Target: Paint total ≈ 0 during a hover sweep, and Paint flashing shows nothing
//    after the first frame.
//    Then check the Layers panel: how much GPU memory did you just spend, and is that
//    an acceptable trade for 500 cells? (See Lab 15.)
// ---------------------------------------------------------------------------
function fadeOpacity() {
  throw new Error('TODO: fadeOpacity() — composited overlay, opacity only');
}

// ---------------------------------------------------------------------------

const modes = { hoverAncestor, hoverAll, hoverSelf, fadeOpacity };

function activate(name) {
  detach();
  detach = () => {};
  cells.forEach(c => { c.style.background = ''; c.classList.remove('lit'); });
  PerfHUD.reset();
  if (name === 'off') return report('no mode active');
  try {
    detach = modes[name]() || (() => {});
    report(`mode: ${name}\nhover the grid with Paint flashing on.`);
  } catch (err) {
    report(`mode: ${name}\n  ${err.message}`);
    console.warn(err);
  }
}

/** Synthetic hover sweep so your traces are repeatable instead of depending on your wrist. */
document.getElementById('sweep').addEventListener('click', () => {
  const t0 = performance.now();
  report('sweeping…');
  (function step() {
    const elapsed = performance.now() - t0;
    if (elapsed > 3000) return report('sweep done — check Paint totals in the trace');
    const target = cells[Math.floor((elapsed / 3000) * cells.length)];
    target?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    requestAnimationFrame(step);
  })();
});

document.getElementById('theme').addEventListener('click', () => {
  document.documentElement.classList.toggle('light');
  report('toggled a class on <html> — record this and note the repaint area.\n' +
         'Then implement the custom-property version and compare. Read the README hint after.');
});

modeSelect.addEventListener('change', () => activate(modeSelect.value));
document.getElementById('rebuild').addEventListener('click', () => {
  build(+document.getElementById('count').value);
  activate(modeSelect.value);
});
document.getElementById('reset').addEventListener('click', () => { PerfHUD.reset(); report('reset'); });

build(+document.getElementById('count').value);
activate('hoverAncestor');
