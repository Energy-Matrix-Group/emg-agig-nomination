import { checkAssistant } from './assistant-schema.js';
import { SERVICE_TOKEN_NAME } from './service-token.js';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const API_PREFIX = /^\/api\/[a-z0-9-]+$/;

// Splits a path on slashes and matches :params. A path with a broken % escape matches nothing.
export function matchPath(pattern, pathname) {
  const expected = pattern.split('/').filter(Boolean);
  const actual = pathname.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].startsWith(':')) {
      try {
        params[expected[index].slice(1)] = decodeURIComponent(actual[index]);
      } catch {
        return null;
      }
    } else if (expected[index] !== actual[index]) {
      return null;
    }
  }
  return params;
}

// Refuses an app whose routes could collide with the platform's own, or with each other.
// `apps` is a list so the same check serves a test with several; a real service has one.
export function checkRoutes(apps, platformRoutes) {
  const reserved = platformRoutes.map((route) => firstSegments(route.path));
  const prefixes = new Map();
  for (const app of apps) {
    const { id, apiPrefix } = app.catalog;
    if (typeof apiPrefix !== 'string' || !API_PREFIX.test(apiPrefix)) throw new Error(`${id} catalog.apiPrefix must look like /api/<name>`);
    if (reserved.includes(apiPrefix)) throw new Error(`${id} apiPrefix ${apiPrefix} belongs to the platform`);
    if (prefixes.has(apiPrefix)) throw new Error(`${id} and ${prefixes.get(apiPrefix)} share apiPrefix ${apiPrefix}`);
    prefixes.set(apiPrefix, id);
  }

  const seen = new Set(platformRoutes.map((route) => routeKey(route)));
  for (const app of apps) {
    const { id, apiPrefix } = app.catalog;
    for (const route of app.routes) {
      if (!METHODS.has(route.method) || typeof route.path !== 'string' || typeof route.handler !== 'function') {
        throw new Error(`${id} has a route without method, path, and handler`);
      }
      if (route.path !== apiPrefix && !route.path.startsWith(`${apiPrefix}/`)) {
        throw new Error(`${id} route ${route.method} ${route.path} is outside ${apiPrefix}`);
      }
      if (route.service !== undefined && !(typeof route.service === 'string' && SERVICE_TOKEN_NAME.test(route.service))) {
        throw new Error(`${id} route ${route.method} ${route.path} service must name a *_TOKEN variable`);
      }
      const key = routeKey(route);
      if (seen.has(key)) throw new Error(`${id} route ${route.method} ${route.path} is already registered`);
      seen.add(key);
    }
  }
}

// What the platform needs to know about an app module before it will serve it.
export function checkApp(app, appId) {
  const { catalog } = app ?? {};
  if (!catalog?.id || typeof catalog.name !== 'string' || typeof catalog.description !== 'string' || !Array.isArray(app.routes)) {
    throw new Error('The app must export catalog (id, name, description, apiPrefix) and routes');
  }
  if (app.setup !== undefined && typeof app.setup !== 'function') throw new Error(`${catalog.id} setup must be a function`);
  if (catalog.id !== appId) throw new Error(`APP_ID is "${appId}" but the app's catalogue id is "${catalog.id}". They must match.`);
  checkAssistant(app.assistant, catalog.id);
}

function firstSegments(routePath) {
  return `/${routePath.split('/').filter(Boolean).slice(0, 2).join('/')}`;
}

function routeKey(route) {
  const shape = route.path.split('/').map((part) => (part.startsWith(':') ? ':' : part)).join('/');
  return `${route.method} ${shape}`;
}
