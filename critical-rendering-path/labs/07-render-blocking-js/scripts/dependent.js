// Depends on a global that heavy.js defines. With `defer` this is guaranteed to work
// (document order). With `async` it is a race — reload a few times.
(function () {
  const el = document.getElementById('dependent-output');
  try {
    if (typeof window.HEAVY_RESULT !== 'number') {
      throw new ReferenceError('HEAVY_RESULT is not defined — dependent.js ran before heavy.js');
    }
    window.LabLog?.note(`dependent.js OK (HEAVY_RESULT = ${window.HEAVY_RESULT.toFixed(2)})`);
    if (el) el.textContent = `dependent.js OK — HEAVY_RESULT = ${window.HEAVY_RESULT.toFixed(2)}`;
  } catch (err) {
    window.LabLog?.note(`dependent.js FAILED: ${err.message}`);
    if (el) el.textContent = `❌ ${err.message}`;
    console.error('[lab07]', err);
  }
  // It also touches the DOM, which is the other async hazard: the element may not exist yet.
  const list = document.getElementById('late-list');
  if (!list) {
    window.LabLog?.note('dependent.js could not find #late-list — DOM not parsed yet');
  } else {
    list.insertAdjacentHTML('beforeend', '<li>appended by dependent.js</li>');
  }
})();
