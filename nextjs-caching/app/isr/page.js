// Time-based revalidation of a whole route: rendered once, served from the cache, and
// re-rendered in the background at most every `revalidate` seconds.
export const revalidate = 15;

import { url } from '../lib/data.js';

export default async function Page() {
  const data = await fetch(url('isr'), { next: { revalidate: 15 } })
    .then((r) => r.json());
  return (
    <>
      <h1>ISR: revalidate = 15s</h1>
      <p>Route rendered at <code>{new Date().toISOString()}</code></p>
      <p>Data hit #{data.serverHits}, served at <code>{data.servedAt}</code></p>
      <p style={{ color: '#9a9ab0' }}>
        In a production build: reload repeatedly. Both timestamps stay frozen for 15 seconds. The
        first request after that still gets the OLD page — and triggers a background re-render —
        so the new timestamp appears on the request after that. Stale-while-revalidate, exactly as
        in the rendering-strategies course.
      </p>
    </>
  );
}
