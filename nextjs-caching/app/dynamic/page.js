import { headers, cookies } from 'next/headers';

// Reading headers() or cookies() makes a route DYNAMIC: it cannot be rendered ahead of time,
// because its output depends on the request. One call anywhere in the tree does this — including
// inside a component three levels down, or inside a library you did not write.
export default async function Page() {
  const h = await headers();
  const c = await cookies();
  return (
    <>
      <h1>Full route cache: dynamic</h1>
      <p>Rendered at <code>{new Date().toISOString()}</code></p>
      <p style={{ color: '#9a9ab0' }}>
        This page called <code>headers()</code>, so it opted out of the full route cache. Reload
        after a production build: the timestamp changes every time.
      </p>
      <p style={{ color: '#9a9ab0' }}>
        user-agent: <code>{(h.get('user-agent') ?? '').slice(0, 60)}</code><br />
        cookies: <code>{c.getAll().length}</code>
      </p>
      <p style={{ color: '#9a9ab0' }}>
        The other opt-outs: <code>cookies()</code>, <code>searchParams</code>,
        <code> connection()</code>, <code>noStore()</code>, <code>export const dynamic =
        &apos;force-dynamic&apos;</code>, and an uncached fetch (depending on your version).
      </p>
    </>
  );
}
