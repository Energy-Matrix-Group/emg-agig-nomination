import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assistant, routes } from '../server/app/index.js';

const doc = await readFile(new URL('../docs/API.md', import.meta.url), 'utf8');

test('docs/API.md lists exactly the routes the app serves', () => {
  const documented = [...doc.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE)` \| `([^`]+)` \|/gm)]
    .map(([, method, path]) => `${method} ${path}`)
    .sort();
  const served = routes.map((route) => `${route.method} ${route.path}`).sort();
  assert.deepEqual(documented, served);
});

// Every route needs a signed-in person, except the ones API.md lists under "Public routes" and the ones
// that take a service token. The portal decides who may open the app at all; the app decides the rest.
test('every route needs a signed-in person unless API.md lists it as public', () => {
  const publicSection = doc.split(/^## Public routes$/m)[1]?.split(/^## /m)[0] ?? '';
  for (const route of routes) {
    const name = `${route.method} ${route.path}`;
    assert.equal(route.permission, undefined, `${name}: the portal decides who may open the app, so a route has no permission`);
    if (route.public) {
      assert.equal(route.auth, false, name);
      assert.ok(publicSection.includes(`\`${route.path}\``), `${name} is listed under Public routes`);
    } else {
      assert.equal(route.auth, true, name);
    }
  }
});

// What Joules, the portal's helper, can do here is part of the contract too: each action in `assistant`, with its kind.
test('docs/API.md lists exactly the actions Joules can take here', () => {
  const section = doc.split(/^## What Joules can do here$/m)[1]?.split(/^## /m)[0] ?? '';
  const documented = [...section.matchAll(/^\| `([a-z][a-z0-9_]*)` \| (read|write) \|/gm)].map(([, name, kind]) => `${name} ${kind}`).sort();
  const offered = (assistant?.actions ?? []).map((action) => `${action.name} ${action.kind}`).sort();
  assert.deepEqual(documented, offered);
});
