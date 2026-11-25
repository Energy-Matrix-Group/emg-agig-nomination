import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createAppServer } from '../../server/platform/create-server.js';
import { ASSISTANT_SCRIPT, BELL_SCRIPT, THEME_SCRIPT, withPlatformLayer } from '../../server/platform/static.js';
import { createFakePortal } from './support/fake-portal.js';
import { createFixtureApp } from './support/fixture-app.js';
import { repoRoot } from './support/source-files.js';
import { signIn, withPlatformServer } from './support/server.js';

const STATIC = { root: 'test/platform/fixtures/ui/staticApp' };
const SPA = { root: 'test/platform/fixtures/ui/spaApp/dist', spa: true };
const LINK = '<link rel="stylesheet" href="/platform/db-wake.css">';
const SCRIPT = '<script type="module" src="/platform/db-wake.js"></script>';
const person = { email: 'sam@energymatrix.com.au', displayName: 'Sam' };

// Runs `run` with a signed-in cookie against an app whose UI is `ui`.
async function withUi(ui, run, options = {}) {
  await withPlatformServer(async (context) => {
    const cookie = await signIn(context.base, context.portal, context.portal.createUser(person));
    await run({ ...context, cookie, get: (path, headers = {}) => fetch(`${context.base}${path}`, { redirect: 'manual', headers: { cookie, ...headers } }) });
  }, { app: createFixtureApp({ ui }), ...options });
}

