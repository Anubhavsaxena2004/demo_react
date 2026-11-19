import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8080);
const backendUrl = process.env.BACKEND_URL;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

if (!backendUrl) {
  console.error('BACKEND_URL is required. Set it to the private backend URL, for example http://10.0.0.12:4000.');
  process.exit(1);
}
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('Frontend build not found. Run `npm run build` first.');
  process.exit(1);
}

const target = new URL(backendUrl);
const proxyRequest = target.protocol === 'https:' ? httpsRequest : httpRequest;
const server = createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://frontend.local').pathname;

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const upstream = proxyRequest(new URL(req.url, target), {
      method: req.method,
      headers: {
        ...req.headers,
        host: target.host,
        'x-forwarded-for': req.socket.remoteAddress || '',
        'x-forwarded-proto': req.socket.encrypted ? 'https' : 'http',
      },
      timeout: 60_000, // long enough for a 5 MB photo upload on a slow connection
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Backend request timed out')));
    upstream.on('error', (error) => {
      console.error(`Backend proxy error: ${error.message}`);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'The inventory API is temporarily unavailable.' }));
    });
    req.pipe(upstream);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const candidate = path.resolve(dist, relativePath || 'index.html');
  const safePath = candidate === dist || candidate.startsWith(`${dist}${path.sep}`);
  const filePath = safePath && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : path.join(dist, 'index.html');

  res.setHeader('content-type', mimeTypes[path.extname(filePath)] || 'application/octet-stream');
  res.setHeader('cache-control', path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable');
  if (req.method === 'HEAD') {
    res.writeHead(200).end();
    return;
  }
  createReadStream(filePath).on('error', () => res.writeHead(500).end('Unable to read frontend file')).pipe(res);
});

// Links to a retired port (e.g. :8080) get a redirect to the main address, so old bookmarks and open tabs recover on reload.
const redirectPort = Number(process.env.REDIRECT_PORT || 0);
if (redirectPort) {
  createServer((req, res) => {
    const hostname = (req.headers.host || '').replace(/:\d+$/, '');
    if (!/^[a-z0-9.-]+$/i.test(hostname)) {
      res.writeHead(400).end('Bad request');
      return;
    }
    const location = `http://${hostname}${port === 80 ? '' : `:${port}`}${req.url || '/'}`;
    res.writeHead(301, { location, 'cache-control': 'max-age=3600' }).end();
  }).listen(redirectPort, host, () => console.log(`Redirecting port ${redirectPort} -> ${port}`));
}

server.listen(port, host, () => console.log(`Frontend listening on http://${host}:${port}; API proxy -> ${target.origin}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
