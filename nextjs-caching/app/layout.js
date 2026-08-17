export const metadata = { title: 'Next.js caching labs' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, background: '#0d0d12', color: '#e9e9f2',
        font: '15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}>
        <header style={{ padding: '12px 18px', borderBottom: '1px solid #2a2a38', display: 'flex', gap: 16 }}>
          <strong>Next.js caching labs</strong>
          <nav style={{ display: 'flex', gap: 12, fontSize: 14 }}>
            <a href="/" style={{ color: '#7c9cff' }}>home</a>
            <a href="/memo" style={{ color: '#7c9cff' }}>memoization</a>
            <a href="/data-cache" style={{ color: '#7c9cff' }}>data cache</a>
            <a href="/static" style={{ color: '#7c9cff' }}>static</a>
            <a href="/dynamic" style={{ color: '#7c9cff' }}>dynamic</a>
            <a href="/isr" style={{ color: '#7c9cff' }}>isr</a>
            <a href="/router-cache/a" style={{ color: '#7c9cff' }}>router cache</a>
          </nav>
        </header>
        <main style={{ padding: 18, maxWidth: 900 }}>{children}</main>
      </body>
    </html>
  );
}
