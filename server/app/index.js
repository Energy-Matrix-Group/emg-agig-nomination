import { hello } from './hello.js';
import { openStore } from './store/index.js';

// This is the only file the platform reads from server/app/. To make a new app, change the id, the name,
// the description, the apiPrefix and the routes (docs/SPEC.md has the checklist).
export const catalog = {
  id: 'agig-nomination',
  name: 'AGIG Nominations',
  description: 'Shipper transport nominations to AGIG\'s TBS: enter, check, send and track every Gas Day against the cutoffs.',
  apiPrefix: '/api/agig-nomination',
  statusLabel: null,
  message: 'Shipper transport nominations to AGIG\'s TBS: enter, check, send and track every Gas Day against the cutoffs.',
};

// The UI is served at / from web/. A built UI (Vite) uses { root: 'web/dist', spa: true }.
// publicPaths lists UI pages that open without a sign-in, such as a link in an email. None here.
export const ui = { root: 'web', spa: false, publicPaths: [] };

// Runs once at boot. Its result is `app` in every handler. It must not take the service down over its database:
// openStore falls back to memory and says so (databaseConnected: false).
export async function setup({ sql = null, env = {}, connect } = {}) {
  return openStore({ sql, env, connect });
}

// auth: true means a signed-in user. The portal has already checked that they may open this app.
export const routes = [
  { method: 'GET', path: `${catalog.apiPrefix}/hello`, handler: hello, auth: true },
];

// What Joules, the EMG helper in the portal, can do here for a person (server/platform/assistant-schema.js). Each action runs as
// the person Joules is helping, so everything this app checks for them still applies. A read action only looks; a write action
// also has a preview, and runs only once the person has said yes in the portal. Describe each in docs/API.md.
export const assistant = {
  about: 'The starting point for a new EMG app. Joules can say hello from it.',
  actions: [
    {
      name: 'say_hello',
      kind: 'read',
      title: 'Say hello',
      description: 'A greeting from this app, for the person Joules is helping.',
      input: { type: 'object', properties: {} },
      run: async ({ user }) => ({ message: `Hello ${user.displayName}` }),
    },
  ],
};
