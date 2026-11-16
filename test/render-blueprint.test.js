import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const blueprint = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'render.yaml'), 'utf8');

// Until this app has a database it runs on memory, even though the shared Render group holds a SQL login.
// When the app gets its database: delete this test and the SQL_SERVER entry in render.yaml, and add the app's
// database name to the group.
test('render.yaml links the shared group, and keeps the app on memory until it has a database', () => {
  assert.deepEqual([...blueprint.matchAll(/- fromGroup: (\S+)/g)].map(([, name]) => name), ['emg-test']);
  assert.match(blueprint, /- key: SQL_SERVER\s+value: ""/);
  assert.doesNotMatch(blueprint, /sync: false/, 'nothing in render.yaml is typed in the dashboard');
});

test('render.yaml gives the app its own name, id and address', () => {
  const id = /- key: APP_ID\s+value: (\S+)/.exec(blueprint)?.[1];
  assert.ok(id, 'render.yaml sets APP_ID');
  assert.match(blueprint, new RegExp(`name: emg-${id}\\n`));
  assert.match(blueprint, new RegExp(`- key: APP_URL\\s+value: https://emg-${id}\\.onrender\\.com\\n`));
});
