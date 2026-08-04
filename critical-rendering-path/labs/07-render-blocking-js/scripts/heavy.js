// 800ms of synchronous, unyieldable work. Slow to EXECUTE, fast to download —
// which is precisely the case the preload scanner cannot help with.
(function () {
  const BUDGET_MS = 800;
  const t0 = performance.now();
  let acc = 0;
  // A busy loop the JIT can't elide.
  while (performance.now() - t0 < BUDGET_MS) {
    for (let i = 0; i < 5e4; i++) acc += Math.sqrt(i) % 7;
  }
  window.HEAVY_RESULT = acc;               // page 04's dependent script needs this global
  window.LabLog?.note(`heavy.js finished ${(performance.now() - t0).toFixed(0)}ms of blocking work`);
})();
