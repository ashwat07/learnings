/**
 * The world the realtime drills run against.
 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A pub/sub bus with Redis's semantics, and Redis's limitations:
 *
 *   · FIRE AND FORGET. A message published while nobody is subscribed is gone. There is no
 *     backlog, no replay, no acknowledgement. (Redis Streams give you those — see
 *     jobs-and-messaging drill 02 — pub/sub does not.)
 *   · the publisher receives its own message too, if it is subscribed
 *   · delivery is asynchronous, so ordering ACROSS instances is not guaranteed
 */
export function makeBus() {
  const channels = new Map();
  const stats = { published: 0, delivered: 0 };
  return {
    stats,
    subscribe(channel, fn) {
      if (!channels.has(channel)) channels.set(channel, new Set());
      channels.get(channel).add(fn);
      return () => channels.get(channel)?.delete(fn);
    },
    publish(channel, message) {
      stats.published++;
      const subs = [...(channels.get(channel) ?? [])];
      // Asynchronous, like a network hop.
      queueMicrotask(() => {
        for (const fn of subs) { stats.delivered++; fn(message); }
      });
    },
    subscriberCount(channel) { return channels.get(channel)?.size ?? 0; },
  };
}

/**
 * A fake socket: everything a WebSocket connection is, minus the network.
 *
 *   send(data)     what the server writes to the client
 *   received       everything the client got, in order
 *   bufferedAmount how much the client has NOT drained — a slow consumer's queue, which is the
 *                  server's memory. A client that stops reading must not be able to grow this
 *                  without limit (node-runtime drill 05, over a socket).
 */
export function makeSocket({ id, drains = true } = {}) {
  const received = [];
  let buffered = 0;
  let closed = null;
  const listeners = new Map();

  const sock = {
    id,
    get received() { return received; },
    get bufferedAmount() { return buffered; },
    get closed() { return closed; },
    get readyState() { return closed ? 3 : 1; },
    send(data) {
      if (closed) throw new Error('send on a closed socket');
      buffered += Buffer.byteLength(String(data));
      received.push(String(data));
      if (drains) queueMicrotask(() => { buffered = Math.max(0, buffered - Buffer.byteLength(String(data))); });
    },
    close(code = 1000, reason = '') { if (!closed) closed = { code, reason }; sock.emit('close', code, reason); },
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return sock; },
    off(event, fn) { listeners.get(event)?.delete(fn); return sock; },
    emit(event, ...args) { for (const fn of [...(listeners.get(event) ?? [])]) fn(...args); },
    /** The client says something. */
    clientSends(data) { sock.emit('message', data); },
    /** The client's connection dies without a close frame — a tunnel, a lost signal, a laptop lid. */
    vanish() { closed = { code: 1006, reason: 'abnormal' }; },
  };
  return sock;
}
