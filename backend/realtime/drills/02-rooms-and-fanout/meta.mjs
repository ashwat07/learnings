import { makeBus, makeSocket, sleep } from '../../world.mjs';

export const title = 'Rooms, presence and fan-out across instances';
export const task = `The moment you run two copies of your server, an in-process room is wrong:
half your users are connected to the other pod and never hear anything. Every "it worked in dev
and broke in prod" real-time bug is this.

Implement createHub({ bus, instanceId, authenticate, maxBuffered }):

  connect(socket, { token })   authenticate BEFORE accepting. There is no 401 after the upgrade.
  join(socket, room) / leave(socket, room)
  publish(room, message)       to local members AND to the other instances, exactly once each
  presence(room)               how many are in this room, across ALL instances
  tick()                       one heartbeat round: ping, and hang up on whoever never answered

The bus behaves like Redis pub/sub: fire and forget, no replay, and it delivers your own
publications back to you. That last part is where the infinite loop lives.`;
export const passIf = 'auth happens before accept, messages arrive once on both instances, dead and slow sockets are cut, and nothing leaks after a disconnect';

const AUTH = async (token) => (token === 'good' ? { userId: 'u1' } : token === 'good2' ? { userId: 'u2' } : null);

export async function check(s) {
  if (typeof s.createHub !== 'function') return [{ check: 'exports createHub(options)', actual: 'missing', pass: false }];
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 64), pass: false }); }
  };
  const settle = () => sleep(20);

  await guard('a bad token is rejected before the socket joins anything', async () => {
    const bus = makeBus();
    const hub = s.createHub({ bus, instanceId: 'a', authenticate: AUTH });
    const sock = makeSocket({ id: 's1' });
    const ok = await hub.connect(sock, { token: 'nope' });
    await settle();
    if (ok) return 'connect() accepted an invalid token';
    if (!sock.closed) return 'the socket was left open — an unauthenticated socket you never close is a socket that stays';
    // 4000-4999 is the application-private range; 4401 is the convention for "unauthorised".
    return sock.closed.code >= 4000 && sock.closed.code < 5000
      ? true : `closed with code ${sock.closed.code}, want something in the 4000-4999 application range`;
  });

  await guard('a good token connects', async () => {
    const bus = makeBus();
    const hub = s.createHub({ bus, instanceId: 'a', authenticate: AUTH });
    const sock = makeSocket({ id: 's1' });
    const ok = await hub.connect(sock, { token: 'good' });
    return (ok && !sock.closed) ? true : `connect returned ${ok}, closed=${JSON.stringify(sock.closed)}`;
  });

  await guard('a message reaches the room, and only the room', async () => {
    const bus = makeBus();
    const hub = s.createHub({ bus, instanceId: 'a', authenticate: AUTH });
    const inRoom = makeSocket({ id: 'in' }), elsewhere = makeSocket({ id: 'out' });
    await hub.connect(inRoom, { token: 'good' });
    await hub.connect(elsewhere, { token: 'good2' });
    hub.join(inRoom, 'lobby');
    hub.join(elsewhere, 'other');
    hub.publish('lobby', { text: 'hello' });
    await settle();
    if (elsewhere.received.length) return `a socket in "other" received ${elsewhere.received.length} messages`;
    return inRoom.received.length === 1 ? true : `the room member got ${inRoom.received.length} messages`;
  });

  // The one that only shows up in production.
  await guard('a message crosses to a SECOND instance', async () => {
    const bus = makeBus();
    const a = s.createHub({ bus, instanceId: 'a', authenticate: AUTH });
    const b = s.createHub({ bus, instanceId: 'b', authenticate: AUTH });
    const onA = makeSocket({ id: 'a1' }), onB = makeSocket({ id: 'b1' });
    await a.connect(onA, { token: 'good' });
    await b.connect(onB, { token: 'good2' });
    a.join(onA, 'lobby');
    b.join(onB, 'lobby');
    a.publish('lobby', { text: 'cross' });
    await settle();
    if (onB.received.length === 0) return 'the socket on instance B heard nothing — an in-process room only works with one process';
    return (onA.received.length === 1 && onB.received.length === 1)
      ? true : `A got ${onA.received.length}, B got ${onB.received.length}`;
  });

  await guard('...exactly once — no echo loop between instances', async () => {
    const bus = makeBus();
    const a = s.createHub({ bus, instanceId: 'a', authenticate: AUTH });
    const b = s.createHub({ bus, instanceId: 'b', authenticate: AUTH });
    const onB = makeSocket({ id: 'b1' });
    await b.connect(onB, { token: 'good' });
    b.join(onB, 'lobby');
    a.publish('lobby', { text: 'once' });
    await sleep(60);
    return onB.received.length === 1
      ? true : `delivered ${onB.received.length} times — re-publishing what you received is an infinite loop with a delay fuse`;
  });

  await guard('three instances, one publish, one delivery each', async () => {
    const bus = makeBus();
    const hubs = ['a', 'b', 'c'].map((id) => s.createHub({ bus, instanceId: id, authenticate: AUTH }));
    const socks = [];
    for (const [i, hub] of hubs.entries()) {
      const sock = makeSocket({ id: `s${i}` });
      await hub.connect(sock, { token: 'good' });
      hub.join(sock, 'lobby');
      socks.push(sock);
    }
    hubs[1].publish('lobby', { text: 'fan' });
    await sleep(60);
    const counts = socks.map((x) => x.received.length);
    return counts.every((n) => n === 1) ? true : `deliveries per socket: ${counts.join(',')}`;
  });

  await guard('presence counts members on every instance', async () => {
    const bus = makeBus();
    const a = s.createHub({ bus, instanceId: 'a', authenticate: AUTH });
    const b = s.createHub({ bus, instanceId: 'b', authenticate: AUTH });
    for (const [hub, n] of [[a, 2], [b, 3]]) {
      for (let i = 0; i < n; i++) {
        const sock = makeSocket({ id: `${i}` });
        await hub.connect(sock, { token: 'good' });
        hub.join(sock, 'lobby');
      }
    }
    await sleep(60);
    const got = await a.presence('lobby');
    return got === 5 ? true : `presence = ${got}, want 5 (2 here + 3 on the other instance)`;
  });

  await guard('leaving removes you — from the room AND from presence', async () => {
    const bus = makeBus();
    const a = s.createHub({ bus, instanceId: 'a', authenticate: AUTH });
    const sock = makeSocket({ id: 's' });
    await a.connect(sock, { token: 'good' });
    a.join(sock, 'lobby');
    await sleep(20);
    a.leave(sock, 'lobby');
    await sleep(20);
    a.publish('lobby', { text: 'after' });
    await settle();
    const presence = await a.presence('lobby');
    return (sock.received.length === 0 && presence === 0) ? true : `${sock.received.length} messages after leaving, presence ${presence}`;
  });

  await guard('a socket that closes is cleaned up — no leak in the room map', async () => {
    const bus = makeBus();
    const a = s.createHub({ bus, instanceId: 'a', authenticate: AUTH });
    for (let i = 0; i < 500; i++) {
      const sock = makeSocket({ id: `s${i}` });
      await a.connect(sock, { token: 'good' });
      a.join(sock, 'lobby');
      sock.close(1000, 'bye');
    }
    await sleep(60);
    const presence = await a.presence('lobby');
    const size = a.stats?.().sockets;
    if (presence !== 0) return `presence is ${presence} after 500 disconnects`;
    return (size === undefined || size === 0) ? true : `${size} sockets still tracked`;
  });

  // TCP will not tell you. A phone that goes into a tunnel leaves a socket that is "open" for
  // minutes, and every message you send it goes nowhere.
  await guard('a socket that never pongs is closed after a few heartbeats', async () => {
    const bus = makeBus();
    const a = s.createHub({ bus, instanceId: 'a', authenticate: AUTH, missedPongsAllowed: 2 });
    const alive = makeSocket({ id: 'alive' });
    const dead = makeSocket({ id: 'dead' });
    await a.connect(alive, { token: 'good' });
    await a.connect(dead, { token: 'good2' });
    alive.on('ping', () => a.pong(alive));
    for (let i = 0; i < 4; i++) { await a.tick(); await sleep(5); }
    if (alive.closed) return 'it hung up on a socket that was answering';
    return dead.closed ? true : 'the dead socket is still open — and every message to it is going nowhere';
  });

  await guard('a client that never drains is cut, not buffered forever', async () => {
    const bus = makeBus();
    const a = s.createHub({ bus, instanceId: 'a', authenticate: AUTH, maxBuffered: 64 * 1024 });
    const slow = makeSocket({ id: 'slow', drains: false });   // reads nothing, ever
    await a.connect(slow, { token: 'good' });
    a.join(slow, 'firehose');
    for (let i = 0; i < 5000; i++) a.publish('firehose', { i, pad: 'x'.repeat(200) });
    await sleep(60);
    if (!slow.closed) return `still connected with ${(slow.bufferedAmount / 1024).toFixed(0)}KB buffered — one slow client is now your memory`;
    return slow.bufferedAmount < 1024 * 1024
      ? true : `${(slow.bufferedAmount / 1024 / 1024).toFixed(1)}MB queued before it gave up`;
  });

  await guard('publishing to an empty room is not an error', async () => {
    const bus = makeBus();
    const a = s.createHub({ bus, instanceId: 'a', authenticate: AUTH });
    a.publish('nobody-here', { x: 1 });
    await settle();
    return true;
  });

  await guard('a message sent to a closed socket does not take the hub down', async () => {
    const bus = makeBus();
    const a = s.createHub({ bus, instanceId: 'a', authenticate: AUTH });
    const s1 = makeSocket({ id: '1' }), s2 = makeSocket({ id: '2' });
    await a.connect(s1, { token: 'good' });
    await a.connect(s2, { token: 'good2' });
    a.join(s1, 'lobby'); a.join(s2, 'lobby');
    s1.vanish();                                  // gone, with no close event — a lost connection
    a.publish('lobby', { text: 'still here?' });
    await settle();
    return s2.received.length === 1
      ? true : `the surviving socket got ${s2.received.length} messages — one dead peer must not stop the fan-out`;
  });

  return out;
}
