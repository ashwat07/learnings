// No dynamic APIs, no uncached fetches → this route is STATIC. It is rendered at build time
// and every request is served from the full route cache.
//
// The timestamp is the proof: in a production build it is frozen at build time.
export default async function Page() {
  const renderedAt = new Date().toISOString();
  return (
    <>
      <h1>Full route cache: static</h1>
      <p>Rendered at <code>{renderedAt}</code></p>
      <p style={{ color: '#9a9ab0' }}>
        Run a production build (<code>npm run build && npm start</code>) and reload repeatedly.
        This timestamp will not change: the HTML was produced once at build time.
      </p>
      <p style={{ color: '#9a9ab0' }}>
        In <code>next dev</code> it changes on every reload, because dev re-renders everything.
        That difference is why caching bugs are invisible in development.
      </p>
    </>
  );
}
