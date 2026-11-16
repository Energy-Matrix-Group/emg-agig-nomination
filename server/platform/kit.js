// The platform's public surface for app code. Everything under server/app/ imports from here and
// from nowhere else in server/platform/ (test/platform/boundaries.test.js enforces it).

// What an app's handlers use.
export { httpError, readJson, sendFile, sendJson } from './http.js';

// What only the portal uses. It signs people in, so it builds its own server from the same pieces an
// app's server is built from, and it issues the sign-in token that every app checks. An app has no
// reason to import any of these.
export { createDispatcher, answerError, tooManyAttempts } from './dispatch.js';
export { databaseWakeSettings, retryWhileStarting } from './database-wake.js';
export { isProductionLike } from './config.js';
export { safeReturn } from './handoff.js';
export { parseCookies, sendHtml } from './http.js';
export { loadPrivateKey } from './keys.js';
export { clientKey, createRateLimiter } from './rate-limit.js';
export { createServiceTokens, SERVICE_ACTOR } from './service-token.js';
export { createStaticHandler } from './static.js';
export { issueToken } from './token.js';
export { issueAssistantToken } from './assistant-token.js';
