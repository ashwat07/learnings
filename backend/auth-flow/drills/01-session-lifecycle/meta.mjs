import { makeStore, makeClock } from '../../world.mjs';

export const title = 'The whole session lifecycle — and the logout that does not';
export const task = `You have all the pieces already: hashed passwords, rotating refresh tokens,
signed access tokens. Assemble them, and the seams start failing.

  createAuth({ store, secret, clock }) -> {
    register(email, password)                  -> user
    login(email, password, device)             -> { accessToken, refreshToken }
    verify(accessToken)                        -> { userId, sessionId }  | throws
    refresh(refreshToken)                      -> { accessToken, refreshToken }
    logout(refreshToken)
    logoutEverywhere(userId)
    changePassword(userId, oldPassword, newPassword)
    sessions(userId)                           -> [{ id, device, createdAt, lastUsedAt }]
  }

The contract that makes this hard: AN ACCESS TOKEN MUST STOP WORKING WITHIN ONE SECOND OF LOGOUT.
A stateless JWT does not do that — it is valid until it expires, which is the entire point of it —
so you have to decide what verify() checks, and then make that check cheap enough to run on every
single request.

The clock is yours to read (clock.now()); the harness advances it. The store counts its reads and
its scans separately.

(Use a CHEAP KDF here — scrypt at N=2^12 — so the suite runs in seconds. Choosing the parameter
properly is auth-and-security drill 01; this drill is about the lifecycle around it.)`;
export const passIf = 'every seam holds: concurrent refresh, logout, logout-everywhere, password change — and verify() stays O(1) with 5,000 revoked sessions';

const SECRET = 'test-secret-not-a-real-one';
const ACCESS_TTL = 15 * 60_000;

const setup = () => {
  const store = makeStore();
  const clock = makeClock();
  return { store, clock };
};

