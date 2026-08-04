// The reference demo. Copy this shape for the other 17.
//
// Note what makes it a *teaching* demo rather than a benchmark:
//   · one variable changes between modes (read placement), nothing else
//   · the measurement is the thing being taught (layout flushes), not just elapsed time
//   · it says which DevTools panel to open and what pattern to look for
//   · it asks the visitor to predict before revealing the number
//   · teardown is complete

const COUNT = 600;

export default {
  id: 'layout-thrashing',
  title: 'Layout thrashing',
  stage: 'Layout',
  lab: 1,

  metric: 'ms for one pass over 600 elements (JS + forced layout)',

  blurb:
    'Writing to the DOM only marks it dirty — the browser plans to lay out once, before the ' +
    'next paint. But reading a geometry property needs a correct answer now, so it forces the ' +
    'pending layout to run synchronously. Interleave a write and a read in a loop and you get ' +
    'one full layout per iteration instead of one per frame. The fix changes nothing about the ' +
    'work being done, only its order: read everything, then write everything.',

  devtools:
    'Performance panel → record while you click Run → expand the long task. Broken mode shows a ' +
    'repeating Recalculate Style → Layout comb inside one yellow JS block, with forced-reflow ' +
    'warnings. Fixed mode shows one Layout entry. Learn to recognise that comb — it is the ' +
    'highest-value pattern-match in front-end performance work.',

  predict:
    'Broken mode does 600 writes and 600 interleaved reads. Fixed mode does the same 1,200 ' +
    'operations, reordered. How much faster do you expect fixed to be — 10%? 2×? 50×?',

  setup(root) {
    root.innerHTML = '<div class="lt-wrap"></div>';
    const wrap = root.querySelector('.lt-wrap');
    Object.assign(wrap.style, { display: 'flex', flexWrap: 'wrap', gap: '2px' });
    const frag = document.createDocumentFragment();
    for (let i = 0; i < COUNT; i++) {
      const box = document.createElement('div');
      Object.assign(box.style, {
        width: '40px', height: '14px', borderRadius: '3px', flex: '0 0 auto',
        background: 'linear-gradient(90deg,#7c9cff,#b57cff)',
      });
      frag.appendChild(box);
    }
    wrap.appendChild(frag);
    this._boxes = [...wrap.children];
  },

  run(root, mode) {
    const boxes = this._boxes;
    const target = boxes.map((_, i) => 40 + ((i * 37) % 160));   // deterministic, so runs compare
    const widths = [];

    performance.mark('lt:start');
    const t0 = performance.now();

    if (mode === 'broken') {
      // write → read → write → read. One forced layout per box.
      for (let i = 0; i < boxes.length; i++) {
        boxes[i].style.width = target[i] + 'px';
        widths.push(boxes[i].offsetWidth);
      }
    } else {
      // All writes, then all reads. One layout flush for the whole batch.
      for (let i = 0; i < boxes.length; i++) boxes[i].style.width = target[i] + 'px';
      for (let i = 0; i < boxes.length; i++) widths.push(boxes[i].offsetWidth);
    }

    const dt = performance.now() - t0;
    performance.mark('lt:end');
    performance.measure(`layout-thrashing (${mode})`, 'lt:start', 'lt:end');

    const checksum = widths.reduce((a, b) => a + b, 0);
    return `${dt.toFixed(1)}ms  (checksum ${checksum} — identical in both modes, ` +
           `so you know you measured the same work)`;
  },

  teardown(root) {
    this._boxes = null;
    root.textContent = '';
  },
};
