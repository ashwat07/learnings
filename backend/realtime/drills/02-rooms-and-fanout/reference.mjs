/** Drill 02 — reference. */

export function createHub({ bus, instanceId, authenticate, maxBuffered = 1 << 20, missedPongsAllowed = 2 }) {
  const rooms = new Map();           // room -> Set<socket>
  const meta = new WeakMap();        // socket -> { user, rooms:Set, missedPongs }
  const subscribed = new Map();      // room -> unsubscribe fn
  const remoteCounts = new Map();    // room -> Map<instanceId, count>
  // A real Set, not just the WeakMap. A WeakMap cannot be iterated — which is exactly what makes
  // it leak-proof and exactly why it cannot drive a heartbeat. You need both: the WeakMap for
  // per-socket state, and an explicit Set for "who is connected right now", removed in drop().
  const connected = new Set();

  const roomChannel = (room) => `room:${room}`;
  const presenceChannel = 'presence';

  // Every instance reports its own local count whenever it changes, and remembers what the others
  // last said. This is presence over PUB/SUB, and its honest limitation is worth stating: if an
  // instance dies without saying goodbye, its count is stuck until something corrects it. Real
  // systems fix that with a TTL — a Redis key per instance, refreshed on a heartbeat, expiring on
  // its own — which is the same idea plus an expiry.
  const announce = (room) => {
    bus.publish(presenceChannel, { instanceId, room, count: rooms.get(room)?.size ?? 0 });
  };

  bus.subscribe(presenceChannel, (msg) => {
    if (msg.instanceId === instanceId) return;
    if (!remoteCounts.has(msg.room)) remoteCounts.set(msg.room, new Map());
    remoteCounts.get(msg.room).set(msg.instanceId, msg.count);
  });

  const ensureSubscribed = (room) => {
    if (subscribed.has(room)) return;
    subscribed.set(room, bus.subscribe(roomChannel(room), (envelope) => {
      // THE ECHO GUARD. The bus delivers our own publication back to us, and if we treat it like
      // any other inbound message we deliver twice; if we also re-publish it, we have built an
      // amplifier that takes out the whole cluster. One field, checked once.
      if (envelope.from === instanceId) return;
      deliverLocal(room, envelope.message);
    }));
  };

  const drop = (socket, code, reason) => {
    const info = meta.get(socket);
    if (info) {
      for (const room of info.rooms) {
        rooms.get(room)?.delete(socket);
        if (rooms.get(room)?.size === 0) {
          rooms.delete(room);
          subscribed.get(room)?.();      // stop listening to a room nobody here is in
          subscribed.delete(room);
        }
        announce(room);
      }
      meta.delete(socket);
    }
    connected.delete(socket);
    try { if (!socket.closed) socket.close(code, reason); } catch { /* already gone */ }
  };

  const deliverLocal = (room, message) => {
    const payload = JSON.stringify(message);
    for (const socket of [...(rooms.get(room) ?? [])]) {
      // BACKPRESSURE. A WebSocket has no flow control you can rely on: send() queues, and if the
      // client never reads, the queue is your heap. One phone on a train can OOM a pod serving
      // ten thousand healthy connections.
      //
      // For a live feed, DISCONNECTING is the right answer: the client reconnects and resyncs from
      // a snapshot, which is cheaper and more correct than delivering an hour-old backlog. For a
      // chat, you would drop to a "you missed messages, reload" state instead. What you must not
      // do is nothing.
      if (socket.bufferedAmount > maxBuffered) {
        drop(socket, 1013, 'too slow');           // 1013 = Try Again Later
        continue;
      }
      try { socket.send(payload); }
      catch { drop(socket, 1011, 'send failed'); } // a dead peer must not stop the fan-out
    }
  };

  return {
    // AUTHENTICATE DURING/BEFORE THE ACCEPT. After the upgrade there are no status codes — you
    // cannot return 401, only close with a code — and an unauthenticated socket that stays open
    // is a socket an attacker can use to consume resources. Close codes 4000-4999 are the
    // application-private range; 4401 as "unauthorised" is a widespread convention, not a standard.
    async connect(socket, { token } = {}) {
      const user = await authenticate?.(token);
      if (!user) {
        socket.close(4401, 'unauthorized');
        return false;
      }
      meta.set(socket, { user, rooms: new Set(), missedPongs: 0 });
      connected.add(socket);
      // Clean up on close, once, here — rather than hoping every call site remembers.
      socket.on('close', () => drop(socket, 1000, 'closed'));
      return true;
    },

    join(socket, room) {
      const info = meta.get(socket);
      if (!info) throw new Error('join before connect');
      ensureSubscribed(room);
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room).add(socket);
      info.rooms.add(room);
      announce(room);
    },

    leave(socket, room) {
      rooms.get(room)?.delete(socket);
      meta.get(socket)?.rooms.delete(room);
      if (rooms.get(room)?.size === 0) {
        rooms.delete(room);
        subscribed.get(room)?.();
        subscribed.delete(room);
      }
      announce(room);
    },

    publish(room, message) {
      deliverLocal(room, message);                                  // ours, now
      bus.publish(roomChannel(room), { from: instanceId, message }); // everyone else's, shortly
    },

    async presence(room) {
      const local = rooms.get(room)?.size ?? 0;
      let remote = 0;
      for (const n of (remoteCounts.get(room) ?? new Map()).values()) remote += n;
      return local + remote;
    },

    // The heartbeat. TCP will happily hold a connection open for many minutes after the peer has
    // physically gone — a tunnel, a closed laptop, a NAT that dropped the mapping — and every
    // message you send to it succeeds locally and arrives nowhere. A ping the client must answer
    // is the only way to find out, and the interval you choose is how long a ghost lingers.
    async tick() {
      for (const socket of allSockets()) {
        const info = meta.get(socket);
        if (!info) continue;
        if (info.missedPongs >= missedPongsAllowed) {
          drop(socket, 1001, 'no pong');            // 1001 = Going Away
          continue;
        }
        info.missedPongs++;
        try { socket.emit('ping'); } catch { drop(socket, 1011, 'ping failed'); }
      }
    },

    pong(socket) {
      const info = meta.get(socket);
      if (info) info.missedPongs = 0;
    },

    stats() {
      return { sockets: allSockets().size, rooms: rooms.size };
    },
  };

  // The heartbeat must reach sockets that have connected but joined no room — they are just as
  // capable of being dead, and just as capable of sitting there for an hour.
  function allSockets() { return connected; }
}

