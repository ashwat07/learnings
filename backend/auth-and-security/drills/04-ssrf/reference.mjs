/**
 * The rules, in the order they matter:
 *
 * 1. ALLOWLIST THE SCHEME. http and https only. file:, gopher:, ftp:, dict: and data: are all
 *    fetchable by some client somewhere, and gopher:// in particular can be used to speak Redis.
 *
 * 2. RESOLVE THE NAME AND CHECK THE ADDRESS — not the hostname. A blocklist of "localhost" and
 *    "127.0.0.1" misses 127.1, 0.0.0.0, [::1], 2130706433, and any domain the attacker controls
 *    that simply has an A record pointing at 127.0.0.1. Only the resolved IP tells the truth.
 *
 * 3. BLOCK EVERY PRIVATE / SPECIAL RANGE, not just loopback: link-local 169.254/16 (the cloud
 *    metadata endpoint), 10/8, 172.16/12, 192.168/16, 0.0.0.0/8, and the IPv6 equivalents
 *    (::1, fc00::/7, fe80::/10) — including IPv4-mapped IPv6, which is how this gets bypassed.
 *
 * 4. This still leaves DNS REBINDING: the name resolves to a public address when you check and a
 *    private one when you fetch. You cannot close that in a validation function. The real fixes
 *    are to pin the resolved address and connect to THAT, or to make the egress network incapable
 *    of reaching anything internal — which is the only defence that actually holds.
 *
 * And the ones outside this function: never follow redirects blindly (re-validate every hop),
 * set a timeout and a response-size cap, and strip credentials before logging the URL.
 */
import net from 'node:net';

const isPrivateV4 = (ip) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
         (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
         (a === 100 && b >= 64 && b <= 127) || a >= 224;
};

const isPrivateV6 = (ip) => {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (s === '::1' || s === '::') return true;
  if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s)) return true;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);      // IPv4-mapped IPv6
  return mapped ? isPrivateV4(mapped[1]) : false;
};

const isBlocked = (ip) => (net.isIP(ip) === 6 ? isPrivateV6(ip) : isPrivateV4(ip));

export async function isAllowedUrl(url, { lookup }) {
  let u;
  try { u = new URL(url); } catch { return false; }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;              // userinfo confusion

  const host = u.hostname.replace(/^\[|\]$/g, '');

  // A literal IP: check it directly.
  if (net.isIP(host)) return !isBlocked(host);

  // A name: resolve it and check EVERY address it returns.
  try {
    const addrs = await lookup(host);
    if (!addrs.length) return false;
    // EVERY address must be safe. A name resolving to one public and one private address is a
    // deliberate bypass — you do not control which one the HTTP client will pick.
    return addrs.every((a) => !isBlocked(a.address));
  } catch {
    return false;                                          // cannot resolve → cannot verify → refuse
  }
}
