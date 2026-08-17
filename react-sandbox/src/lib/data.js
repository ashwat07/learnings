/** The dataset every React lab renders. Deterministic, so runs are comparable. */
const FIRST = ['ada', 'grace', 'alan', 'linus', 'barbara', 'edsger', 'donald', 'radia', 'karen', 'margaret'];
const TEAMS = ['core', 'infra', 'ui', 'data', 'ml', 'ops', 'growth'];
const STATUS = ['active', 'idle', 'blocked'];

export function makeRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `${FIRST[i % FIRST.length]}-${i}`,
    team: TEAMS[i % TEAMS.length],
    status: STATUS[(i * 7) % STATUS.length],
    score: (i * 2654435761) % 1000,
    updatedAt: new Date(1700000000000 + i * 60000).toISOString(),
  }));
}

/** The lab server, proxied through vite so everything is same-origin. */
export const api = {
  rows: (n = 200) => fetch(`/api/rows?n=${n}`).then((r) => r.json()),
  slow: (key, delay = 400) =>
    fetch(`/api/asset?name=react-${key}&type=json&delay=${delay}&cc=no-store`).then((r) => r.json()),
  flaky: (failEvery = 3) => fetch(`/api/flaky?failEvery=${failEvery}`).then(async (r) => {
    if (!r.ok) throw new Error(`server said ${r.status}`);
    return r.json();
  }),
};
