// Capstone — the terrible dashboard.
//
// Every deliberate mistake is marked `// SIN n:` with the lab that covers it.
// Read README.md before you touch anything: Phase 1 is measurement, not fixing.
//
// As you fix each one, turn the comment into `// FIXED n:` with the measured delta.
// The file becomes its own changelog.

PerfHUD.start({ countReflows: true, note: 'read the README\nbefore fixing' });

const CARD_COUNT = 100;
const ROW_COUNT = 5000;
const BAR_COUNT = 40;

const $ = sel => document.querySelector(sel);
const cardsEl = $('#cards');
const chartsEl = $('#charts');
const tbody = $('#table tbody');
const tooltip = $('#tooltip');
const notifications = $('#notifications');

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------
function seeded(i) { return ((i * 2654435761) % 100000) / 100000; }

const SERVICES = Array.from({ length: CARD_COUNT }, (_, i) => ({
  id: i,
  name: `svc-${i.toString(36).padStart(2, '0')}-${['api', 'web', 'worker', 'cache'][i % 4]}`,
  region: ['us-east-1', 'eu-west-2', 'ap-south-1', 'sa-east-1'][i % 4],
  latency: 20 + Math.round(seeded(i) * 380),
  errorRate: +(seeded(i + 11) * 4).toFixed(2),
}));

const EVENTS = Array.from({ length: ROW_COUNT }, (_, i) => ({
  id: i,
  ts: new Date(1767225600000 + i * 37_000).toISOString().replace('T', ' ').slice(0, 19),
  service: SERVICES[i % CARD_COUNT].name,
  severity: ['info', 'info', 'info', 'warn', 'err'][i % 5],
  message: `event ${i} — ${['deploy completed', 'latency spike', 'cache miss storm',
    'health check failed', 'scaled up', 'retry exhausted'][i % 6]}`,
  duration: Math.round(seeded(i + 3) * 900),
}));

// ---------------------------------------------------------------------------
// cards
// ---------------------------------------------------------------------------
function renderCards() {
  const frag = document.createDocumentFragment();
  for (const s of SERVICES) {
    const el = document.createElement('div');
    el.className = 'card ' + (s.errorRate > 3 ? 'err' : s.errorRate > 1.5 ? 'warn' : 'ok');
    el.dataset.service = s.name;
    el.innerHTML =
      `<div class="name">${s.name}</div>` +
      `<div class="metric">${s.latency}<span class="sub">ms</span></div>` +
      `<div class="sub">${s.region} · ${s.errorRate}% err</div>`;
    frag.appendChild(el);
  }
  cardsEl.textContent = '';
  cardsEl.appendChild(frag);
  $('#card-count').textContent = `${SERVICES.length} services`;
}

// ---------------------------------------------------------------------------
// charts
// SIN 4 (Labs 01 + 03): heights written per frame, with a geometry read interleaved
// inside the same loop. So: one forced layout per bar, per frame, 4 charts × 40 bars.
// ---------------------------------------------------------------------------
let bars = [];
function renderCharts() {
  chartsEl.textContent = '';
  for (let c = 0; c < 4; c++) {
    const chart = document.createElement('div');
    chart.className = 'chart';
    for (let b = 0; b < BAR_COUNT; b++) {
      const bar = document.createElement('div');
      bar.className = 'bar';
      chart.appendChild(bar);
    }
    chartsEl.appendChild(chart);
  }
  bars = [...chartsEl.querySelectorAll('.bar')];
}

let chartFrame = 0;
function updateCharts(t) {
  bars.forEach((bar, i) => {
    const v = (Math.sin(t / 500 + i / 3) + 1) / 2;
    bar.style.height = 8 + v * 100 + 'px';
    // SIN 4: reading offsetHeight right after writing height forces layout — 160 times a frame.
    if (bar.offsetHeight > 200) bar.style.height = '200px';
  });
  chartFrame = requestAnimationFrame(updateCharts);
}

// ---------------------------------------------------------------------------
// table
// SIN 7 (Lab 05): all 5,000 rows in the DOM.
// SIN 8 (Lab 10): two listeners per row, and the rows are replaced wholesale on every
//                 search keystroke — so the old listeners' closures pile up.
// SIN 6 (Labs 05 + 07): built by string concatenation, then parsed with innerHTML.
// ---------------------------------------------------------------------------
const rowHandlers = [];   // SIN 8: retains every handler closure ever created

