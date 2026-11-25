import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

// Built bundles name their files by content hash, so a changed file always has a new name.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
  'Referrer-Policy': 'same-origin',
};

// Every page this server hands out carries the platform layer, so an app gets it without asking.
// It goes first in <head>:
// - the theme a person chose (localStorage "emg-theme", see web/platform/theme.js), applied before the first
//   paint so a page never flashes the wrong theme. It is a few statements and never calls the API.
// - the wait screen for a database that is starting after a cost-saving pause, which runs before the app's own
//   scripts so it wraps fetch before they can call it.
// - on an app's pages (not the portal's, which draws him itself), Joules, the portal's helper, in the corner
//   (web/platform/assistant.js, from 1.5.0). A module, so it runs once the page has been read, after the wait screen.
// - on every page, the portal's and an app's, the bell (web/platform/bell.js, from 1.8.0): it waits for the sidebar and puts
//   itself in its tool row, so a page without a sidebar (signing in) never shows it.
export const THEME_SCRIPT = '<script>try{var t=localStorage.getItem("emg-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>';
export const ASSISTANT_SCRIPT = '<script type="module" src="/platform/assistant.js"></script>';
export const BELL_SCRIPT = '<script type="module" src="/platform/bell.js"></script>';
const PLATFORM_LAYER = [
  THEME_SCRIPT,
  '<link rel="stylesheet" href="/platform/db-wake.css">',
  '<script type="module" src="/platform/db-wake.js"></script>',
].join('');

//   assistant  add Joules (an app's pages); a page that already loads either script is not given a second copy
//   bell       add the bell (on unless turned off); a page that already loads it is not given a second copy
export function withPlatformLayer(html, { assistant = false, bell = true } = {}) {
  const text = Buffer.isBuffer(html) ? html.toString('utf8') : String(html);
  const layer = [
    text.includes('/platform/db-wake.js') ? '' : PLATFORM_LAYER,
    assistant && !text.includes('/platform/assistant.js') ? ASSISTANT_SCRIPT : '',
    bell && !text.includes('/platform/bell.js') ? BELL_SCRIPT : '',
  ].join('');
  if (!layer) return Buffer.from(text);
  const opening = /<head(?:\s[^>]*)?>/i.exec(text)
    ?? /<html(?:\s[^>]*)?>/i.exec(text)
    ?? /^\s*<!doctype[^>]*>/i.exec(text);
  const at = opening ? opening.index + opening[0].length : 0;
  return Buffer.from(text.slice(0, at) + layer + text.slice(at));
}

// Serves the app's UI at / and the shared files at /platform/.
//   uiRoot          the folder served at /: web/ for a static UI, web/dist/ for a built one
//   platformRoot    web/platform/, served at /platform/
//   spa             answer an unknown path with no file extension with index.html, so the UI's router handles it
//   signInRedirect  (req, url) => address | null. Called for every HTML page; an address sends the browser there.
//   assistant       true on an app: every page gets Joules (web/platform/assistant.js). The portal leaves it off.
// Resolves once a response has been written.
export function createStaticHandler({ uiRoot, platformRoot, spa = false, signInRedirect = null, assistant = false }) {
  return async function serve(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      res.end('Method not allowed');
      return;
    }
    const onPlatform = url.pathname === '/platform' || url.pathname.startsWith('/platform/');
    const root = onPlatform ? platformRoot : uiRoot;
    const pathname = onPlatform ? url.pathname.slice('/platform'.length) : url.pathname;
    if (!onPlatform && !existsSync(path.join(uiRoot, 'index.html'))) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('The UI has not been built. Run "npm run build".');
      return;
    }
    const options = { hashedAssets: !onPlatform, url, signInRedirect, assistant };
    let served = await serveStatic(req, res, root, pathname, options);
    if (served === 'missing' && spa && !onPlatform && !path.extname(pathname)) {
      served = await serveStatic(req, res, root, '/index.html', options);
    }
    if (served !== 'missing') return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  };
}

async function serveStatic(req, res, root, pathname, { hashedAssets, url, signInRedirect, assistant }) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    relativePath = null;
  }
  if (relativePath === null || relativePath.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return 'handled';
  }

  // A folder index must be addressed with a trailing slash, or its relative links resolve one level up.
  const folderWithoutSlash = !pathname.endsWith('/') && !path.extname(relativePath);
  if (relativePath === '' || relativePath.endsWith('/')) relativePath += 'index.html';
  else if (!path.extname(relativePath)) relativePath = path.join(relativePath, 'index.html');

  const filePath = path.resolve(root, relativePath);
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return 'handled';
  }

  if (folderWithoutSlash && url) {
    try {
      await fs.access(filePath);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR') return 'missing';
      throw error;
    }
    // Collapsed leading slashes keep "//host" out of Location, which a browser would treat as another site.
    const location = `/${url.pathname.replace(/^\/+/, '')}/${url.search}`;
    res.writeHead(301, { Location: location, 'Cache-Control': REVALIDATE, ...SECURITY_HEADERS });
    res.end();
    return 'handled';
  }

  let file;
  try {
    file = await loadStatic(filePath, { assistant });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR') return 'missing';
    throw error;
  }

  // A page, as opposed to a script, style or image. Only pages send a signed-out person to the portal.
  if (signInRedirect && path.extname(filePath).toLowerCase() === '.html') {
    const target = signInRedirect(req, url);
    if (target) {
      res.writeHead(302, { Location: target, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
      res.end();
      return 'handled';
    }
  }

  const type = types[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const hashed = hashedAssets && relative.split(path.sep)[0] === 'assets';
  const cache = hashed ? IMMUTABLE : REVALIDATE;
  const gzip = file.gzip && acceptsGzip(req);
  const body = gzip ? file.gzip : file.body;
  const headers = {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': cache,
    ETag: file.etag,
    Vary: 'Accept-Encoding',
    ...SECURITY_HEADERS,
  };
  if (gzip) headers['Content-Encoding'] = 'gzip';
  if (ifNoneMatch(req, file.etag)) {
    const validators = { ...headers };
    delete validators['Content-Length'];
    delete validators['Content-Encoding'];
    res.writeHead(304, validators);
    res.end();
    return 'handled';
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(body);
  return 'handled';
}

const staticCache = new Map();

function acceptsGzip(req) {
  return /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
}

function ifNoneMatch(req, etag) {
  const header = req.headers['if-none-match'];
  if (!header) return false;
  return header.split(',').some((part) => part.trim() === etag || part.trim() === '*');
}

// A page is kept once with Joules and once without, so the portal and an app in the same process (the tests) each get theirs.
async function loadStatic(filePath, { assistant = false } = {}) {
  const info = await fs.stat(filePath);
  const page = path.extname(filePath).toLowerCase() === '.html';
  const key = page && assistant ? `${filePath}\0assistant` : filePath;
  const cached = staticCache.get(key);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;
  const source = await fs.readFile(filePath);
  const body = page ? withPlatformLayer(source, { assistant }) : source;
  const etag = `W/"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}"`;
  const gzip = body.length >= 1024 ? gzipSync(body, { level: 6 }) : null;
  const entry = { mtimeMs: info.mtimeMs, size: info.size, body, etag, gzip: gzip && gzip.length < body.length ? gzip : null };
  staticCache.set(key, entry);
  if (staticCache.size > 500) staticCache.delete(staticCache.keys().next().value);
  return entry;
}
