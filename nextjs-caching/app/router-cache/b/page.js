export const dynamic = 'force-dynamic';
import Link from 'next/link';

export default function B() {
  return (
    <>
      <h1>Router cache — page B</h1>
      <p>Server-rendered at <code>{new Date().toISOString()}</code></p>
      <p>
        <Link href="/router-cache/a" style={{ color: '#7c9cff' }}>← back to A (client navigation)</Link>
        {' · '}
        <a href="/router-cache/a" style={{ color: '#7c9cff' }}>← back to A (full page load)</a>
      </p>
      <p style={{ color: '#9a9ab0' }}>
        If A&apos;s timestamp is unchanged when you return by Link, that is the CLIENT-SIDE router
        cache serving a payload it already had — even though the route is force-dynamic and the
        server would have produced something new.
      </p>
    </>
  );
}
