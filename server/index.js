import * as app from './app/index.js';
import { readConfig } from './platform/config.js';
import { createAppServer } from './platform/create-server.js';

// Boot: read the settings, set the app up, then listen. A problem with a setting stops the app with
// a message that names it. The app itself decides what to do about its database (see docs/ARCHITECTURE.md).
let config;
try {
  config = readConfig(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (config.generatedSecret) {
  console.warn('APP_SESSION_SECRET is not set, so a new one was made. Sessions end when this process restarts. For local work only.');
}
if (!config.directoryToken) {
  console.warn('PORTAL_DIRECTORY_TOKEN is not set, so this app cannot look up other users.');
}

const server = createAppServer({ app, env: process.env, config });
await server.ready;

server.listen(config.port, '0.0.0.0', () => {
  console.log(`${app.catalog.name} listening on 0.0.0.0:${config.port}`);
});
