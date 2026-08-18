/**
 * export async function isAllowedUrl(url, { lookup }) -> boolean
 *
 * A user gives you a webhook URL and your server will fetch it. That makes your server a proxy
 * INSIDE your network — which is what SSRF (Server-Side Request Forgery) exploits.
 *
 * The version below is the one everybody writes first, and it fails on almost every attack.
 *
 * Useful:
 *   new URL(u)                 throws on garbage; gives .protocol, .hostname, .port, .username
 *   await lookup(hostname)     -> [{ address, family }]  (throws if it does not resolve)
 *   net.isIP(host)             0 / 4 / 6
 *
 * Think about: blocklist or allowlist? Is checking the HOSTNAME enough? And what should happen
 * when a name resolves to several addresses, only one of which is internal?
 */
export async function isAllowedUrl(url, { lookup }) {
  const u = new URL(url);
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return false;
  return true;
}
