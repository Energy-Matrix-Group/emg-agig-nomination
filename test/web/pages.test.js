import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The pages' own rules, checked in their source (the pages run in a browser, so these are read, not run).

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

async function pageFiles(folder = web) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name === 'platform') continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...await pageFiles(full));
    else found.push(full);
  }
  return found;
}

const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('there is no page for making or changing a nomination: the app only watches', async () => {
  const sources = (await Promise.all((await pageFiles()).filter((name) => name.endsWith('.js')).map((name) => readFile(name, 'utf8')))).join('\n');
  assert.doesNotMatch(sources, /method: '(PUT|DELETE|PATCH)'/);
  const posts = [...sources.matchAll(/api\(`([^`]+)`, \{ method: 'POST'/g)].map(([, path]) => path);
  assert.deepEqual(posts, ['${API}/alerts/${alert.id}/${action}'], 'the one change a page makes is to an alert');
});

test('pages put what the API sends on the page as text, never as markup', async () => {
  for (const file of (await pageFiles()).filter((name) => name.endsWith('.js'))) {
    const source = withoutComments(await readFile(file, 'utf8'));
    assert.doesNotMatch(source, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, path.relative(web, file));
  }
});

// A script that does not parse (a name declared twice, say) stops the whole page, and no server test would see it.
test('every page script parses as a module', async () => {
  for (const file of (await pageFiles()).filter((name) => name.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${path.relative(web, file)}: ${result.stderr.split('\n').find((line) => /Error/.test(line)) ?? result.stderr}`);
  }
});

// A page that calls a shared helper it never imported parses, then stops in the browser the moment it reaches the call
// ("modelId is not defined"), which no server test sees. Every helper shared.js exports that a page calls must be in
// its import from '/shared.js', or declared in the page itself.
test('a page imports every shared helper it calls', async () => {
  const shared = withoutComments(await readFile(path.join(web, 'shared.js'), 'utf8'));
  const exported = new Set([
    ...[...shared.matchAll(/^export (?:async )?(?:function|const|let) (\w+)/gm)].map(([, name]) => name),
    ...[...shared.matchAll(/^export \{([^}]+)\} from/gm)].flatMap(([, names]) => names.split(',').map((name) => name.trim().split(/\s+as\s+/).pop())),
  ]);
  for (const file of (await pageFiles()).filter((name) => name.endsWith('.js') && !['shared.js', 'format.js'].includes(path.basename(name)))) {
    const source = withoutComments(await readFile(file, 'utf8'));
    const imported = new Set((/import \{([^}]+)\} from '\/shared\.js'/.exec(source)?.[1] ?? '').split(',').map((name) => name.trim()));
    const declared = new Set([...source.matchAll(/(?:function|const|let) (\w+)/g)].map(([, name]) => name));
    const missing = [...exported].filter((name) => new RegExp(`(?<![.\\w])${name}\\(`).test(source) && !imported.has(name) && !declared.has(name));
    assert.deepEqual(missing, [], `${path.relative(web, file)} calls ${missing.join(', ')} without importing it from '/shared.js'`);
  }
});

// A page module runs its top-level code in order, so a const or let declared after the first top-level await
// does not exist yet when the code before it calls a function that uses it: the page stops with an error.
test('a page script declares everything before its first top-level await', async () => {
  for (const file of (await pageFiles()).filter((name) => name.endsWith('.js'))) {
    const lines = withoutComments(await readFile(file, 'utf8')).split('\n');
    const firstAwait = lines.findIndex((line) => /^(?:(?:const|let) [\w{}[\], ]+= )?await\b|^if \(page\) await\b/.test(line));
    if (firstAwait < 0) continue;
    const late = lines.slice(firstAwait + 1).find((line) => /^(const|let) /.test(line));
    assert.equal(late, undefined, `${path.relative(web, file)} declares "${late}" after its top-level await`);
  }
});

test('every page is in the app shell, names the app, and loads its own script', async () => {
  const pages = (await pageFiles()).filter((name) => name.endsWith('index.html'));
  assert.equal(pages.length, 6);
  for (const file of pages) {
    const html = await readFile(file, 'utf8');
    const where = path.relative(web, file);
    assert.match(html, /<body data-app="agig-nomination">/, where);
    assert.match(html, /<link rel="stylesheet" href="\/platform\/app.css">/, where);
    assert.match(html, /<div class="emg-boot" data-boot/, where);
    const script = /<script type="module" src="(\/[^"]+)"><\/script>\s*<\/body>/.exec(html)?.[1];
    assert.ok(script, `${where} loads a page script`);
    await readFile(path.join(web, script), 'utf8');
  }
});

test('the stylesheet uses the platform\'s tokens, never a colour of its own', async () => {
  const css = withoutComments(await readFile(path.join(web, 'nomination.css'), 'utf8'));
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
});
