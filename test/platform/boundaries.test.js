import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { repoRoot, sourceFiles } from './support/source-files.js';

const CODE = /\.(m?js|tsx?)$/;
const TEST_FILE = /\.(test|spec)\./;
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

const serverApp = path.join(repoRoot, 'server', 'app');
const serverPlatform = path.join(repoRoot, 'server', 'platform');
const web = path.join(repoRoot, 'web');
const webPlatform = path.join(web, 'platform');

async function importsIn(directory, { skip = () => false } = {}) {
  const found = [];
  let files = [];
  try {
    files = (await sourceFiles(directory)).filter((name) => CODE.test(name) && !TEST_FILE.test(name) && !skip(name));
  } catch {
    return found;
  }
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    for (const match of source.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      found.push({ file, specifier, resolved: specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null });
    }
  }
  return found;
}

// Code without its comments, so a comment that explains why a library is banned does not trip the check.
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const inside = (folder, target) => {
  const relative = path.relative(folder, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};
const named = (file) => path.relative(repoRoot, file).split(path.sep).join('/');

test('app code reaches the platform only through server/platform/kit.js', async () => {
  const kit = path.join(serverPlatform, 'kit.js');
  for (const { file, specifier, resolved } of await importsIn(serverApp)) {
    if (resolved && inside(serverPlatform, resolved)) {
      assert.equal(resolved, kit, `${named(file)} imports ${specifier}; import from server/platform/kit.js instead`);
    }
  }
});

test('platform code never imports app code', async () => {
  for (const { file, specifier, resolved } of await importsIn(serverPlatform)) {
    if (resolved) assert.equal(inside(serverApp, resolved), false, `${named(file)} imports ${specifier}`);
  }
});

test('the UI imports shared files by their /platform/ address, never by a relative path', async () => {
  const outsidePlatform = (name) => inside(webPlatform, name);
  for (const { file, specifier, resolved } of await importsIn(web, { skip: outsidePlatform })) {
    const where = `${named(file)} imports ${specifier}`;
    if (resolved) assert.equal(inside(webPlatform, resolved), false, `${where}; use /platform/... for shared files`);
    assert.doesNotMatch(specifier, /^\/apps\//, where);
    assert.doesNotMatch(specifier, /^\/(js|css|design)\//, `${where}; the shared files moved to /platform/`);
  }
});

// A stylesheet is not a script, so the import check above never sees its @import lines. Once, a shared
// file moved and a stylesheet kept asking for the old address, which was a 404 on every page.
test('stylesheets ask for shared files by their /platform/ address', async () => {
  for (const file of (await sourceFiles(web)).filter((name) => name.endsWith('.css'))) {
    const source = withoutComments(await fs.readFile(file, 'utf8'));
    for (const match of source.matchAll(/@import\s+(?:url\()?\s*['"]?(\/[^'")\s;]*)/g)) {
      assert.match(match[1], /^\/platform\//, `${named(file)} imports ${match[1]}; shared files are at /platform/`);
    }
    assert.doesNotMatch(source, /(?:url\(|@import)\s*['"]?\/(?:design|js|css)\//, `${named(file)} asks for a shared file at an address that no longer exists`);
  }
});

// Inside an app the sidebar belongs to the app, so each one must offer the way back to the portal.
test('every UI offers a way back to all applications', async () => {
  const sources = await Promise.all(
    (await sourceFiles(web)).filter((name) => CODE.test(name) && !inside(webPlatform, name) && !TEST_FILE.test(name)).map((name) => fs.readFile(name, 'utf8')),
  );
  const mountsChrome = sources.some((source) => /mountChrome\([^)]*\{\s*app\b/.test(source));
  const drawsCloseLink = sources.some((source) => source.includes('data-close-applet'));
  assert.ok(mountsChrome || drawsCloseLink, 'the UI has no close control back to the portal');
  const shell = await fs.readFile(path.join(webPlatform, 'shell.js'), 'utf8');
  assert.match(shell, /`\$\{portalUrl\}\/apps`/, 'the home link is built from the portal address in /api/me');
  assert.match(shell, /dataset\.closeApplet/);
});

// The wait screen wraps fetch, so a call made another way would show a raw error while a paused
// database starts. XMLHttpRequest and the libraries built on it are not wrapped.
test('pages reach the API with fetch, so the database wait screen covers them', async () => {
  for (const file of (await sourceFiles(web)).filter((name) => CODE.test(name) && !TEST_FILE.test(name))) {
    const source = withoutComments(await fs.readFile(file, 'utf8'));
    assert.doesNotMatch(source, /\bXMLHttpRequest\b|\baxios\b/, `${named(file)} must call the API with fetch`);
  }
});

test('pages do not contain access rules', async () => {
  const forbidden = ['users.manage', 'apps.ticketing', 'apps.documentation', 'apps.devboard'];
  for (const file of await sourceFiles(web)) {
    const source = await fs.readFile(file, 'utf8');
    for (const term of forbidden) assert.equal(source.includes(term), false, `${named(file)} contains ${term}`);
  }
});

test('app and platform code use fetch only, never another HTTP library', async () => {
  for (const folder of [serverApp, serverPlatform]) {
    for (const file of (await sourceFiles(folder)).filter((name) => CODE.test(name))) {
      const source = withoutComments(await fs.readFile(file, 'utf8'));
      assert.doesNotMatch(source, /from\s*['"](axios|got|node-fetch|superagent|request)['"]/, `${named(file)} must use fetch`);
    }
  }
});
