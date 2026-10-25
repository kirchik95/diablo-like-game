import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};
const outside = path => path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
const gzipAccepted = header => (header ?? '').split(',').some(value => {
  const [coding, ...options] = value.trim().split(';');
  const quality = options.find(option => option.trim().startsWith('q='));
  return coding === 'gzip' && (!quality || Number(quality.trim().slice(2)) > 0);
});

// Export the handler so the Node suite can exercise actual file streams and headers without a socket.
export function createDistHandler(root) {
  const rootPath = resolve(root);
  const canonicalRoot = realpath(rootPath);
  // A missing dist should be an HTTP error rather than an unhandled rejection before the first request.
  canonicalRoot.catch(() => {});
  return async (req, res) => {
    const fail = (status, message) => {
      res.statusCode = status;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(req.method === 'HEAD' ? undefined : message);
    };
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); fail(405, 'Method not allowed'); return; }
    let pathname;
    try { pathname = decodeURIComponent((req.url ?? '/').split('?')[0]); }
    catch { fail(400, 'Malformed URL'); return; }
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') ||
      pathname.split('/').some(part => part.startsWith('.'))) { fail(403, 'Forbidden'); return; }
    if (pathname === '/') pathname = '/index.html';
    const file = resolve(rootPath, `.${pathname}`);
    if (outside(relative(rootPath, file))) { fail(403, 'Forbidden'); return; }
    let info;
    try {
      const actual = await realpath(file);
      if (outside(relative(await canonicalRoot, actual))) { fail(403, 'Forbidden'); return; }
      info = await stat(actual);
      if (!info.isFile()) { fail(404, 'Not found'); return; }
    } catch (error) {
      fail(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, 'Not found'); return;
    }
    const extension = extname(file).toLowerCase();
    const compressible = ['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg'].includes(extension);
    const gzip = compressible && gzipAccepted(req.headers['accept-encoding']);
    res.setHeader('Content-Type', mimeTypes[extension] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', pathname === '/index.html' || pathname === '/version.json' ? 'no-store'
      : /^\/assets\/.+-[\w-]{8,}\.[\w]+$/.test(pathname) ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (compressible) res.setHeader('Vary', 'Accept-Encoding');
    if (gzip) res.setHeader('Content-Encoding', 'gzip');
    else res.setHeader('Content-Length', info.size);
    if (req.method === 'HEAD') { res.end(); return; }
    try {
      const source = createReadStream(file);
      if (gzip) await pipeline(source, createGzip(), res);
      else await pipeline(source, res);
    } catch { res.destroy(); } // A phone may leave mid-download; keep the server running.
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = { '--port': '5183', '--host': '0.0.0.0', '--dir': resolve(dirname(fileURLToPath(import.meta.url)), '../dist') };
  for (let i = 0; i < args.length; i += 2) {
    if (!(args[i] in options) || !args[i + 1]) throw new Error('Usage: node scripts/serve-dist.mjs [--port 5183] [--host 0.0.0.0] [--dir dist]');
    options[args[i]] = args[i + 1];
  }
  const port = Number(options['--port']);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const root = await realpath(options['--dir']);
  const server = createServer(createDistHandler(root));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, options['--host'], () => console.log(`Ночной ритуал: http://${options['--host']}:${port}/ · ${root}`));
}