/*
SCALING FAN-OUT — the four stages, in the order you will meet them

  1. ONE PROCESS, in-memory rooms. Correct up to one pod. Simple, fast, and a trap the moment you
     autoscale.
  2. REDIS PUB/SUB (this drill). Every instance subscribes to the rooms it has members in. Cheap,
     stateless, at-most-once. If an instance is briefly disconnected from Redis, the messages it
     missed are gone — which is fine for a cursor position and not fine for a chat message.
  3. A DURABLE LOG — Redis Streams, Kafka, NATS JetStream — when clients must be able to catch up
     after a disconnect. Now every message has an id and clients resume from theirs, which is the
     same design as SSE's Last-Event-ID (drill 05) and as jobs-and-messaging drill 02.
  4. A DEDICATED LAYER — Centrifugo, Ably, Pusher — when connection count outgrows the thing you
     wanted to be building.

THE THREE THINGS THAT BREAK AT THE ONE-TO-TWO-INSTANCE STEP, EVERY TIME
  · rooms (this drill)
  · rate limiters, because an in-process counter means N pods = N x your limit
  · anything sticky — a session in memory, an upload assembled across requests
All three have the same fix and the same signature: it worked in dev.

DO NOT USE PUB/SUB AS A QUEUE
Redis pub/sub has no persistence, no acknowledgement and no consumer groups. A subscriber that
was not connected at the moment of publication never learns the message existed. If your feature
says "must not be lost", you want a stream (jobs-and-messaging drill 02) — the two APIs look
similar and their guarantees are not comparable.
*/
