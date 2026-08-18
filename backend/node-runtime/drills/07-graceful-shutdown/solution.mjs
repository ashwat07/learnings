/**
 * Drill 07 — graceful shutdown.
 *
 * The starting point is what almost every Node service does, and it is wrong in a specific,
 * expensive way: `server.close()` stops accepting NEW connections and then waits for every
 * EXISTING connection to close. With keep-alive on — which is every client since about 2015 —
 * an idle socket that will not be reused for another 60 seconds keeps your process alive for 60
 * seconds. Kubernetes gives you 30 by default, then SIGKILL, which drops whatever was genuinely
 * in flight. So the "graceful" shutdown drops requests and the ungraceful one would not have.
 *
 *   createShutdown(server, { graceMs, onDraining }) -> async () => 'clean' | 'forced'
 *
 * Node gives you exactly the tools you need here, and they are not well known:
 *   server.closeIdleConnections()   close the sockets that are NOT mid-request
 *   server.closeAllConnections()    close everything, including mid-request
 *   server.on('request', ...)       fires for every request, including keep-alive reuse
 *   res.on('finish' | 'close')      when a response is done
 *
 * The ordering matters more than the API. Think about what the load balancer knows and when.
 */

export function createShutdown(server, { graceMs, onDraining }) {
  return async function shutdown() {
    onDraining();
    await new Promise((resolve) => server.close(resolve));
    return 'clean';
  };
}
