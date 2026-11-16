import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { totalsByContractDay } from '../../web/nominate/totals.js';

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

test('pages put what the API sends on the page as text, never as markup', async () => {
  for (const file of (await pageFiles()).filter((name) => name.endsWith('.js'))) {
    const source = withoutComments(await readFile(file, 'utf8'));
    assert.doesNotMatch(source, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, path.relative(web, file));
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
  assert.equal(pages.length, 8);
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

test('the totals table adds in thousandths, so nothing drifts', () => {
  const rows = [
    { gasDay: '2026-11-17', contract: 'Shipper1_FH01', nomType: 'Inlet', quantityTJ: '0.100' },
    { gasDay: '2026-11-17', contract: 'Shipper1_FH01', nomType: 'Inlet', quantityTJ: '0.200' },
    { gasDay: '2026-11-17', contract: 'Shipper1_FH01', nomType: 'Outlet', quantityTJ: '0.300' },
    { gasDay: '2026-11-17', contract: 'Shipper1_FH01', nomType: 'Outlet', quantityTJ: null },
    { gasDay: '2026-11-16', contract: 'Shipper1_SPOT', nomType: 'Outlet', quantityTJ: '2.5' },
  ];
  assert.deepEqual(totalsByContractDay(rows, [{ code: 'Shipper1_FH01', capacityTJ: '25.000' }]), [
    { gasDay: '2026-11-16', contract: 'Shipper1_SPOT', inletTJ: '0.000', outletTJ: '2.500', capacityTJ: null },
    { gasDay: '2026-11-17', contract: 'Shipper1_FH01', inletTJ: '0.300', outletTJ: '0.300', capacityTJ: '25.000' },
  ]);
});
