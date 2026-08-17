import { getData, getComputed } from '../lib/data.js';

// force-dynamic so every reload is a fresh render pass — otherwise the full route cache
// (lab 03) would answer and there would be no render to observe.
export const dynamic = 'force-dynamic';

async function Header() { const d = await getData('memo'); return <p>Header saw hit #{d.serverHits}</p>; }
async function Sidebar() { const d = await getData('memo'); return <p>Sidebar saw hit #{d.serverHits}</p>; }
async function Body() { const d = await getData('memo'); return <p>Body saw hit #{d.serverHits}</p>; }
async function Footer() {
  const a = await getComputed('memo');
  const b = await getComputed('memo');
  return <p>Footer called getComputed twice; both returned computedAt {a.computedAt} / {b.computedAt}</p>;
}

export default async function Page() {
  const start = Date.now();
  const first = await getData('memo');
  return (
    <>
      <h1>Request memoization</h1>
      <p style={{ color: '#9a9ab0' }}>
        Four components each ask for the same data. Watch the hit numbers: if they are all the
        same, the four fetches became one.
      </p>
      {/* @ts-expect-error async server components */}
      <Header /><Sidebar /><Body /><Footer />
      <p>Page component itself saw hit #{first.serverHits}; render took {Date.now() - start}ms.</p>
      <p style={{ color: '#9a9ab0' }}>
        Reload. The hit number should increase by exactly ONE per reload if memoization is working
        (plus one for the getComputed pair, which uses a different key).
      </p>
    </>
  );
}
