// Lab 05 — OffscreenCanvas: rendering entirely in a worker.
//
// The canvas is transferred once. After that the main thread does nothing per frame — no rAF,
// no drawing calls, no state. Blocking the main thread cannot stall this animation.

let ctx = null;
let w = 0, h = 0;
let running = false;

self.onmessage = (e) => {
  const { canvas, width, height, action } = e.data;

  if (canvas) {
    ctx = canvas.getContext('2d');
    w = width; h = height;
    running = true;
    requestAnimationFrame(draw);        // workers with OffscreenCanvas get rAF too
    return;
  }
  if (action === 'stop') running = false;
};

function draw(t) {
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  // Something obviously animated, and cheap.
  for (let i = 0; i < 60; i++) {
    const p = (t / 900 + i / 60) % 1;
    const x = p * w;
    const y = h / 2 + Math.sin(t / 400 + i / 4) * (h / 3);
    ctx.fillStyle = `hsl(${(i * 6 + t / 20) % 360} 80% 65%)`;
    ctx.fillRect(x, y, 6, 6);
  }

  ctx.fillStyle = '#9a9ab0';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.fillText(`worker-rendered · frame time ${(performance.now() - t).toFixed(1)}ms`, 10, 16);

  if (running) requestAnimationFrame(draw);
}
