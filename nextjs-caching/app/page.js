import { version } from 'next/package.json';

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <>
      <h1>Next.js caching layers</h1>
      <p style={{ color: '#9a9ab0' }}>
        Running Next.js <code>{version}</code>. Caching defaults have changed between major
        versions — <strong>measure, do not assume</strong>. Every page here prints the numbers it
        was rendered with, and the lab server on :8080 counts how many times the data
        source was actually hit (<a href="http://localhost:8080/api/stats" style={{ color: '#7c9cff' }}>/api/stats</a>).
      </p>
      <ol style={{ color: '#9a9ab0', lineHeight: 2 }}>
        <li><a href="/memo" style={{ color: '#7c9cff' }}>Request memoization</a> — four components, one fetch</li>
        <li><a href="/data-cache" style={{ color: '#7c9cff' }}>Data cache</a> — across requests, with revalidation and tags</li>
        <li><a href="/static" style={{ color: '#7c9cff' }}>Full route cache</a> — and <a href="/dynamic" style={{ color: '#7c9cff' }}>what opts you out</a></li>
        <li><a href="/isr" style={{ color: '#7c9cff' }}>ISR</a> — time-based revalidation of a whole route</li>
        <li><a href="/router-cache/a" style={{ color: '#7c9cff' }}>Router cache</a> — the client-side one that surprises everyone</li>
      </ol>
      <p style={{ color: '#9a9ab0' }}>
        Rendered at {new Date().toISOString()} (this page is <code>force-dynamic</code>, so that
        timestamp changes on every load — which is your control).
      </p>
    </>
  );
}
