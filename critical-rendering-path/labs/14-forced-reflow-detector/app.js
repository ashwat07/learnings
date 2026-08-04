// Lab 14 — Forced reflow detector.
//
// This file defines the patterns. It does NOT tell you the answers — the whole point is that
// you predict, then measure, then explain. The `expect` field is intentionally left as a
// question for you to fill in.

PerfHUD.start({ countReflows: true });

const subjectsEl = document.getElementById('subjects');
const ballastEl = document.getElementById('ballast-content');
const tbody = document.querySelector('#results tbody');
const out = document.getElementById('out');

let subjects = [];

function buildSubjects(n = 12) {
  subjectsEl.textContent = '';
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'subject';
    el.style.setProperty('--x', '10px');
    subjectsEl.appendChild(el);
  }
  subjects = [...subjectsEl.children];
}

function buildBallast(on) {
  ballastEl.textContent = '';
  if (!on) return;
  const div = document.createElement('div');
  div.id = 'ballast';
  // Lots of inline text: layout has to line-break all of it, so a document-wide flush is
  // genuinely expensive and a subtree-scoped flush is measurably cheaper.
  div.textContent = Array.from({ length: 4000 },
    (_, i) => `ballast-${i} some words to shape and wrap`).join(' ');
  ballastEl.appendChild(div);
}

// ---------------------------------------------------------------------------
// The patterns. Each takes (el, other, i) and does exactly one representative
// read/write sequence. Keep them small: the whole point is attribution.
// ---------------------------------------------------------------------------
const PATTERNS = [
  {
    id: 'A', name: 'write, then three reads',
    code: `el.style.height = h + 'px';\nel.offsetWidth;\nel.offsetHeight;\nel.getBoundingClientRect();`,
    question: 'How many layouts per iteration? Fewer than 3?',
    run(el, other, i) {
      el.style.height = 30 + (i % 20) + 'px';
      void el.offsetWidth;
      void el.offsetHeight;
      void el.getBoundingClientRect();
    },
  },
  {
    id: 'B', name: 'read, then write',
    code: `el.offsetWidth;\nel.style.height = h + 'px';`,
    question: 'Does the ORDER matter? Compare against A.',
    run(el, other, i) {
      void el.offsetWidth;
      el.style.height = 30 + (i % 20) + 'px';
    },
  },
  {
    id: 'C', name: 'write A, read B (different elements)',
    code: `elA.style.height = h + 'px';\nelB.offsetWidth;`,
    question: 'Does touching a DIFFERENT element save you? Why / why not?',
    run(el, other, i) {
      el.style.height = 30 + (i % 20) + 'px';
      void other.offsetWidth;
    },
  },
  {
    id: 'D', name: 'custom property nothing geometric uses, then read',
    code: `el.style.setProperty('--x', v);\nel.offsetWidth;`,
    question: 'The variable is unused by any layout property. Does the browser know that?',
    run(el, other, i) {
      el.style.setProperty('--x', (i % 20) + 'px');
      void el.offsetWidth;
    },
  },
  {
    id: 'E', name: 'colour-only class change, then read',
    code: `el.classList.toggle('red');\nel.offsetWidth;`,
    question: 'Colour is paint-only. So what does the read cost here — style, layout, or nothing?',
    run(el, other, i) {
      el.classList.toggle('red');
      void el.offsetWidth;
    },
  },
  {
    id: 'F', name: 'write, read the INLINE style back, then read geometry',
    code: `el.style.height = h + 'px';\nel.style.height;      // inline read\nel.offsetWidth;`,
    question: 'Does the inline-style read flush anything? Compare with A.',
    run(el, other, i) {
      el.style.height = 30 + (i % 20) + 'px';
      void el.style.height;
      void el.offsetWidth;
    },
  },
  {
    id: 'G', name: 'write + read inside one rAF callback',
    code: `requestAnimationFrame(() => {\n  el.style.height = h + 'px';\n  el.offsetWidth;\n});`,
    question: 'The folklore says rAF makes reads safe. Does it?',
    async: true,
    run(el, other, i) {
      return new Promise(resolve => requestAnimationFrame(() => {
        el.style.height = 30 + (i % 20) + 'px';
        void el.offsetWidth;
        resolve();
      }));
    },
  },
  {
    id: 'H', name: 'write, yield to the event loop, then read',
    code: `el.style.height = h + 'px';\nawait new Promise(r => setTimeout(r, 0));\nel.offsetWidth;`,
    question: 'The read is in a different task. What happened in between, and who paid for it?',
    async: true,
    run(el, other, i) {
      el.style.height = 30 + (i % 20) + 'px';
      return new Promise(r => setTimeout(r, 0)).then(() => { void el.offsetWidth; });
    },
  },
  {
    id: 'thrash', name: 'the classic thrash loop',
    code: `for (el of els) {\n  el.style.width = rand + 'px';\n  widths.push(el.offsetWidth);\n}`,
    question: 'Your Lab 01 baseline. Note ms/iteration and keep it as the reference cost.',
    whole: true,
    run(iterations) {
      const widths = [];
      for (let i = 0; i < iterations; i++) {
        const el = subjects[i % subjects.length];
        el.style.width = 60 + (i % 40) + 'px';
        widths.push(el.offsetWidth);
      }
      return widths.length;
    },
  },
  {
    id: 'batched', name: 'the same work, batched',
    code: `for (el of els) el.style.width = ...;\nfor (el of els) widths.push(el.offsetWidth);`,
    question: 'How many layouts total, regardless of iteration count?',
    whole: true,
    run(iterations) {
      const widths = [];
      for (let i = 0; i < iterations; i++) {
        subjects[i % subjects.length].style.width = 60 + (i % 40) + 'px';
      }
      for (let i = 0; i < iterations; i++) {
        widths.push(subjects[i % subjects.length].offsetWidth);
      }
      return widths.length;
    },
  },
];

