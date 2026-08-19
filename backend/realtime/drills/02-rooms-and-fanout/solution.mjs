/**
 * Drill 02 — rooms, presence, fan-out.
 *
 * The starting point works. It works in development, it works in your integration tests, and it
 * works in production for exactly as long as you run one process. Then you scale to two pods and
 * half your users stop receiving anything, intermittently, in a way that looks like a client bug.
 *
 *   createHub({ bus, instanceId, authenticate, maxBuffered, missedPongsAllowed })
 *
 *     connect(socket, { token }) -> Promise<boolean>
 *     join(socket, room) / leave(socket, room)
 *     publish(room, message)
 *     presence(room) -> Promise<number>     across ALL instances
 *     tick()                                one heartbeat round
 *     pong(socket)                          the client answered
 *     stats() -> { sockets, rooms }
 *
 * The bus (see ../../world.mjs) is Redis pub/sub: subscribe(channel, fn), publish(channel, msg).
 * Fire and forget — no replay, no acknowledgement, and it delivers your own publications back to
 * you, which is where the infinite loop comes from if you are not careful.
 *
 * Four things the starting point does not do, and each one is a production incident:
 *   1. it authenticates nothing
 *   2. rooms are local to this process
 *   3. a socket that has silently died stays in the room forever
 *   4. a client that stops reading becomes your memory
 */

export function createHub({ bus, instanceId, authenticate, maxBuffered = 1 << 20, missedPongsAllowed = 2 }) {
  const rooms = new Map();      // room -> Set<socket>

  return {
    async connect(socket) {
      return true;              // everybody is welcome
    },

    join(socket, room) {
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room).add(socket);
    },

    leave(socket, room) {
      rooms.get(room)?.delete(socket);
    },

    publish(room, message) {
      for (const socket of rooms.get(room) ?? []) {
        socket.send(JSON.stringify(message));
      }
    },

    async presence(room) {
      return rooms.get(room)?.size ?? 0;
    },

    async tick() {},
    pong() {},
    stats() { return { sockets: 0, rooms: rooms.size }; },
  };
}
