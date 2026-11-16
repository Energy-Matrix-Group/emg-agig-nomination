import { httpError } from './http.js';

// Read-only lookups of portal users, for apps that need to name people (assignees, @mentions, "can this
// person open the app"). It calls the portal server to server with PORTAL_DIRECTORY_TOKEN. An app never
// reads the portal's database. Answers are kept for a short time, because the portal is another service
// and a list of people changes rarely.
//
// A user is { id, email, displayName, accessLevel, accessLevelName, isActive, isPortalAdmin, role, apps, createdAt }, where role is
// the person's company role id or null (from template 1.4.0; an older portal leaves it out)
// where `apps` lists the ids of the apps they can open. Never a password hash.

const TIMEOUT_MS = 10_000;

export function createDirectoryClient({
  portalUrl,
  token,
  fetch: fetchImpl = globalThis.fetch,
  ttlMs = 60_000,
  now = Date.now,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  let list = null; // { at, promise }
  const byEmail = new Map(); // email -> { at, promise }

  async function call(path) {
    if (!portalUrl || !token) throw httpError(503, 'The user directory is not set up. Set PORTAL_URL and PORTAL_DIRECTORY_TOKEN.');
    let response;
    try {
      response = await fetchImpl(`${portalUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw httpError(502, 'The portal could not be reached to look up users.');
    }
    if (response.status === 404) return null;
    if (!response.ok) throw httpError(502, 'The portal could not look up users.');
    try {
      return await response.json();
    } catch {
      throw httpError(502, 'The portal could not look up users.');
    }
  }

  // Shares one request between callers that ask at the same time, and forgets a failure at once.
  function cached(slot, load) {
    if (slot && now() - slot.at < ttlMs) return { slot, promise: slot.promise };
    const next = { at: now(), promise: null };
    next.promise = load().catch((error) => {
      next.at = -Infinity;
      throw error;
    });
    return { slot: next, promise: next.promise };
  }

  async function listUsers() {
    const found = cached(list, async () => (await call('/api/directory/users'))?.users ?? []);
    list = found.slot;
    return [...(await found.promise)];
  }

  async function findUserByEmail(email) {
    const key = String(email ?? '').trim().toLowerCase();
    if (!key) return null;
    const found = cached(byEmail.get(key), async () => (await call(`/api/directory/users/by-email/${encodeURIComponent(key)}`))?.user ?? null);
    byEmail.set(key, found.slot);
    if (byEmail.size > 500) byEmail.delete(byEmail.keys().next().value);
    return found.promise;
  }

  // The portal has no lookup by id, so this reads the cached list.
  async function findUserById(id) {
    return (await listUsers()).find((user) => user.id === id) ?? null;
  }

  return {
    findUserById,
    findUserByEmail,
    listUsers,
    clear() {
      list = null;
      byEmail.clear();
    },
  };
}