function getRaw(port, requestTarget, extraHeaders = '') {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${requestTarget} HTTP/1.1\r\nHost: 127.0.0.1\r\n${extraHeaders}Connection: close\r\n\r\n`);
    });
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const [header, body = ''] = raw.split('\r\n\r\n');
      const headers = {};
      for (const line of header.split('\r\n').slice(1)) {
        const index = line.indexOf(':');
        headers[line.slice(0, index).toLowerCase()] = line.slice(index + 1).trim();
      }
      resolve({ status: Number(header.split(' ')[1]), headers, body });
    });
    socket.on('error', reject);
  });
}

// The layer wraps fetch, so it must run before any script that might call the API. Only the theme snippet,
// which sets an attribute and calls nothing, comes before it.
function assertLayerFirst(html, where) {
  assert.ok(html.includes(LINK), `${where} has the wait screen stylesheet`);
  assert.ok(html.includes(SCRIPT), `${where} has the wait screen script`);
  assert.equal(html.split(SCRIPT).length, 2, `${where} has it once`);
  assert.equal(html.split(THEME_SCRIPT).length, 2, `${where} has the theme snippet once`);
  assert.equal(html.indexOf('<script'), html.indexOf(THEME_SCRIPT), `${where} applies the theme first`);
  assert.equal(html.indexOf('<script', html.indexOf(THEME_SCRIPT) + THEME_SCRIPT.length), html.indexOf(SCRIPT), `${where} runs the wait screen before any other script`);
}

test('a static UI is served from its own folder at /', async () => {
  await withUi(STATIC, async ({ get }) => {
    const page = await get('/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    assert.match(await page.text(), /Static demo/);

    const script = await get('/app.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.equal(script.headers.get('x-content-type-options'), 'nosniff');

    assert.equal((await get('/some/page')).status, 404, 'a static UI has no fallback');
  });
});

test('a built UI is served from its build folder with an index fallback and immutable assets', async () => {
  await withUi(SPA, async ({ get }) => {
    const page = await get('/');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    assert.match(await page.text(), /SPA demo/);

    const deep = await get('/tickets/42');
    assert.equal(deep.status, 200);
    assert.match(deep.headers.get('content-type'), /text\/html/);
    assert.match(await deep.text(), /SPA demo/);

    const asset = await get('/assets/main-3f9a1c.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
    assert.match(asset.headers.get('cache-control'), /immutable/);

    assert.equal((await get('/assets/gone-000000.js')).status, 404, 'a missing file with an extension is a 404, not index.html');
    const source = await get('/src/secret.txt');
    assert.equal(source.status, 404);
    assert.equal((await source.text()).includes('never served'), false, 'files outside the build folder are never served');
  });
});

test('the shared files are served at /platform/ and revalidated, never cached for a year', async () => {
  await withUi(STATIC, async ({ get }) => {
    for (const [file, type] of [['api.js', /javascript/], ['shell.js', /javascript/], ['app.css', /text\/css/], ['tokens.css', /text\/css/], ['logo/logo.svg', /svg/]]) {
      const response = await get(`/platform/${file}`);
      assert.equal(response.status, 200, file);
      assert.match(response.headers.get('content-type'), type, file);
      assert.equal(response.headers.get('cache-control'), 'no-cache', file);
    }
    assert.match(await (await get('/platform/tokens.css')).text(), /--emg-app-primary/);
    assert.equal((await get('/platform/nothing.js')).status, 404);
  });
});

test('a UI that has not been built answers 503 and says how to build it', async () => {
  await withUi({ root: 'test/platform/fixtures/ui/unbuilt' }, async ({ get }) => {
    const page = await get('/');
    assert.equal(page.status, 503);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(await page.text(), /has not been built\. Run "npm run build"/);
    assert.equal((await get('/platform/api.js')).status, 200, 'the shared files do not depend on the UI');
  });
});

test('a UI whose build disappears while running answers 503 instead of hanging', { timeout: 5000 }, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'emg-ui-'));
  try {
    await fs.mkdir(path.join(folder, 'dist'));
    await fs.writeFile(path.join(folder, 'dist', 'index.html'), '<p>demo</p>');
    const portal = createFakePortal({ appId: 'echo' });
    const app = createFixtureApp({ ui: { root: 'dist', spa: true } });
    const server = createAppServer({ app, env: portal.env(), directory: portal.directory, root: folder });
    await server.ready;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const cookie = await signIn(base, portal, portal.createUser(person));
      assert.equal((await fetch(`${base}/`, { headers: { cookie } })).status, 200);
      await fs.rm(path.join(folder, 'dist', 'index.html'));
      for (const where of ['/', '/tickets/42']) {
        const response = await fetch(`${base}${where}`, { headers: { cookie } });
        assert.equal(response.status, 503, where);
        await response.text();
      }
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('refuses paths outside the served folders', async () => {
  await withUi(SPA, async ({ server, cookie }) => {
    const port = server.address().port;
    const header = `Cookie: ${cookie}\r\n`;
    const escaped = await getRaw(port, '/%2e%2e%5c%2e%2e%5cserver%5cindex.js', header);
    assert.equal(escaped.status, 403);
    assert.equal(escaped.body.includes('createAppServer'), false);

    const dotted = await getRaw(port, '/../server/index.js', header);
    assert.notEqual(dotted.status, 200);
    assert.equal(dotted.body.includes('createAppServer'), false);

    const platformEscape = await getRaw(port, '/platform/%2e%2e%5c%2e%2e%5cserver%5cindex.js', header);
    assert.equal(platformEscape.status, 403);
    assert.equal(platformEscape.body.includes('createAppServer'), false);

    const buildEscape = await getRaw(port, '/%2e%2e%5csrc%5csecret.txt', header);
    assert.equal(buildEscape.status, 403);
    assert.equal(buildEscape.body.includes('never served'), false);
  });
});

test('a null byte in a path is a bad request, not a server error', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await withUi(STATIC, async ({ server, cookie }) => {
      const header = `Cookie: ${cookie}\r\n`;
      assert.equal((await getRaw(server.address().port, '/platform/%00.js', header)).status, 400);
      assert.equal((await getRaw(server.address().port, '/docs/%00', header)).status, 400);
    });
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors, []);
});

test('a folder without a trailing slash redirects to it, keeping the query', async () => {
  await withUi(STATIC, async ({ server, cookie }) => {
    const header = `Cookie: ${cookie}\r\n`;
    const folder = await getRaw(server.address().port, '/docs?tab=users', header);
    assert.equal(folder.status, 301);
    assert.equal(folder.headers.location, '/docs/?tab=users');

    const slashes = await getRaw(server.address().port, '/.//docs', header);
    assert.equal(slashes.status, 301);
    assert.equal(slashes.headers.location, '/docs/');

    const evil = await getRaw(server.address().port, '//docs', header);
    assert.notEqual(evil.headers.location?.startsWith('//'), true, 'a redirect never starts with two slashes, which a browser reads as another site');

    assert.equal((await getRaw(server.address().port, '/docs/', header)).status, 200);
  });
});

test('pages refuse to be framed by other sites', async () => {
  await withUi(STATIC, async ({ get }) => {
    const page = await get('/');
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  });
});

test('HEAD is answered without a body, and other methods are refused', async () => {
  await withUi(STATIC, async ({ base, get, cookie }) => {
    const head = await fetch(`${base}/`, { method: 'HEAD', headers: { cookie } });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.ok(Number(head.headers.get('content-length')) > 0);

    const post = await fetch(`${base}/`, { method: 'POST', headers: { cookie } });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    assert.equal((await get('/')).status, 200);
  });
});

test('every page the platform serves carries the database wait screen, first', async () => {
  await withUi(SPA, async ({ get }) => {
    for (const page of ['/', '/tickets/42', '/some/deep/link']) {
      const response = await get(page);
      assert.equal(response.status, 200, page);
      assertLayerFirst(await response.text(), page);
    }
  });
  await withUi(STATIC, async ({ get }) => {
    assertLayerFirst(await (await get('/')).text(), 'the static page');
    assertLayerFirst(await (await get('/docs/')).text(), 'a static subfolder page');
  });
});

test('the files the wait screen loads are served', async () => {
  await withUi(STATIC, async ({ get }) => {
    const script = await get('/platform/db-wake.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.match(await script.text(), /X-Database-State/);

    const styles = await get('/platform/db-wake.css');
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /text\/css/);
    assert.match(await styles.text(), /\.db-wake__spinner/);
  });
});

// Joules, the portal's helper, is on every page of an app (web/platform/assistant.js), after the wait screen, so his call to
// /api/me is covered by it like any other.
test('every page of an app carries Joules, once, after the wait screen', async () => {
  await withUi(STATIC, async ({ get }) => {
    for (const [path, where] of [['/', 'the static page'], ['/docs/', 'a subfolder page']]) {
      const html = await (await get(path)).text();
      assert.equal(html.split(ASSISTANT_SCRIPT).length, 2, `${where} has him once`);
      assert.ok(html.indexOf(ASSISTANT_SCRIPT) > html.indexOf(SCRIPT), `${where} has him after the wait screen`);
    }
    const script = await get('/platform/assistant.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.match(await script.text(), /\/clip\/frame\//);
  });
  await withUi(SPA, async ({ get }) => {
    assert.equal((await (await get('/deep/link')).text()).split(ASSISTANT_SCRIPT).length, 2, 'a built UI\'s page has him too');
  });
});

test('/api/me says which app this is, so his frame can ask the portal for the right page', async () => {
  await withUi(STATIC, async ({ get, portal }) => {
    const me = await (await get('/api/me')).json();
    assert.equal(me.appId, 'echo');
    assert.equal(me.portalUrl, portal.env().PORTAL_URL);
  });
});

test('the layer adds Joules only when asked (the portal draws him itself), and never twice', () => {
  const page = '<!doctype html><html><head><title>x</title></head><body></body></html>';
  assert.equal(withPlatformLayer(page).toString().includes(ASSISTANT_SCRIPT), false);
  const app = withPlatformLayer(page, { assistant: true }).toString();
  assert.equal(app.split(ASSISTANT_SCRIPT).length, 2);
  assert.equal(withPlatformLayer(app, { assistant: true }).toString(), app);
  // A page that loads the wait screen itself still gets Joules, and one that loads him itself is left alone.
  const own = '<head><script type="module" src="/platform/db-wake.js"></script></head>';
  assert.equal(withPlatformLayer(own, { assistant: true, bell: false }).toString(), `<head>${ASSISTANT_SCRIPT}<script type="module" src="/platform/db-wake.js"></script></head>`);
  const ownBoth = `<head>${ASSISTANT_SCRIPT}<script type="module" src="/platform/db-wake.js"></script></head>`;
  assert.equal(withPlatformLayer(ownBoth, { assistant: true, bell: false }).toString(), ownBoth);
});

test('the layer adds the bell to every page, the portal\'s and an app\'s, once, unless it is turned off (1.8.0)', () => {
  const page = '<!doctype html><html><head><title>x</title></head><body></body></html>';
  for (const options of [{}, { assistant: true }]) {
    const served = withPlatformLayer(page, options).toString();
    assert.equal(served.split(BELL_SCRIPT).length, 2, JSON.stringify(options));
    assert.equal(withPlatformLayer(served, options).toString(), served, 'never twice');
  }
  assert.equal(withPlatformLayer(page, { bell: false }).toString().includes(BELL_SCRIPT), false);
  assert.match(BELL_SCRIPT, /<script type="module" async /, 'async (1.8.1): it never holds back DOMContentLoaded, so Joules\'s frame arrives as it did without it');
  const own = `<head>${BELL_SCRIPT}<script type="module" src="/platform/db-wake.js"></script></head>`;
  assert.equal(withPlatformLayer(own).toString(), own, 'a page that loads it itself is left alone');
});

test('an app adds the bell only when it can ask the portal for it: with PORTAL_URL and PORTAL_DIRECTORY_TOKEN (1.8.2)', async () => {
  // Without the token every page's request for the list would be an error (a 503 in the browser's console, and a failed page
  // in an app's browser tests), so an app that is not set up for it has no bell at all.
  for (const [env, has] of [[{ PORTAL_DIRECTORY_TOKEN: 'directory-token-for-tests' }, true], [{}, false]]) {
    await withUi(STATIC, async ({ get }) => {
      for (const where of ['/', '/docs/']) {
        const page = await (await get(where)).text();
        assert.equal(page.includes(BELL_SCRIPT), has, `${where} ${has ? 'has' : 'has no'} bell with ${JSON.stringify(Object.keys(env))}`);
        assert.equal(page.includes(ASSISTANT_SCRIPT), true, 'Joules is there either way');
      }
    }, { env });
    await withUi(SPA, async ({ get }) => {
      assert.equal((await (await get('/tickets/42')).text()).includes(BELL_SCRIPT), has, 'a built UI\'s deep link too');
    }, { env });
  }
});

test('only pages are changed, and they stay correctly sized, revalidated and compressible', async () => {
  await withUi(STATIC, async ({ get }) => {
    const script = await get('/platform/api.js');
    assert.equal(await script.text(), await fs.readFile(path.join(repoRoot, 'web', 'platform', 'api.js'), 'utf8'));

    const page = await get('/', { 'Accept-Encoding': 'identity' });
    const html = await page.text();
    assert.equal(Number(page.headers.get('content-length')), Buffer.byteLength(html));
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    assert.match(html, /<title>Static demo/);

    const again = await get('/', { 'If-None-Match': page.headers.get('etag') });
    assert.equal(again.status, 304);

    const zipped = await get('/', { 'Accept-Encoding': 'gzip' });
    assertLayerFirst(await zipped.text(), 'a compressed page');
  });
});

test('a page that already loads the script is not given a second copy', () => {
  const once = withPlatformLayer('<!doctype html><html><head><title>x</title></head><body></body></html>').toString();
  assert.equal(withPlatformLayer(once).toString(), once);
  const own = '<head><script type="module" src="/platform/db-wake.js"></script></head>';
  assert.equal(withPlatformLayer(own, { bell: false }).toString(), own);
});

test('the layer goes in whatever way a page is written', () => {
  const cases = {
    'head with attributes': ['<HEAD lang="en"><title>x</title></HEAD>', '<HEAD lang="en">'],
    'no head': ['<!doctype html><html lang="en"><body>x</body></html>', '<!doctype html><html lang="en">'],
    'doctype only': ['<!doctype html><p>x</p>', '<!doctype html>'],
    'a fragment': ['<p>demo</p>', ''],
  };
  for (const [name, [html, before]] of Object.entries(cases)) {
    assert.equal(withPlatformLayer(html).toString(), `${before}${THEME_SCRIPT}${LINK}${SCRIPT}${BELL_SCRIPT}${html.slice(before.length)}`, name);
  }
  assert.equal(withPlatformLayer('<header>not a head</header>').toString().startsWith(THEME_SCRIPT), true);
});

test('the theme snippet only reads a kept choice and sets the page theme', () => {
  assert.match(THEME_SCRIPT, /^<script>try\{.*\}catch\(e\)\{\}<\/script>$/);
  assert.match(THEME_SCRIPT, /localStorage\.getItem\("emg-theme"\)/);
  assert.match(THEME_SCRIPT, /setAttribute\("data-theme",t\)/);
  assert.doesNotMatch(THEME_SCRIPT, /fetch|XMLHttpRequest|src=|import/);
});

test('a ui.root outside the repository is refused when the server is built', () => {
  const portal = createFakePortal({ appId: 'echo' });
  assert.throws(
    () => createAppServer({ app: createFixtureApp({ ui: { root: '../elsewhere' } }), env: portal.env(), directory: portal.directory }),
    /ui\.root must stay inside the repository/,
  );
});
