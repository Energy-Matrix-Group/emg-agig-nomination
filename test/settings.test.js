import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// The README's settings table and .env.example name exactly the same settings, and every NOM_ setting the code
// reads is in both.
const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('the README\'s settings table and .env.example list the same settings', async () => {
  const readme = await read('README.md');
  const tabled = [...readme.matchAll(/^\| ((?:`[A-Z][A-Z0-9_]*`(?:, )?)+) \|/gm)].flatMap(([, cell]) => [...cell.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map(([, name]) => name));
  const listed = [...(await read('.env.example')).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(([, name]) => name);
  assert.deepEqual([...tabled].sort(), [...listed].sort());
});

test('every NOM_ setting the code reads is documented', async () => {
  const code = await read('server/app/settings.js');
  const used = [...new Set([...code.matchAll(/'(NOM_[A-Z_]+)'/g)].map(([, name]) => name))];
  const listed = new Set([...(await read('.env.example')).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(([, name]) => name));
  assert.deepEqual(used.sort(), ['NOM_CUTOFF_WARNING_MINUTES', 'NOM_ENVIRONMENT']);
  for (const name of used) assert.ok(listed.has(name), `${name} is in .env.example`);
});
