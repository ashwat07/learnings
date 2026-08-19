/**
 * Drill 05 — Server-Sent Events.
 *
 * The starting point streams events and works beautifully in a demo. It has three problems, and
 * all three appear the moment there is a proxy and a real network between you and the client:
 *
 *   · it ignores Last-Event-ID, so every reconnect either loses everything that happened while
 *     the client was away, or replays the whole history
 *   · it writes the payload straight into `data:`, so anything containing a newline corrupts the
 *     stream — and JSON with an embedded \n is not exotic, it is a user typing Enter
 *   · it never sends a heartbeat, so nginx closes the connection after 60 idle seconds and the
 *     client reconnects in a loop forever
 *
 *   createStream(log, { heartbeatMs, onTick }) -> (req, res) => void
 *
 *   log.since(id, limit)  events after that id; null means "start", and a RETURN of null means
 *                         "I do not know that id" — it is too old, or it never existed
 *   log.append(event)     { type, data, id }
 *
 * The format, in full:
 *
 *     : this is a comment, used as a heartbeat
 *     retry: 3000
 *     id: 42
 *     event: message
 *     data: first line
 *     data: second line
 *     <blank line ends the event>
 *
 * Fields are LINE-oriented. Multi-line data is multiple `data:` lines, and the client rejoins
 * them with "\n". That is the whole fix for the second bug.
 */

export function createStream(log, { heartbeatMs = 15_000, onTick } = {}) {
  return function handler(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });

    for (const event of log.since(null)) {
      res.write(`id: ${event.id}\n`);
      res.write(`data: ${event.data}\n\n`);
    }
  };
}
