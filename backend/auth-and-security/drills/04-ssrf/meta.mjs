export const title = 'SSRF — the webhook that reads your cloud credentials';
export const task = `Your product lets users register a webhook URL. Implement
isAllowedUrl(url, { lookup }).

lookup(hostname) resolves a name to addresses — the runner injects a fake DNS so the drill is
deterministic and works offline. USE IT: one of the attacks is a perfectly ordinary-looking
hostname that resolves to 127.0.0.1, and no amount of string matching will catch that.

The runner is the attacker: cloud metadata, localhost in six spellings, private ranges, non-HTTP
schemes, userinfo confusion, and the DNS trick — while also checking you have not simply blocked
everything.`;
export const passIf = 'every attack URL is refused and every legitimate one is allowed';

// A fake DNS, so the drill is hermetic. The last two entries are the interesting ones.
const FAKE_DNS = {
  'metadata.google.internal': ['169.254.169.254'],
  'hooks.example.com': ['93.184.216.34'],
  'api.partner.io': ['18.175.68.225'],
  'example.com': ['93.184.216.34'],
  'evil.attacker.com': ['127.0.0.1'],            // looks public, points home
  'dual.attacker.com': ['93.184.216.34', '10.0.0.5'],   // one good address, one internal
};
const lookup = async (hostname) => {
  const addrs = FAKE_DNS[hostname];
  if (!addrs) { const e = new Error('ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }
  return addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

const ATTACKS = [
  ['http://169.254.169.254/latest/meta-data/', 'AWS/GCP metadata — the classic prize'],
  ['http://metadata.google.internal/computeMetadata/v1/', 'GCP metadata by name'],
  ['http://localhost:6380/', 'localhost'],
  ['http://127.0.0.1/admin', 'loopback by IP'],
  ['http://127.1/admin', 'loopback, short form'],
  ['http://[::1]:8080/', 'loopback, IPv6'],
  ['http://0.0.0.0:8080/', 'the unspecified address'],
  ['http://10.0.0.5/internal', 'private range 10/8'],
  ['http://192.168.1.1/', 'private range 192.168/16'],
  ['http://172.16.0.1/', 'private range 172.16/12'],
  ['file:///etc/passwd', 'a non-HTTP scheme'],
  ['gopher://127.0.0.1:6380/_INFO', 'gopher — a protocol-smuggling classic'],
  ['http://user:pass@evil.com@127.0.0.1/', 'userinfo confusion'],
  ['https://evil.attacker.com/webhook', 'a public-looking NAME that resolves to 127.0.0.1'],
  ['https://dual.attacker.com/webhook', 'resolves to one public AND one private address'],
  ['https://nonexistent.invalid/hook', 'a name that does not resolve at all'],
];
const LEGITIMATE = [
  'https://hooks.example.com/webhook',
  'https://api.partner.io/v1/events?token=abc',
  'http://example.com:8080/hook',
];

export async function check(s) {
  if (typeof s.isAllowedUrl !== 'function') return [{ check: 'exports isAllowedUrl(url, { lookup })', actual: 'missing', pass: false }];

  const call = async (u) => { try { return await s.isAllowedUrl(u, { lookup }) === true; } catch { return false; } };

  const allowedAttacks = [];
  for (const [url, why] of ATTACKS) if (await call(url)) allowedAttacks.push(why);

  const blockedLegit = [];
  for (const url of LEGITIMATE) if (!(await call(url))) blockedLegit.push(url);

  return [
    { check: `all ${ATTACKS.length} attack URLs refused`, actual: allowedAttacks.length ? `ALLOWED: ${allowedAttacks[0]}${allowedAttacks.length > 1 ? ` (+${allowedAttacks.length - 1})` : ''}` : 'all refused', pass: allowedAttacks.length === 0 },
    { check: 'legitimate URLs still allowed', actual: blockedLegit.length ? `blocked ${blockedLegit.length}` : 'all allowed', pass: blockedLegit.length === 0 },
  ];
}
