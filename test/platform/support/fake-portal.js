import { randomUUID } from 'node:crypto';
import { generateSigningKeys, loadPrivateKey } from '../../../server/platform/keys.js';
import { issueAssistantToken } from '../../../server/platform/assistant-token.js';
import { issueToken } from '../../../server/platform/token.js';

export const SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';

// A stand-in for the portal that lives inside the test process. It has its own signing key pair, signs
// sign-in tokens the way the real portal does, and answers user lookups with the shape the portal's
// directory returns. The app under test is given the public key and this directory.
export function createFakePortal({ appId = 'echo' } = {}) {
  const keys = generateSigningKeys();
  const privateKey = loadPrivateKey(keys.privateKey);
  const users = new Map();

  // role: the person's company role id (administrator, ops-trader, manager, executive, ...) or null, as the portal sends it.
  function createUser({ email, displayName, isPortalAdmin = false, apps = [appId], isActive = true, role = null } = {}) {
    const user = {
      id: randomUUID(),
      email: String(email).toLowerCase(),
      displayName,
      isPortalAdmin,
      role,
      apps: [...apps],
      isActive,
      createdAt: new Date().toISOString(),
    };
    users.set(user.id, user);
    return { ...user };
  }

  function updateUser(id, changes) {
    const user = users.get(id);
    if (!user) return null;
    Object.assign(user, changes);
    return { ...user };
  }

  // The public shape of a user, as GET /api/directory/users returns it. Never a password hash.
  function shape(user) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      accessLevel: user.isPortalAdmin ? 'admin' : 'standard',
      accessLevelName: user.isPortalAdmin ? 'Admin' : 'Standard',
      isActive: user.isActive,
      isPortalAdmin: user.isPortalAdmin,
      role: user.role ?? null,
      apps: [...user.apps],
      createdAt: user.createdAt,
    };
  }

  const directory = {
    async findUserById(id) {
      const user = users.get(id);
      return user ? shape(user) : null;
    },
    async findUserByEmail(email) {
      const needle = String(email).toLowerCase();
      for (const user of users.values()) if (user.email === needle) return shape(user);
      return null;
    },
    async listUsers() {
      return [...users.values()].map(shape).sort((a, b) => a.email.localeCompare(b.email));
    },
  };

  return {
    appId,
    keys,
    users,
    createUser,
    updateUser,
    shape,
    directory,

    // A token the portal would hand to `app` for this user. `now` is milliseconds; `id` is the jti.
    token(user, { app = appId, now = Date.now(), id } = {}) {
      return issueToken({ user, appId: app, privateKey, now, id });
    },

    // A token the portal would send with Joules's call to `app` for this user, allowed to do `act` ('manifest',
    // 'preview:<action>' or 'run:<action>').
    assistantToken(user, act, { app = appId, now = Date.now(), id } = {}) {
      return issueAssistantToken({ user, appId: app, act, privateKey, now, id });
    },

    // The settings the app needs, as the Render dashboard would give them. Extra settings win.
    env(extra = {}) {
      return {
        APP_ID: appId,
        APP_URL: 'http://localhost:4001',
        PORTAL_URL: 'http://localhost:4000',
        PORTAL_SIGNING_PUBLIC_KEY: keys.publicKey,
        APP_SESSION_SECRET: SESSION_SECRET,
        ...extra,
      };
    },
  };
}
