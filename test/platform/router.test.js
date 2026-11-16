import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkApp, checkRoutes, matchPath } from '../../server/platform/router.js';
import { createPlatformRoutes } from '../../server/platform/platform-routes.js';

const noop = () => {};
// What the platform itself serves. An app's prefix and routes must keep clear of these.
const platform = createPlatformRoutes({ config: { portalUrl: 'http://p', appId: 'a' }, catalog: { id: 'a' }, replay: { claim: () => true }, now: Date.now });

function fakeApp(id, apiPrefix, routes) {
  return { catalog: { id, apiPrefix }, routes: routes.map(([method, routePath]) => ({ method, path: routePath, handler: noop })) };
}

test('route checks refuse collisions with the platform and between apps', () => {
  for (const reserved of ['/api/me', '/api/status', '/api/logout', '/api/apps']) {
    assert.throws(() => checkRoutes([fakeApp('a', reserved, [])], platform), /belongs to the platform/, reserved);
  }
  assert.throws(
    () => checkRoutes([fakeApp('a', '/api/one', []), fakeApp('b', '/api/one', [])], platform),
    /share apiPrefix/,
  );
  assert.throws(() => checkRoutes([fakeApp('a', '/api/one', [['GET', '/api/two/x']])], platform), /outside \/api\/one/);
  assert.throws(
    () => checkRoutes([fakeApp('a', '/api/one', [['GET', '/api/one/:id'], ['GET', '/api/one/:other']])], platform),
    /already registered/,
  );
  assert.throws(() => checkRoutes([fakeApp('a', '/api/one', [['FETCH', '/api/one']])], platform), /method, path, and handler/);
  assert.doesNotThrow(() => checkRoutes([fakeApp('a', '/api/one', [['GET', '/api/one/:id'], ['PATCH', '/api/one/:id']])], platform));
});

test('an apiPrefix must look like /api/<name>', () => {
  for (const prefix of ['/one', '/api', '/api/', '/api/One', '/api/a/b', '/api/a_b', undefined]) {
    assert.throws(() => checkRoutes([fakeApp('a', prefix, [])], platform), /apiPrefix must look like \/api\/<name>/, String(prefix));
  }
  assert.doesNotThrow(() => checkRoutes([fakeApp('a', '/api/retail-gas', [])], platform));
});

test('a service route may only name a *_TOKEN variable', () => {
  const withService = (service) => {
    const app = fakeApp('a', '/api/one', [['POST', '/api/one/hook']]);
    app.routes[0].service = service;
    return [app];
  };
  assert.doesNotThrow(() => checkRoutes(withService('RELEASE_NOTES_TOKEN'), platform));
  assert.doesNotThrow(() => checkRoutes(withService('DEVBOARD_TOKEN'), platform));
  assert.throws(() => checkRoutes(withService('SQL_PASSWORD'), platform), /service must name a \*_TOKEN variable/);
  assert.throws(() => checkRoutes(withService('release_token'), platform), /service must name/);
  assert.throws(() => checkRoutes(withService(true), platform), /service must name/);
});

test('an app module is checked before the platform serves it', () => {
  const good = { catalog: { id: 'a', name: 'A', description: 'd', apiPrefix: '/api/a' }, routes: [] };
  assert.doesNotThrow(() => checkApp(good, 'a'));
  assert.throws(() => checkApp(good, 'b'), /APP_ID is "b" but the app's catalogue id is "a"/);
  assert.throws(() => checkApp({ routes: [] }, 'a'), /must export catalog/);
  assert.throws(() => checkApp({ catalog: good.catalog }, 'a'), /must export catalog/);
  assert.throws(() => checkApp({ ...good, setup: 'nope' }, 'a'), /setup must be a function/);
  assert.throws(() => checkApp(undefined, 'a'), /must export catalog/);
});

test('paths match their :params, decode them, and refuse a broken escape', () => {
  assert.deepEqual(matchPath('/api/x/items/:id', '/api/x/items/42'), { id: '42' });
  assert.deepEqual(matchPath('/api/x/:a/:b', '/api/x/one%20two/three'), { a: 'one two', b: 'three' });
  assert.equal(matchPath('/api/x/items/:id', '/api/x/items'), null);
  assert.equal(matchPath('/api/x/items/:id', '/api/x/items/1/more'), null);
  assert.equal(matchPath('/api/x/items/:id', '/api/y/items/1'), null);
  assert.equal(matchPath('/api/x/items/:id', '/api/x/items/%E0%A4%A'), null);
  assert.deepEqual(matchPath('/health', '/health'), {});
});
