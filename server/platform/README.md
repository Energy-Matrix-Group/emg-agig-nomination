# server/platform

Template version: 1.8.1

This folder is copied from `emg-app-template`. **Do not edit it in an app repo.** If it needs a fix, fix it in the template, then copy `server/platform/`, `web/platform/` and `test/platform/` into the app again and change the version line above. Apps stay in step by re-copying, never by diverging.

The template version is in the template's `TEMPLATE_VERSION` file. Compare it with the line above to see whether this copy is behind.

## What an app sees

App code in `server/app/` imports from **`kit.js` and nothing else here**. `test/platform/boundaries.test.js` fails otherwise.

| Export | What it does |
| --- | --- |
| `httpError(status, message)` | Throw it from a handler. The client gets `{ error: message }` with that status. |
| `readJson(req, { limit })` | Reads a JSON object body. 413 too large, 415 wrong type, 400 bad JSON. |
| `sendJson(res, status, body)` | Sends JSON, never cached, compressed when large. |
| `sendFile(res, { body, contentType, filename })` | Sends a download as an attachment, never inline. |

`kit.js` also exports the pieces the **portal** builds its own server from (`createDispatcher`, `answerError`, `createStaticHandler`, `createServiceTokens`, `issueToken`, `issueAssistantToken`, `loadPrivateKey` and a few more). An app does not need them. They are exported so the portal obeys the same rule as every app: import from `kit.js` and nowhere else.

A route handler receives `{ req, res, params, user, directory, app }`:

- `user` is the signed-in person from the app's session: `{ id, email, displayName, isPortalAdmin, role }`, where `role` is their company role id or `null` (from 1.4.0).
- `directory` looks up portal users (`findUserById`, `findUserByEmail`, `listUsers`) over HTTP, with a short cache.
- `app` is whatever `setup()` in `server/app/index.js` returned.

## The files

| File | What it does |
| --- | --- |
| `create-server.js` | Builds the one server an app runs from the app module. |
| `config.js` | Reads and checks `APP_ID`, `APP_URL`, `PORTAL_URL`, the public key, the session settings. Reports every problem at once. |
| `notifications.js` | The bell's routes (from 1.8.0): `GET /api/notifications`, `POST /api/notifications/read` and `POST /api/notifications/tips/:id/dismiss`, for the person signed in. Each asks the portal's directory for that person (`/api/directory/users/:id/notifications...`, with `PORTAL_DIRECTORY_TOKEN`) and answers with what it said, plus `portalUrl` on the list. Nothing is kept here. A portal that cannot be reached is a `502` with fixed words, never the portal's `503`, so the wait screen never covers a page for the bell. Without `PORTAL_URL` and `PORTAL_DIRECTORY_TOKEN` it is a `503` and the bell stays hidden. |
| `platform-routes.js` | The routes every app has: `/health`, `/api/status`, `/api/me` (`{ user, portalUrl, appId }`; `appId` from 1.5.0, for Joules's frame), `/api/apps/:id`, `/api/logout`, `/auth/callback`. |
| `assistant.js` | The door for Joules, the portal's helper: `GET /api/assistant` (what he can do here) and `POST /api/assistant/:action`, for the portal only, acting for one person. From 1.7.0 it serves a phone call's or a text's own set of actions, and hands each action `via`, `session` and the preview's `check`. |
| `assistant-schema.js` | What an app's optional `assistant` export may hold (`actions`, and from 1.7.0 `channels: { voice, sms }`), and the checks on each action's input and answer, a preview's `check` included. |
| `assistant-token.js` | The token the portal signs for each of Joules's calls: one person, one app, one thing, 60 seconds, used once; from 1.7.0 also how the person is talking to him (`via`) and the portal's `session`. Never a sign-in token. |
| `handoff.js` | The app's side of sign-in: checks the portal's token, sets the cookie, validates `return`. |
| `token.js` | The sign-in token: Ed25519 sign and verify with `node:crypto`. |
| `keys.js` | Reads keys pasted as PEM, as one line with `\n`, or as base64. Refuses a private key where a public one belongs. |
| `replay-guard.js` | Remembers used token ids until they would have expired. |
| `session-cookie.js` | The app's own cookie `emg_<appId>_session`, HMAC-signed, with an absolute expiry. |
| `dispatch.js` | Finds the route, checks sign-in and service tokens, answers every error the same way. |
| `router.js` | Path matching and the checks that refuse clashing routes. |
| `service-token.js` | Bearer-token callers for routes that name a `*_TOKEN` variable, with limits on wrong guesses. |
| `directory-client.js` | Portal user lookups. |
| `static.js` | Serves the UI at `/` and the shared files at `/platform/`, adds the wait screen, Joules (`/platform/assistant.js`, from 1.5.0) and the bell (`/platform/bell.js`, from 1.8.0) to every page, sends signed-out page requests to the portal. The portal serves its own pages with it too, without Joules (it draws him itself) but with the bell. |
| `database-wake.js` | The 503 an app answers while its database is starting after a pause, and the retry used at boot. |
| `rate-limit.js` | Counts failures per key in a window. |
| `http.js` | The request and response helpers behind `kit.js`. |
| `kit.js` | The only file app code imports. |

Sign-in, the cookie and the wait screen are explained in `docs/ARCHITECTURE.md`.
