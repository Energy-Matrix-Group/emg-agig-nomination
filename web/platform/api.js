// The one way a page calls the API. Always fetch: the wait screen for a paused database wraps it
// (db-wake.js), and XMLHttpRequest or axios would bypass it.
//
// Returns { ok, status, data }. A 401 that carries `signIn` means the app session has ended: the whole
// page goes to the portal's sign-in handoff and comes back to this page. That promise never settles, so
// no page code runs while the browser is leaving.
export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'Cannot reach the server.' } };
  }

  if (response.status === 204) return { ok: true, status: 204, data: {} };

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (response.status === 401 && typeof data.signIn === 'string') {
    window.location.assign(data.signIn);
    return new Promise(() => {});
  }
  if (!response.ok && !data.error) data = { error: 'Request failed.' };
  return { ok: response.ok, status: response.status, data };
}