function renderTable(rows) {
  let html = '';
  for (const r of rows) {
    html +=
      `<tr data-id="${r.id}">` +
      `<td>${r.ts}</td>` +
      `<td>${r.service}</td>` +
      `<td class="sev-${r.severity}">${r.severity}</td>` +
      `<td>${r.message}</td>` +
      `<td>${r.duration}ms</td>` +
      `</tr>`;
  }
  tbody.innerHTML = html;                    // SIN 6

  // SIN 8: a listener per row, per render. Nothing is ever removed.
  for (const tr of tbody.children) {
    const onEnter = () => showTooltip(tr, EVENTS[+tr.dataset.id]);
    const onClick = () => pushNotification(`inspect ${tr.dataset.id}`);
    tr.addEventListener('mouseenter', onEnter);
    tr.addEventListener('click', onClick);
    rowHandlers.push(onEnter, onClick);
  }

  $('#row-count').textContent = `${rows.length.toLocaleString()} of ${ROW_COUNT.toLocaleString()} rows in the DOM`;
}

// SIN 6 (Lab 07): filters 5,000 rows and rebuilds the entire table synchronously, on every
// keystroke, with no debounce and no yielding.
function onSearch(e) {
  const q = e.target.value.toLowerCase();
  const filtered = q
    ? EVENTS.filter(r => r.message.toLowerCase().includes(q) || r.service.includes(q))
    : EVENTS;
  renderTable(filtered);
}

// ---------------------------------------------------------------------------
// tooltip
// SIN 3 (Labs 02 + 03): top/left writes on every mousemove, no rAF coalescing,
// plus a getBoundingClientRect read to "keep it on screen".
// ---------------------------------------------------------------------------
let tooltipTarget = null;

function showTooltip(el, data) {
  tooltipTarget = data;
  tooltip.hidden = false;
  tooltip.textContent = data
    ? `${data.service} · ${data.severity} · ${data.duration}ms`
    : el.dataset.service || '';
}

function onMouseMove(e) {
  if (tooltip.hidden) return;
  // SIN 3: layout property writes…
  tooltip.style.left = e.clientX + 14 + 'px';
  tooltip.style.top = e.clientY + 14 + 'px';
  // …and then a forced read, so we can "flip" the tooltip near the edge.
  const box = tooltip.getBoundingClientRect();
  if (box.right > innerWidth) tooltip.style.left = e.clientX - box.width - 14 + 'px';
  if (box.bottom > innerHeight) tooltip.style.top = e.clientY - box.height - 14 + 'px';
}

// ---------------------------------------------------------------------------
// notifications
// SIN 9 (Lab 09): appended forever. Each one has a box-shadow, so the paint cost grows too.
// ---------------------------------------------------------------------------
let notificationCount = 0;
function pushNotification(text) {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  notifications.appendChild(li);            // SIN 9: never trimmed
  notificationCount++;
}

// ---------------------------------------------------------------------------
// resize
// SIN 5 (Lab 01): measures every card individually, then writes to it. Classic thrash,
// triggered by a high-frequency event.
// ---------------------------------------------------------------------------
function onResize() {
  for (const card of cardsEl.children) {
    const box = card.getBoundingClientRect();          // read
    card.style.fontSize = Math.max(12, box.width / 16) + 'px';   // write → dirty
    card.querySelector('.metric').style.letterSpacing =          // read again next iteration
      box.width > 220 ? '0.01em' : '0em';
  }
}

// ---------------------------------------------------------------------------
// polling
// SIN 11 (Labs 05 + 08): re-renders EVERYTHING every 2 seconds, whether or not
// anything changed.
// ---------------------------------------------------------------------------
let pollTimer = null;
function startPolling() {
  pollTimer = setInterval(() => {
    for (const s of SERVICES) {
      s.latency = Math.max(10, s.latency + Math.round((Math.random() - 0.5) * 60));
    }
    renderCards();                                   // SIN 11: full re-render
    renderTable(EVENTS.slice(0, currentRowLimit));   // SIN 11: and the whole table
    pushNotification('poll: metrics refreshed');
  }, 2000);
}
let currentRowLimit = ROW_COUNT;

// ---------------------------------------------------------------------------
// settings
// SIN 10 (Lab 07): synchronous localStorage write per keystroke. localStorage is
// blocking, and JSON.stringify of a growing object is not free.
// ---------------------------------------------------------------------------
const settings = { name: '', notes: '', history: [] };
function onSettingsInput(e) {
  settings[e.target.id.replace('setting-', '')] = e.target.value;
  settings.history.push({ at: Date.now(), value: e.target.value });   // and it grows forever
  localStorage.setItem('terrible-dashboard', JSON.stringify(settings));
}

