// The admin route: the only place the chart library is used, and one of two places the
// validators are used. Almost nobody visits it.
import { drawChart } from '../vendor/chart.js';
import { isEmail, isPositive } from '../lib/validate.js';
import { formatCompact } from '../lib/format.js';

export function render(el, stats) {
  el.innerHTML = `<h2>Admin</h2><canvas width="360" height="120"></canvas>
    <p>${formatCompact(stats.total)} events</p>`;
  drawChart(el.querySelector('canvas'), stats.series);
  return { validEmail: isEmail(stats.owner), validTotal: isPositive(stats.total) };
}