export async function check(s) {
  if (typeof s.createAuth !== 'function') return [{ check: 'exports createAuth({ store, secret, clock })', actual: 'missing', pass: false }];
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 66), pass: false }); }
  };
  const fresh = async () => {
    const { store, clock } = setup();
    const auth = s.createAuth({ store, secret: SECRET, clock });
    await auth.register('ada@example.com', 'correct horse battery staple');
    return { auth, store, clock };
  };
  const ok = async (p) => p.then(() => true, () => false);

  // ---- the parts that already work in isolation ----

  await guard('login issues tokens and verify accepts the access token', async () => {
    const { auth } = await fresh();
    const t = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    if (!t?.accessToken || !t?.refreshToken) return `login returned ${JSON.stringify(Object.keys(t ?? {}))}`;
    const claims = await auth.verify(t.accessToken);
    return claims?.userId != null ? true : `verify returned ${JSON.stringify(claims)}`;
  });

  await guard('the wrong password is rejected', async () => {
    const { auth } = await fresh();
    return (await ok(auth.login('ada@example.com', 'wrong', 'laptop'))) ? 'it accepted the wrong password' : true;
  });

  await guard('a tampered or foreign-signed access token is rejected', async () => {
    const { auth, store, clock } = await fresh();
    const t = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    const tampered = t.accessToken.slice(0, -4) + 'AAAA';
    if (await ok(auth.verify(tampered))) return 'a tampered token verified';
    const other = s.createAuth({ store, secret: 'a-different-secret', clock });
    const forged = await other.login('ada@example.com', 'correct horse battery staple', 'laptop')
      .then((x) => x.accessToken, () => null);
    if (forged && await ok(auth.verify(forged))) return 'a token signed with a different secret verified';
    return true;
  });

  await guard('an expired access token is rejected', async () => {
    const { auth, clock } = await fresh();
    const t = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    clock.advance(ACCESS_TTL + 60_000);
    return (await ok(auth.verify(t.accessToken))) ? 'an expired token still verified' : true;
  });

  await guard('refresh rotates: the old refresh token stops working', async () => {
    const { auth } = await fresh();
    const t1 = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    const t2 = await auth.refresh(t1.refreshToken);
    if (!t2?.refreshToken) return 'refresh returned no new refresh token';
    if (t2.refreshToken === t1.refreshToken) return 'refresh returned the SAME token — that is not rotation';
    return (await ok(auth.refresh(t1.refreshToken))) ? 'the old refresh token still works' : true;
  });

  // ---- the seams ----

  // Two tabs. Two mobile app threads. A retry after a timeout. This happens constantly.
  await guard('SEAM: two concurrent refreshes with the same token — exactly one wins', async () => {
    const { auth } = await fresh();
    const t1 = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    const results = await Promise.allSettled([auth.refresh(t1.refreshToken), auth.refresh(t1.refreshToken)]);
    const won = results.filter((r) => r.status === 'fulfilled');
    if (won.length === 0) return 'both refreshes failed — a double-submit must not lock the user out on the first try';
    if (won.length === 2) {
      const a = won[0].value.refreshToken, b = won[1].value.refreshToken;
      return `both refreshes succeeded and issued ${a === b ? 'the same' : 'two different'} tokens — ` +
        `one refresh token now has two valid successors, and reuse detection can never tell a race from theft`;
    }
    return true;
  });

  await guard('SEAM: a genuinely REUSED old token kills the whole family', async () => {
    const { auth } = await fresh();
    const t1 = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    const t2 = await auth.refresh(t1.refreshToken);
    const t3 = await auth.refresh(t2.refreshToken);
    // An attacker replays a token from two rotations ago.
    await auth.refresh(t1.refreshToken).catch(() => {});
    return (await ok(auth.refresh(t3.refreshToken)))
      ? 'the current token still works after an old one was replayed — a stolen token means the ' +
        'whole family is compromised and must die'
      : true;
  });

  // THE one. A stateless token and a logout button are individually correct.
  await guard('SEAM: after logout, the ACCESS token stops working too', async () => {
    const { auth, clock } = await fresh();
    const t = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    if (!(await ok(auth.verify(t.accessToken)))) return 'the access token did not work before logout';
    await auth.logout(t.refreshToken);
    clock.advance(1000);
    return (await ok(auth.verify(t.accessToken)))
      ? 'the access token still verifies after logout. A signed JWT is valid until it expires — ' +
        'that is what "stateless" means — so verify() has to check something that logout changed'
      : true;
  });

  await guard('...and the refresh token is dead too', async () => {
    const { auth } = await fresh();
    const t = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    await auth.logout(t.refreshToken);
    return (await ok(auth.refresh(t.refreshToken))) ? 'logout left the refresh token usable' : true;
  });

  await guard('SEAM: logout on one device does not sign the others out', async () => {
    const { auth } = await fresh();
    const laptop = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    const phone = await auth.login('ada@example.com', 'correct horse battery staple', 'phone');
    await auth.logout(laptop.refreshToken);
    if (await ok(auth.verify(laptop.accessToken))) return 'the laptop is still signed in';
    return (await ok(auth.verify(phone.accessToken))) ? true : 'logging out the laptop signed the phone out too';
  });

  await guard('SEAM: logoutEverywhere kills every device, including ones holding only an access token', async () => {
    const { auth, clock } = await fresh();
    const a = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    const b = await auth.login('ada@example.com', 'correct horse battery staple', 'phone');
    const c = await auth.login('ada@example.com', 'correct horse battery staple', 'tablet');
    await auth.logoutEverywhere(1);
    clock.advance(1000);
    const alive = [];
    for (const [name, t] of [['laptop', a], ['phone', b], ['tablet', c]]) {
      if (await ok(auth.verify(t.accessToken))) alive.push(`${name} access`);
      if (await ok(auth.refresh(t.refreshToken))) alive.push(`${name} refresh`);
    }
    return alive.length === 0 ? true : `still valid: ${alive.join(', ')}`;
  });

  await guard('SEAM: changing the password signs the OTHER devices out', async () => {
    const { auth, clock } = await fresh();
    const laptop = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    const phone = await auth.login('ada@example.com', 'correct horse battery staple', 'phone');
    await auth.changePassword(1, 'correct horse battery staple', 'a whole new passphrase');
    clock.advance(1000);
    const phoneAlive = (await ok(auth.verify(phone.accessToken))) || (await ok(auth.refresh(phone.refreshToken)));
    if (phoneAlive) {
      return 'the other device is still signed in after a password change — which is exactly the ' +
        'case where the user is changing it BECAUSE someone else has access';
    }
    // The old password must not work either.
    return (await ok(auth.login('ada@example.com', 'correct horse battery staple', 'laptop')))
      ? 'the old password still works' : true;
  });

  await guard('sessions() lists the devices, and refresh updates lastUsedAt', async () => {
    const { auth, clock } = await fresh();
    await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    const phone = await auth.login('ada@example.com', 'correct horse battery staple', 'phone');
    const before = await auth.sessions(1);
    if (before?.length !== 2) return `sessions() returned ${before?.length} entries, want 2`;
    if (!before.every((x) => x.device && x.createdAt != null && x.id != null)) return `entries look like ${JSON.stringify(before[0])}`;
    if (before.some((x) => JSON.stringify(x).includes('$') || /token/i.test(Object.keys(x).join()))) {
      return 'sessions() is leaking a token or a hash — this list goes to the browser';
    }
    clock.advance(60_000);
    await auth.refresh(phone.refreshToken);
    const after = await auth.sessions(1);
    const p = after.find((x) => x.device === 'phone');
    return p.lastUsedAt > before.find((x) => x.device === 'phone').lastUsedAt
      ? true : 'lastUsedAt did not move after a refresh — a session list nobody can act on';
  });

  // The implementation question. Every correctness check above is passable by scanning; this one
  // is not. A SCAN is a scan whatever its current size — the row count only decides how long you
  // have before it matters, so the check is structural rather than a stopwatch.
  await guard('COST: verify() performs no SCAN, whatever the revocation history', async () => {
    const { auth, store } = await fresh();
    for (let i = 0; i < 40; i++) {
      const t = await auth.login('ada@example.com', 'correct horse battery staple', `device-${i}`);
      await auth.logout(t.refreshToken);
    }
    const live = await auth.login('ada@example.com', 'correct horse battery staple', 'current');
    store.reset();
    for (let i = 0; i < 100; i++) await auth.verify(live.accessToken);
    const { scans } = store.counters;
    return scans === 0
      ? true
      : `verify() performed ${scans} table SCANS across 100 calls. Every request now gets slower ` +
        `as the revocation history grows, and the history only ever grows.`;
  });

  await guard('COST: verify() does at most ONE store read per call', async () => {
    const { auth, store } = await fresh();
    const live = await auth.login('ada@example.com', 'correct horse battery staple', 'current');
    store.reset();
    for (let i = 0; i < 100; i++) await auth.verify(live.accessToken);
    const perCall = store.counters.reads / 100;
    return perCall <= 1
      ? true
      : `${perCall.toFixed(1)} reads per verify(). This runs on every authenticated request in ` +
        `your service — one indexed read is the budget, and zero is achievable with a short cache.`;
  });

  await guard('COST: verify() does not need the password hash', async () => {
    const { auth } = await fresh();
    const t = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    const claims = await auth.verify(t.accessToken);
    const blob = JSON.stringify(claims ?? {});
    return /\$|hash|password/i.test(blob)
      ? `verify() returned ${blob.slice(0, 60)} — the claims go to your handlers and often into logs`
      : true;
  });

  await guard('the access token carries no secret in its payload', async () => {
    const { auth } = await fresh();
    const t = await auth.login('ada@example.com', 'correct horse battery staple', 'laptop');
    // A JWT payload is base64, not encryption. Anyone holding the token can read it.
    const parts = String(t.accessToken).split('.');
    const decoded = parts.map((p) => { try { return Buffer.from(p, 'base64url').toString('utf8'); } catch { return ''; } }).join(' ');
    return /password|\$scrypt|\$2[aby]\$|secret/i.test(decoded)
      ? `the token body contains ${/password/i.test(decoded) ? 'a password' : 'a hash or secret'} — a JWT is SIGNED, not ENCRYPTED`
      : true;
  });

  return out;
}
