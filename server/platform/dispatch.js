import { isDatabaseStarting, noteDatabaseStarting, sendDatabaseStarting } from './database-wake.js';
import { sendJson } from './http.js';
import { matchPath } from './router.js';

export const GENERIC_ERROR = 'Something went wrong. Please try again.';

// The one place that answers for a failed request, so every route behaves the same:
//   a database that is starting is a 503 the browser waits on (see database-wake.js);
//   an error thrown on purpose, with a status from 400 to 599, keeps its message;
//   anything else is a bug: it is logged and the person sees generic copy.
export function answerError(res, error, wake) {
  if (isDatabaseStarting(error)) {
    noteDatabaseStarting(error);
    if (!res.headersSent) sendDatabaseStarting(res, wake);
    return;
  }
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : null;
  if (!status || status >= 500) console.error(error);
  if (!res.headersSent) sendJson(res, status || 500, { error: status ? error.message : GENERIC_ERROR });
}

export function tooManyAttempts(res, retryAfter) {
  const minutes = Math.ceil(retryAfter / 60);
  sendJson(res, 429, { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` }, {
    'Retry-After': String(retryAfter),
  });
}

// Finds the route for a request and runs it. Returns false when no route matches.
//   route.auth     needs a signed-in user, otherwise `unauthorised` answers
//   route.service  also accepts a bearer token from the named environment variable
// The handler receives { req, res, params, user, directory, app } where `app` is what setup() returned.
export function createDispatcher({ routes, authenticate, unauthorised, serviceTokens, directory, appContext }) {
  return async function dispatch(req, res, url) {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (!params) continue;

      let user = null;
      if (route.service) {
        const checked = serviceTokens(req, route.service);
        if (checked.retryAfter) {
          tooManyAttempts(res, checked.retryAfter);
          return true;
        }
        user = checked.user;
      }
      if (route.auth && !user) {
        user = await authenticate(req);
        if (!user) {
          unauthorised(req, res);
          return true;
        }
      }
      await route.handler({ req, res, params, user, directory, app: await appContext() });
      return true;
    }
    return false;
  };
}
