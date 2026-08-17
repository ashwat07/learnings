export const dynamic = 'force-dynamic';
import Link from 'next/link';

export default function A() {
  return (
    <>
      <h1>Router cache — page A</h1>
      <p>Server-rendered at <code>{new Date().toISOString()}</code></p>
      <p style={{ color: '#9a9ab0' }}>
        This page is <code>force-dynamic</code>: every server render produces a new timestamp.
        Now navigate to B and back <strong>using the links</strong>, and watch whether this
        timestamp changes.
      </p>
      <p>
        <Link href="/router-cache/b" style={{ color: '#7c9cff' }}>→ go to B (client navigation)</Link>
        {' · '}
        <a href="/router-cache/b" style={{ color: '#7c9cff' }}>→ go to B (full page load)</a>
      </p>
    </>
  );
}
