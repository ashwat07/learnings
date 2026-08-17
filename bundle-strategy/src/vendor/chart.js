// A "charting library": large, and used by exactly one route. The archetypal candidate for a
// dynamic import — and the archetypal thing that ends up in the main bundle because someone
// imported it at the top of a file.

import { KERNELS } from './chart-data.js';

export function drawChart(canvas, data) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  data.forEach((v, i) => {
    ctx.fillStyle = `hsl(${(i * 12) % 360} 70% 60%)`;
    ctx.fillRect(i * 8, canvas.height - v, 6, v);
  });
  return KERNELS.length;
}

export { version } from './chart-data.js';
