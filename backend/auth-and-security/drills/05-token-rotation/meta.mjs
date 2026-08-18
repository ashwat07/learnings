export const title = 'Refresh-token rotation with reuse detection';
export const task = `Implement a refresh endpoint. A refresh token is SINGLE USE: exchanging it
issues a new one and spends the old.

The runner plays an attacker who has stolen a refresh token. It lets the legitimate user rotate
normally, then replays the stolen token — and checks that you notice.`;
export const passIf = 'rotation works, a replay is refused, AND the replay revokes the whole family';

export async function check(s) {
  if (typeof s.issue !== 'function' || typeof s.refresh !== 'function') {
    return [{ check: 'exports issue(userId) and refresh(token)', actual: 'missing', pass: false }];
  }
  const store = s.reset?.() ?? undefined;
  void store;

  const first = await s.issue('user-1');
  const r1 = await s.refresh(first.refreshToken).catch((e) => ({ error: e.message }));
  const rotated = r1?.refreshToken && r1.refreshToken !== first.refreshToken;

  const r2 = await s.refresh(r1?.refreshToken).catch((e) => ({ error: e.message }));
  const stillWorks = Boolean(r2?.refreshToken);

  // The attacker replays the token the user already spent.
  const replay = await s.refresh(first.refreshToken).catch((e) => ({ error: e.message }));
  const replayRefused = !replay?.refreshToken;

  // After detected reuse, the CURRENT token must die too — otherwise the thief still has access.
  const afterDetection = await s.refresh(r2?.refreshToken).catch((e) => ({ error: e.message }));
  const familyRevoked = !afterDetection?.refreshToken;

  const unknown = await s.refresh('never-issued-at-all').catch((e) => ({ error: e.message }));

  return [
    { check: 'issue returns an access + refresh token', actual: first?.refreshToken ? 'ok' : 'missing', pass: Boolean(first?.refreshToken && first?.accessToken) },
    { check: 'refresh ROTATES (a new token comes back)', actual: rotated ? 'rotated' : 'same token returned', pass: Boolean(rotated) },
    { check: 'the new token works', actual: stillWorks ? 'ok' : 'rejected', pass: stillWorks },
    { check: 'replaying a spent token is REFUSED', actual: replayRefused ? 'refused' : 'ACCEPTED — the thief is in', pass: replayRefused },
    { check: 'reuse revokes the whole family', actual: familyRevoked ? 'revoked' : 'the current token still works', pass: familyRevoked },
    { check: 'an unknown token is refused', actual: unknown?.refreshToken ? 'ACCEPTED' : 'refused', pass: !unknown?.refreshToken },
  ];
}
