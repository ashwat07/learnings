/** The world drill 07 runs against: an ordinary http server and an ordinary keep-alive client. */
import http from 'node:http';

export function makeServer() {
  const state = { draining: false, completed: 0, aborted: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(state.draining ? 503 : 200).end(state.draining ? 'draining' : 'ok');
      return;
    }
    const ms = Number(url.searchParams.get('ms') ?? 0);
    const timer = setTimeout(() => { state.completed++; res.end('done'); }, ms);
    res.on('close', () => { if (!res.writableFinished) { state.aborted++; clearTimeout(timer); } });
  });
  server.keepAliveTimeout = 60_000;      // a real one, so idle sockets really do linger
  return { server, state };
}

export const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/** A client that keeps its sockets open between requests — i.e. every client written since 2015. */
export function makeClient(port) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 20 });
  const get = (path) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, agent }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
  return { get, close: () => agent.destroy() };
}