// ---------------------------------------------------------------------------

async function runPattern(p, iterations) {
  const reads0 = PerfHUD.stats.reflowReads;
  // Warm up so the JIT isn't part of the measurement.
  if (!p.whole) for (let i = 0; i < 20; i++) await p.run(subjects[0], subjects[1], i);

  performance.mark(`${p.id}:start`);
  const t0 = performance.now();
  if (p.whole) {
    p.run(iterations);
  } else if (p.async) {
    // Async patterns are inherently frame- or task-bound, so cap the count — otherwise
    // you're measuring the event loop, not layout.
    const n = Math.min(iterations, 200);
    for (let i = 0; i < n; i++) {
      await p.run(subjects[i % subjects.length], subjects[(i + 1) % subjects.length], i);
    }
  } else {
    for (let i = 0; i < iterations; i++) {
      p.run(subjects[i % subjects.length], subjects[(i + 1) % subjects.length], i);
    }
  }
  const dt = performance.now() - t0;
  performance.mark(`${p.id}:end`);
  performance.measure(`pattern ${p.id} — ${p.name}`, `${p.id}:start`, `${p.id}:end`);

  const effectiveN = p.async ? Math.min(iterations, 200) : iterations;
  return {
    ms: dt,
    reads: PerfHUD.stats.reflowReads - reads0,
    perIteration: dt / effectiveN,
    n: effectiveN,
  };
}

function row(p, r, baseline) {
  const ratio = baseline ? r.perIteration / baseline : 1;
  const verdict = !baseline ? '(reference)'
    : ratio < 0.15 ? 'cheap — no flush per iteration'
    : ratio < 0.6 ? 'partial — fewer flushes than iterations'
    : 'expensive — a flush per iteration';
  return `<tr>
    <td><strong>${p.id}</strong> ${p.name}<br><span class="hint">${p.question}</span></td>
    <td class="pattern-code">${p.code.replace(/</g, '&lt;')}</td>
    <td class="num">${r.ms.toFixed(1)}</td>
    <td class="num">${r.reads.toLocaleString()}</td>
    <td class="num">${r.perIteration.toFixed(4)}</td>
    <td>${verdict}<br><span class="hint">${(ratio).toFixed(2)}× the thrash cost/iteration</span></td>
  </tr>`;
}

document.getElementById('runAll').addEventListener('click', async () => {
  const iterations = +document.getElementById('iterations').value;
  tbody.innerHTML = '';
  out.textContent = 'running… (record a Performance trace over this to count real Layout entries)';

  // Use the thrash pattern as the per-iteration cost reference.
  const thrash = PATTERNS.find(p => p.id === 'thrash');
  const ref = await runPattern(thrash, iterations);

  for (const p of PATTERNS) {
    const r = p === thrash ? ref : await runPattern(p, iterations);
    tbody.insertAdjacentHTML('beforeend', row(p, r, p === thrash ? null : ref.perIteration));
    await new Promise(r2 => setTimeout(r2, 30));   // let the page settle between patterns
  }

  out.textContent = [
    `done — ${iterations.toLocaleString()} iterations each (async patterns capped at 200).`,
    '',
    'Now the actual work:',
    '  1. compare each row against your written prediction',
    '  2. count real Layout entries per pattern in the trace (Bottom-Up, group by activity)',
    '  3. for every row you got wrong, write down WHY before moving on',
    '  4. re-run with "contain: layout" checked and with ballast off — which rows moved?',
    '',
    `geometry reads counted in total: ${PerfHUD.stats.reflowReads.toLocaleString()}`,
    'PerfHUD.breakdown() in the console shows which property was read most.',
  ].join('\n');
});

document.getElementById('contain').addEventListener('change', e => {
  subjects.forEach(s => s.classList.toggle('contained', e.target.checked));
  out.textContent = `contain: layout ${e.target.checked ? 'ON' : 'OFF'} — re-run and compare. ` +
    `Pay attention to patterns A and C.`;
});

document.getElementById('ballast').addEventListener('change', e => {
  buildBallast(e.target.checked);
  out.textContent = `ballast ${e.target.checked ? 'ON' : 'OFF'} — re-run. ` +
    `If a pattern got much cheaper, it was doing DOCUMENT-wide layout, not subtree layout.`;
});

document.getElementById('reset').addEventListener('click', () => {
  PerfHUD.reset();
  buildSubjects();
  tbody.innerHTML = '';
  out.textContent = 'reset';
});

buildSubjects();
buildBallast(true);
out.textContent = 'Predictions written down? Then click "run all patterns".';
