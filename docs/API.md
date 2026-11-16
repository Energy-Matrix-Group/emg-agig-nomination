# AGIG Nominations API

Every route needs a signed-in person, except any listed under [Public routes](#public-routes). The portal has already checked that the person may open this app. What they may do inside it is this app's own business.

`test/contract.test.js` fails if this table and `server/app/index.js` disagree. Change both in the same commit.

## Conventions

- Bodies are JSON. Send `Content-Type: application/json`. Bodies are limited to 100 KB.
- A success response is the JSON shown.
- A failure is `{ "error": "<message>" }` with a 4xx or 5xx status. Anything unexpected returns `Something went wrong. Please try again.` and is logged.
- Without a session, an API route answers `401` with `{ "error": "Sign in required", "signIn": "<portal handoff address>" }`. The shared UI client sends the whole page to `signIn`.

## Routes

| Method | Path | Who | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/agig-nomination/hello` | anyone who can open the app | `message` ("Hello" and the person's name) and `visits`, how many times they have asked |

## What Joules can do here

Joules, the EMG helper in the portal, works in this app for a person through the platform's door (below), as that person. These are the actions in `assistant` in `server/app/index.js`; `test/contract.test.js` fails if this table and that list disagree.

| Action | Kind | What it does |
| --- | --- | --- |
| `say_hello` | read | `{ message }`: "Hello" and the person's name. |

## Public routes

None. A route that must open without a sign-in (for example a link in an email) needs Mat's approval first. It is built with `auth: false` and `public: true`, and listed here.

## Routes every app has

These come from the platform in `server/platform/`. They are the same in every app and are not part of the contract test.

- `GET /health`: `{ "ok": true }`. No sign-in. Set it as the component's HTTP health check path on DigitalOcean.
- `GET /api/status`: `{ "databaseConnected": true }`. No sign-in. `false` means the app is running on memory because its database could not be used.
- `GET /api/me`: `{ "user": { "id", "email", "displayName", "isPortalAdmin", "role" }, "portalUrl": "<portal address>", "appId": "<this app's id>" }`. Needs a session. `role` is the person's company role id, or `null`. `appId` (template 1.5.0) tells Joules's frame which app it is in.
- `GET /api/apps/<id>`: this app's own catalogue entry, `{ "app": { "id", "name", "description", "statusLabel", "message", "href" } }`. Needs a session. Any other id is a 404.
- `POST /api/logout`: clears this app's cookie and answers `{ "logoutUrl": "<portal address>/logout" }`. The UI then goes there. Other apps' sessions run until they expire.
- `POST /auth/callback`: the portal posts a signed token here (form fields `token` and `return`). A good token sets the session cookie and redirects to `return`. A bad one shows a short page with a link to try again.
- `GET /api/assistant` and `POST /api/assistant/<action>`: the door for Joules, the portal's helper (`server/platform/assistant.js`). Only the portal can use it: each call carries `Authorization: Bearer <token>`, a token the portal signed for one person, this app and one thing to do, used once and good for 60 seconds. A session is never enough, and a wrong token is a `401` `Joules could not be checked.` (limited as service tokens are, then `429`). `GET` answers `{ app, about, actions }`: what Joules can do here. `POST` takes `{ mode, input }`: `mode` is `run`, or `preview` for a write action, and answers `{ result }` for a read, `{ preview: { summary, fields } }` for a preview (nothing is changed) and `{ done: { summary, ref, path } }` once a write has run. A bad input is a `400` that says what to fix; a write while the app is on its memory fallback is a `503` `This app is running without its database, so it is not taking changes from Joules.`