// ---------------------------------------------------------------------------
// panels
// SIN 1: sidebar width transition. SIN 2: drawer/modal `left` transitions (in CSS).
// SIN 15 (Lab 04): the theme toggle flips a class on <html>, repainting everything —
// and it's fine as a one-off, but try it WHILE the charts are animating.
// ---------------------------------------------------------------------------
function toggleSidebar() {
  $('#sidebar').classList.toggle('collapsed');   // SIN 1: transitions `width`
}
function toggleTheme() {
  document.documentElement.classList.toggle('light');   // SIN 15
}

// ---------------------------------------------------------------------------
// widget mounting
// SIN 16 (Labs 09 + 10): a window listener added every time the widget mounts,
// never removed. Mount it a few hundred times via polling and watch the heap.
// ---------------------------------------------------------------------------
const mountedWidgets = [];
function mountWidget() {
  const el = document.createElement('div');
  el.innerHTML = '<span>hidden widget</span>'.repeat(20);
  const onScroll = () => { el.dataset.y = String(scrollY); };
  window.addEventListener('scroll', onScroll);    // SIN 16: never removed
  mountedWidgets.push(el);                        // and the element is retained too
  return el;
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------
$('#sidebar-toggle').addEventListener('click', toggleSidebar);
$('#theme-toggle').addEventListener('click', toggleTheme);
$('#search').addEventListener('input', onSearch);              // SIN 6: no debounce
document.addEventListener('mousemove', onMouseMove);           // SIN 3: not passive, not coalesced
window.addEventListener('resize', onResize);                   // SIN 5: no coalescing
$('#setting-name').addEventListener('input', onSettingsInput); // SIN 10
$('#setting-notes').addEventListener('input', onSettingsInput);

$('#drawer-toggle').addEventListener('click', () => $('#drawer').classList.toggle('open'));
$('#drawer-close').addEventListener('click', () => $('#drawer').classList.remove('open'));
$('#modal-toggle').addEventListener('click', () => {
  $('#modal').classList.add('open');
  $('#modal-backdrop').classList.add('open');
});
const closeModal = () => {
  $('#modal').classList.remove('open');
  $('#modal-backdrop').classList.remove('open');
};
$('#modal-close').addEventListener('click', closeModal);
$('#modal-backdrop').addEventListener('click', closeModal);

cardsEl.addEventListener('mouseover', e => {
  const card = e.target.closest('.card');
  if (card) showTooltip(card, null);
});
cardsEl.addEventListener('mouseout', () => { tooltip.hidden = true; });
$('#table-wrap').addEventListener('mouseleave', () => { tooltip.hidden = true; });

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
console.time('[capstone] initial render');
renderCards();
renderCharts();
renderTable(EVENTS);
console.timeEnd('[capstone] initial render');

chartFrame = requestAnimationFrame(updateCharts);
startPolling();
setInterval(mountWidget, 3000);        // SIN 16, on a timer

// A tiny status line, so the damage is visible without a panel open.
const status = document.createElement('div');
Object.assign(status.style, {
  position: 'fixed', bottom: '0', left: '0', right: '0', zIndex: 200,
  font: '11px/1.6 ui-monospace, Menlo, monospace', color: '#9098ac',
  background: '#0d0d12ee', borderTop: '1px solid #262633', padding: '4px 10px',
  whiteSpace: 'pre',
});
document.body.appendChild(status);
setInterval(() => {
  status.textContent =
    `FPS ${String(PerfHUD.stats.fps).padStart(3)} | ` +
    `worst frame ${PerfHUD.stats.worstEver.toFixed(0).padStart(4)}ms | ` +
    `long tasks ${String(PerfHUD.stats.longTasks).padStart(4)} | ` +
    `geometry reads ${PerfHUD.stats.reflowReads.toLocaleString().padStart(9)} | ` +
    `DOM nodes ${document.getElementsByTagName('*').length.toLocaleString().padStart(7)} | ` +
    `notifications ${notificationCount} | row handlers ${rowHandlers.length.toLocaleString()} | ` +
    `widgets ${mountedWidgets.length}` +
    (performance.memory ? ` | heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB` : '');
}, 500);

console.info(
  '%c[capstone] 16 deliberate sins are live. Read README.md — Phase 1 is measurement, not fixing.',
  'color:#ffd166'
);
