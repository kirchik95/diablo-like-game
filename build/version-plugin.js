import { randomUUID } from 'node:crypto';
import { relative, sep } from 'node:path';

// One id for the document and its modules, never the first value fetched by an old page.
export function versionPlugin() {
  let buildId = randomUUID();
  let root = '', base = '/';
  const payload = () => JSON.stringify({ buildId });
  const noStore = (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if ([base, `${base}index.html`, `${base}version.json`].includes(path)) res.setHeader('Cache-Control', path === `${base}version.json` ? 'no-store' : 'no-cache');
    next();
  };
  return {
    name: 'ritual-version',
    configResolved(config) { root = config.root; base = config.base; },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'ritual-version', content: buildId }, injectTo: 'head-prepend' }];
    },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: payload() + '\n' }); },
    configureServer(server) {
      server.watcher.on('all', (event, file) => {
        const path = relative(root, file).split(sep).join('/');
        if (['add', 'change', 'unlink'].includes(event)
          && (/^(src|assets|public)\//.test(path) || ['index.html', 'vite.config.js', 'package-lock.json'].includes(path))) {
          buildId = randomUUID();
        }
      });
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] === `${base}version.json`) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(payload());
        } else noStore(req, res, next);
      });
    },
    // Preview reads the emitted file; it must never advertise a new config-time id.
    configurePreviewServer(server) { server.middlewares.use(noStore); },
  };
}
