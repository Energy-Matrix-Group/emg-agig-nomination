import { sendJson } from '../platform/kit.js';

// Handlers get { req, res, params, user, directory, app }.
//   user       the signed-in person: { id, email, displayName, isPortalAdmin }
//   app        what setup() returned: here, { store }
//   directory  portal user lookups (findUserById, findUserByEmail, listUsers)
// A database error is not caught here. It reaches the platform, which turns a paused database into the
// 503 the browser waits on.
export async function hello({ res, user, app: { store } }) {
  const visits = await store.recordVisit(user.id);
  sendJson(res, 200, { message: `Hello ${user.displayName}`, visits });
}
