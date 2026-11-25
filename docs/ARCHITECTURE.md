# EMG platform: architecture for app builders

Read this before you build or change an app. It applies to people and AI agents alike. An identical copy lives in every EMG repo at `docs/ARCHITECTURE.md`; it travels with `emg-app-template`.

**Reading order:** this file, then the repo's `AGENTS.md` (commands and hard rules), then `docs/SPEC.md` and `docs/API.md` for the app itself.

**If this file and the code disagree, the code and its tests win.** Report the drift so this file can be fixed. Don't work around it silently.

---

## 1. The system in one picture

```
                              ┌──────────────────────────────────────┐
  Browser ───────────────────►│ emg-portal                           │
     │                        │  sign-in · users · who may open what │
     │                        │  the app list · admin screens        │
     │                        │  signs a short-lived token per app   │
     │                        └───────────┬───────────────▲──────────┘
     │ the token, in a form post          │               │ user lookups, server to server,
     ▼                                    │               │ with a bearer token
  emg-ticketing   emg-documentation   emg-devboard   emg-operations   …
  Each is one DigitalOcean component: its UI, its API, and its own SQL database.
```

- **One repo per app.** Each app is deployed as one Web Service component of the environment's DigitalOcean App Platform app, and serves its UI at `/` and its API under `/api/...` from one Node process. There is no separate web repo and no proxy.
- **The portal owns identity.** `emg-portal` holds the users, their passwords, which apps each person may open, the application list and the admin screens. It holds no business logic.
- **Each app owns everything else:** its UI, routes, rules, in-app roles, tests, docs and its own SQL database. An app never reads another app's database.
- **Apps are copies of one template.** `server/platform/`, `web/platform/` and `test/platform/` are identical in every repo. Behaviour that every app needs is fixed once, in `emg-app-template`, and copied out.
- **Data stays in Australia.** The databases are on the Azure SQL server in Sydney, and the apps run in DigitalOcean's Sydney region (SYD1).

## 2. Principles

1. **Boundaries are enforced by tests, not by good intentions.** Boundary, contract and platform tests fail the build. Don't weaken a test to get green; fix the design.
2. **An app never reaches into another app.** That rules out reading its tables and importing its code. Cross-app data goes through a documented HTTP endpoint (section 5).
3. **The portal answers "may this person open the app?"** The app answers everything finer, from its own tables and, where it chooses, from the person's company role (below), which tells it who someone is and grants nothing by itself.
4. **Contract first.** A route's shape is written in the app's `docs/API.md` before, or in the same change as, the code. The UI builds against that document, not against server source.
5. **Async everywhere.** Every store and service function returns a Promise and every call is awaited, including in memory adapters.
6. **Copy, don't share.** There is no shared `utils` package. Small helpers are copied. Only domain-free infrastructure lives in the template, and only once a second app needs it.
7. **Files that read well.** Split a file when it mixes features or gets hard to follow, not to meet a line count. A split is its own commit, with no change in behaviour.
8. **Exact copy and deliberate gaps are part of the spec.** User-facing strings come from the app's messages file. Behaviour the spec marks as a deliberate gap stays that way.
9. **Nothing depends on the host.** Read `PORT` and every address from environment settings, answer `GET /health`, and never write a host name into code. That is how the apps moved from Render to DigitalOcean App Platform with settings alone. (The platform still reads `RENDER` as one sign that it serves real people. DigitalOcean does not set it, so `COOKIE_SECURE=true` stays set there: section 9.)

## 3. Anatomy of an app repo

```
server/index.js        boot: read the settings, set the app up, listen
server/platform/       copied from the template: sign-in, session cookie, http kit, router, wake 503, directory client, static serving
server/app/            this app
web/                   the UI (static modules, or a Vite project that builds to web/dist)
web/platform/          copied from the template: tokens.css, app.css, shell.js, api.js, icons.js, db-wake.js, assistant.js
test/                  this app's tests; test/platform/ is copied from the template
docs/                  SPEC.md, API.md, this file
```

### 3.1 The app module: `server/app/index.js`

This is the only file the platform reads from `server/app/`.

```js
export const catalog = {
  id: 'my-thing',                 // lower case, hyphenated; must equal APP_ID
  name: 'My thing',
  description: 'One line for the application list.',
  apiPrefix: '/api/my-thing',     // every route must start with this
};

export const ui = { root: 'web', spa: false, publicPaths: [] };   // optional; see section 3.4

export async function setup({ sql, env, directory }) {           // optional, runs once at boot
  return { store: await openStore({ sql, env }) };                // becomes `app` in every handler
}

export const routes = [
  { method: 'GET', path: '/api/my-thing/items', handler: listItems, auth: true },
];
```

- **Handler context:** `{ req, res, params, user, directory, app }`.
  - `user` is the signed-in person from the app's session: `{ id, email, displayName, isPortalAdmin, role }`. `id` is the portal user id. `role` is their company role id as the portal's Users screen sets it (`administrator`, `ops-trader`, `commercial`, `manager`, `executive`, `accounts`), or `null` when they have none (from template 1.4.0). An app may decide from it, in its own rules, what someone sees or does there: the Operations Incident Register shows managers, executives and administrators every event. The role is never a permission string, and the portal never decides anything inside an app with it.
  - `directory` provides read-only portal user lookups: `findUserById`, `findUserByEmail`, `listUsers`.
  - `app` is whatever `setup()` returned.
- **Routes:** `auth: true` needs a signed-in person. `service: 'SOME_TOKEN'` also accepts a bearer token from that environment variable (only `*_TOKEN` names are allowed). `auth: false, public: true` opens a route to everyone; that needs Mat's approval and an entry under "Public routes" in `docs/API.md`.
- **Boot fails when** `apiPrefix` is missing or malformed, a route is outside the prefix, two routes clash (after `:params` are normalised), the prefix belongs to the platform (`/api/me`, `/api/status`, `/api/logout`, `/api/apps`), or `catalog.id` differs from `APP_ID`.
- **`setup()` must not take the service down over its database.** If it cannot connect or create its tables, it closes any pool it opened, logs a warning, falls back to the memory store and returns `databaseConnected: false`. `/api/status` then reports it and the UI shows its "no database" banner. A pool handed in as `sql` belongs to the caller, so its failure is thrown. An offline app must not act on the outside world: no real mail, no mailbox reads, and service-token writes answer 503.
- **Importing from the platform:** only `server/platform/kit.js`. An app uses `readJson`, `sendJson`, `sendFile` and `httpError(status, message)`. The rest of what `kit.js` exports is for the portal, which builds its own server.
- **The routes every app has** (`/health`, `/api/status`, `/api/me`, `/api/apps/:id`, `/api/logout`, `/auth/callback`) come from the platform and are documented in `server/platform/README.md`.

### 3.2 Errors

`throw httpError(400, 'Subject is required.')`. The client receives `{ error: 'Subject is required.' }`. Anything thrown without a status becomes a 500 with generic copy and is logged. Never put stack traces or SQL errors in `error`. A side effect that fails after the record was saved (an email, say) returns 2xx with `warnings: string[]` containing exact copy.

### 3.3 Small and large apps

A small app has `index.js` (catalogue, routes, setup), a `<domain>.js` for handlers and rules, `store/` (`memory.js` and `sql.js` with the same async interface), and tests. A large app (Ticketing) splits into `core/`, `features/<feature>/`, `services/` and `store/`. Start small, and move to the large layout in a dedicated commit with no behaviour change.

### 3.4 The UI

- **Static UI:** `web/index.html`, ES modules and CSS, with no build step. Shared code is imported by absolute address: `/platform/api.js`, `/platform/shell.js`, `/platform/icons.js`. Tests of its logic go in `test/web/`.
- **Built UI:** a Vite project in `web/` with its own `package.json`, building to `web/dist`. Set `ui = { root: 'web/dist', spa: true }`; `spa: true` answers an unknown path with no file extension with `index.html`, so the router handles deep links. Vite's `base` and the router's basename are `/`.
- **`ui.publicPaths`** lists UI pages that open without a sign-in, such as the page a link in an email opens. Everything else that is an HTML page sends a signed-out visitor to the portal. Scripts, styles, images and `/platform/` files are always public.
- **Chrome is mandatory.** The sidebar belongs to the app: its icon and name, its own links, and **All applications**, a link to `${portalUrl}/apps`. Static UIs call `mountChrome(user, { app, links })`. Built UIs draw the same markup (`app-nav`, `nav-close` with `data-close-applet`, `nav-link`) with the classes from `/platform/app.css`. `portalUrl` comes from `/api/me`, never from a build-time constant.
- **Look and feel:** colours, fonts and geometry come from `tokens.css`, whose semantic tokens (`--emg-bg`, `--emg-text`, `--emg-primary` and the rest) follow the light and dark themes. `docs/STYLE-GUIDE.md` has the rules; the components, the start-up splash and the logo loader come with `/platform/app.css`. Built UIs map the tokens into Tailwind through `@theme inline`. Never hard-code a hex value.
- **Joules is on every page.** The server adds `/platform/assistant.js` to every page an app serves, as it adds the wait screen, so an app does nothing to have the portal's helper in its corner (section 5.4). Leave the frame it adds (`iframe[data-emg-assistant]`) alone: don't hide, move or restyle it. While he stands in the corner the page's `.canvas` gets room at its end, so whatever is last on it can be scrolled clear of him; a built UI with no `.canvas` keeps its own bottom-right corner clear in the same way, under `:root[data-emg-assistant]`.
- **The bell is on every page with a sidebar** (template 1.8.0). The server adds `/platform/bell.js` to every page, the portal's and every app's, and it puts itself first in the sidebar's tool row (`.app-nav__tools`), so an app does nothing to have it. A static UI gets the row from `mountChrome`; a built UI that draws the sidebar itself must draw the same row, `div.app-nav__tools` inside `div.app-nav__top`, or it has no bell. Leave the button (`[data-notify-bell]`) and its panel (`#notify-panel`) alone, and don't call `/api/notifications` from app code: it is the platform's (section 5.5).
- **Access in the UI is only a convenience.** Pages hide what the person can't use, based on what the app's own session endpoint returns. Permission strings never appear in page source, and the API is the authority.

## 4. Signing in

### 4.1 Why a handoff

Each app has its own session: a cookie for its own address only, never shared with another app. The design began on Render, where `*.onrender.com` is on the Public Suffix List, so two apps could not share a cookie at all. On DigitalOcean each app has its own address (`ticketing-test.apps.energymatrix.com.au` and the rest) and the design is unchanged. The portal signs a person in once and hands each app a short-lived token.

### 4.2 The flow

1. A browser reaches an app with no valid session. A **page** request is redirected to `${PORTAL_URL}/handoff?app=<appId>&return=<relative path>`. An **API** request is answered `401` with JSON, never a redirect: `{ "error": "Sign in required", "signIn": "<handoff address>" }`. The shared client (`api()`) then sends the whole page to `signIn`.
2. The portal checks its own session, showing its sign-in page first if needed. It then checks that the person is active and has access to `<appId>`. If not it says "You do not have access to this application."
3. The portal signs a token (section 4.3) and answers with a small page holding a form that **POSTs** `token` and `return` to the app's registered address, `${appUrl}/auth/callback`. A POST keeps the token out of URLs, history and logs. The portal only ever posts to an address stored for the app in its `emg.apps` table, which is what stops it being used as an open redirect.
4. The app checks the signature with `PORTAL_SIGNING_PUBLIC_KEY`, then that the audience is its own `APP_ID`, that the token has not expired, and that its id has not been used. It sets its own session cookie and redirects to `return`. Only a `return` that starts with a single `/` is accepted; anything else becomes `/`.

### 4.3 The token

Two parts joined by a dot, both base64url: the claims as JSON, then an Ed25519 signature of the first part. There is no algorithm field to trust.

```
{ sub, email, name, portalAdmin, role, aud: <appId>, iat, exp: iat + 60, jti }
```

`sub` is the portal user id. `role` is the company role id or `null`; a token from a portal before template 1.4.0 has none, and the app reads anything that is not a role id as `null`. Apps on an older template ignore it. `jti` is a random id kept in memory until the token would have expired, so a token works once. The app also refuses a token that lives longer than five minutes, even one the portal signed.

### 4.4 The app session cookie

- Named `emg_<appId>_session`. Names differ because cookies on localhost are shared across ports.
- `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when `COOKIE_SECURE=true`.
- The value is HMAC-signed with `APP_SESSION_SECRET`. It holds the user and an **absolute** expiry of `APP_SESSION_MINUTES` (default 30). It is **not sliding**: using the app does not extend it.

### 4.5 Signing out

`POST /api/logout` clears the app's cookie and answers `{ "logoutUrl": "<PORTAL_URL>/logout" }`. The UI navigates there and the portal ends its own session. Other apps' sessions keep running until they expire.

### 4.6 Trade-offs to know

- **Deactivating someone takes up to `APP_SESSION_MINUTES` to bite.** The portal ends the person's own sessions at once, but an app already holding a cookie keeps trusting it until it expires. After that the app sends the person to the portal, which refuses them. Thirty minutes is the default; lower it for an app that needs a tighter limit.
- **Sign-out is not global.** Signing out of one app ends that app and the portal. The other apps' cookies run out on their own.
- **Replay protection is per process.** An app with several instances keeps one list of used token ids per instance. A token lives 60 seconds and only travels in a form post, so this is accepted.
- **The app trusts the cookie, not the portal, between handoffs.** If the portal is down, people already signed in carry on until their cookie expires.

### 4.7 Keys

The portal alone holds `PORTAL_SIGNING_PRIVATE_KEY`. Every app holds only `PORTAL_SIGNING_PUBLIC_KEY`, and refuses to start if it is given a private key. A key can be pasted as PEM, as one line with `\n`, or as base64. `docs/SETUP.md` in `emg-portal` has the one-line command that makes a pair.

## 5. Talking to other apps and the portal

### 5.1 The directory

An app that needs to name people (assignees, @mentions, "can this person open the app") asks the portal's directory, server to server: `GET /api/directory/users` and `GET /api/directory/users/by-email/:email` with `Authorization: Bearer <PORTAL_DIRECTORY_TOKEN>`. `directory` in the handler context is a client for it with a short cache. A user is `{ id, email, displayName, accessLevel, accessLevelName, isActive, isPortalAdmin, role, apps, createdAt }`, where `apps` lists the ids the person can open and `role` is their company role id or `null`. Never a password hash. If the portal cannot be reached the call fails with a 502 and the person sees the app's normal error; code that can carry on without the answer catches it.

### 5.2 Service tokens

A server-to-server caller that has no session (GitHub Actions posting a release note, Claude raising a DevBoard ticket) sends `Authorization: Bearer <token>`. A route opts in with `service: 'SOME_TOKEN'`. The token is compared in constant time, wrong guesses are limited per client and in total (then `429`, even for the right token), a blank token never matches, and the caller is one fixed actor. A handler that must refuse a person with a session checks that actor.

### 5.3 Documented endpoints between apps

**Default: don't.** If an app needs another's data, the owner publishes a specific endpoint, marks it **Public to apps** in its `API.md` with the shape and the token it needs, and the consumer calls it server to server. `emg-accounts` shows the pattern: every app that can bill publishes `GET /api/<prefix>/billable-items?since=`, and Accounts collects them on a schedule (`docs/BILLABLE-ITEMS-CONTRACT.md` in `emg-accounts`). Bulk or analytical reads use a read-only SQL view the owner documents, and the consumer reads only that view.

### 5.4 Joules acting for a person

Joules, the EMG helper in the portal, can work in any app for the person he is talking to: look things up for them, and, once they have said yes, do things for them. Every app has the door for it, from the platform (`server/platform/assistant.js`), and says what Joules can do there in an optional `assistant` export from `server/app/index.js` (`assistant-schema.js` has the shape):

- **What an app offers.** `about` (a sentence or two for Joules) and `actions`, each with a `name`, a `kind`, a `title`, a `description` and an `input` (a small part of JSON Schema: object properties that are text with a `maxLength`, numbers, true or false, or lists of text). A **read** action only looks and has a `run`. A **write** action changes something and has a `preview` too: what the app would do, worked out by the app and changing nothing. An app with no `assistant` export still answers, with its catalogue description and no actions, so Joules knows it is there and can tell people what it is for. A new app gets the door from the template; giving Joules something to do is adding actions.
- **Only the portal comes through it, and only as one person.** For each call the portal signs a token with the same key as a sign-in token (`assistant-token.js`): for one person, one app and one thing (`manifest`, `preview:<action>` or `run:<action>`), good for 60 seconds and used once. The app checks it with the same public key and hands the action the person, in the same shape as a session's `user`, so the action applies every rule the app has for them, exactly as if they had pressed the button themselves. A browser's session is never enough, a wrong token is limited as service tokens are, and the token can never sign anyone in (a sign-in token has no `typ`, and its claims are elsewhere).
- **People say yes, not Joules.** The portal asks for a write action's preview, shows the person what the app said it would do, and runs it only once the person has agreed: the portal decides that from what the person did, never from what Joules said. A write while the app is on its memory fallback is refused (503).
- **What comes back** is `{ result }` for a read (any JSON, at most 64 KB: keep it to what Joules needs), `{ preview: { summary, fields } }` and `{ done: { summary, ref, path } }`, where `path` is a page of the app (`/tickets/42`); the portal builds the link from the address it holds for the app, never from what an app sends.
- **On a phone call or by text (from template 1.7.0).** People can also talk to Joules by ringing or texting a number the portal answers. The portal's token then says so: `via` is `voice` or `sms`, and `session` is the portal's id for the call or text thread. A chat token has neither, exactly as before. An app offers each of those ways its own set of actions, `channels: { voice: [...], sms: [...] }` beside `actions` (which stays the chat's), and the door offers and runs only that way's set: an action an app keeps out of a phone call (archive, say) answers `404` to a `voice` token. An app with no set for a way offers nothing there, so it is not reachable by phone. The action finds `context.via` and `context.session`, and records them with what it changes.
- **"What you were shown is what is done" (from 1.7.0).** A write's preview may answer `check`, a short text the app works out from exactly what it would do (a hash of its plan). The portal sends it back with the run (`{ mode: 'run', input, check }`), and the action finds it as `context.check`, so it can answer `409` rather than do anything other than what the person agreed to. The portal uses it on the phone, where the read-back is all the person hears.
- List the actions in `docs/API.md` under "What Joules can do here"; `test/contract.test.js` checks it.

**In the corner of every page (from template 1.5.0).** Joules stands in the corner of every page of every app, as he does on the portal's own pages, unless the person has hidden him in that app:

- **The portal draws him, in a frame.** `web/platform/assistant.js` asks `/api/me` (`{ user, portalUrl, appId }`) and puts the portal's page `/clip/frame/?app=<appId>` over the window, see-through, and cut (`clip-path`) to the shape he takes up, which the frame reports. Everywhere else the page is clicked as if he were not there. His chat, the cards that ask the person yes or no, and the portal's session stay in the portal: the app never sees the conversation and nothing on the app's page can press his buttons.
- **Only the app's own address may show that page.** The portal serves it with `Content-Security-Policy: frame-ancestors <the address saved for the app>`, and only for an app that is on, has an address, and the person may open. The frame is sandboxed: it may open a link in a new tab, save a file the person asked for (Download CSV on a table or chart he shows, from template 1.8.1), and move the app's page only when the person clicks a link in it.
- **He shows only for the person signed in to the app.** The page tells the frame the app session's user id and theme, the frame checks the portal's session is the same person, and otherwise it says `gone` and the page takes the frame away. So does a page nobody is signed in to (a public page), a page inside a frame, and a person signed out of the portal.
- **A person can hide him, one app at a time.** **Hide Joules in** and the app's name, in his chat window, takes him out of that app for that person, on every computer; their other apps keep him. He stays on the portal's pages, where his chat window has a button for each app he is hidden in that brings him back there. The portal remembers it, not the app.
- **He steps aside for a Joules of the page's own (from template 1.6.0).** A page that shows Joules itself for a while, such as a guided tour he narrates, calls `stepAside(true)` from `/platform/assistant.js` as it starts and `stepAside(false)` when it ends, so only one Joules is ever on screen. The frame stays where it is, chat and all, unseen and taking no clicks, and comes back exactly as it was. Nothing about it is sent to the portal. The page keeps the answer on `<html>` (`data-emg-assistant-aside`), so a frame that arrives while it is set steps aside at once. Don't hide or move his frame any other way.
- **One site.** The portal's session cookie reaches the frame only when the portal and the app are on the same site, as `portal-test.apps.energymatrix.com.au` and `ticketing-test.apps.energymatrix.com.au` are. An app at an address on another site gets no Joules (the frame finds nobody signed in and goes), and loses nothing else.

### 5.5 Notifications under the bell

Every person has a bell (template 1.8.0, section 3.4). **The portal decides everything about it:** what administrators write in its Admin Settings (news and tips, for everyone or for the people who can open one application), what it says about a person's own account (an application they can now open, their new role), what is unread and what was put away. An app holds none of it. Its platform has three routes for the person signed in, `GET /api/notifications`, `POST /api/notifications/read` and `POST /api/notifications/tips/:id/dismiss` (`server/platform/notifications.js`), and each asks the portal's directory for that person with `PORTAL_DIRECTORY_TOKEN` (`/api/directory/users/:id/notifications`, the same paths after it). They belong to the platform: no app may use the prefix `/api/notifications`. A link from the portal to one of its own pages starts with `/` and the bell sends it to `PORTAL_URL`. An app that cannot reach the portal simply has no bell. **An app does not write notifications yet**: news about an app is written by an administrator in the portal. If an app needs to tell a person something itself, that is a new directory route in the portal, agreed with Mat first.

### 5.6 Never another app's database

An app connects only to its own database, `<APP>_SQL_DATABASE`, and creates objects only in its own schema. It never connects to the portal's database or another app's.

## 6. Data

### 6.1 Ownership

| Data | Owner | How others get it |
| --- | --- | --- |
| Portal identity: id, email, name, active, portal admin, app access | `emg-portal` (`emg.users`, `emg.app_access`) | Server: `user` in a handler and `directory`. Browser: `/api/me`. Written only by the portal's admin screens |
| Portal sessions | `emg-portal` (`emg.sessions`) | Never |
| Domain records, including the app's own record about a person | The app | A published endpoint (section 5.3) |
| Roles inside an app (Ticketing administrators, team membership, ...) | The app's tables | The app's own session endpoint |

Don't harmonise naming across apps. Ticketing keeps Dataverse-style `createdOn`, while the portal and Documentation use `createdAt`.

### 6.2 SQL conventions

- **Isolation:** each app has its own SQL database on the shared server (`TICKETING_SQL_DATABASE`, `DOCUMENTATION_SQL_DATABASE`, `DEVBOARD_SQL_DATABASE`, ...) and creates objects only in its own schema inside it. Tests use a temporary schema and drop it.
- **`setup()` creates or upgrades the app's tables idempotently at boot.** Changes are additive only: new tables, new nullable columns, new indexes. Destructive or data migrations are a planned change reviewed by Mat, never an automatic boot step.
- **One interface, two adapters.** A memory adapter and a SQL adapter implement the same async interface, and tests run against memory by default. A SQL test runs the same behaviour against a real database when `.env` names one (`npm run test:sql`).
- **Seed data** is deterministic and runs once, guarded by a marker row. It resumes safely if interrupted.
- **Queries are parameterised, always.** Never concatenate user input into SQL. Identifiers such as schema names are fixed in code or validated against `^[a-z_][a-z0-9_]*$` before they are used.
- **Presenters:** stored rows are never sent directly. Map them through a presenter so the response shape is deliberate and matches `API.md`.
- **Secrets** live only in `.env` (never committed) and in the DigitalOcean app's environment variables, marked Encrypt. `.env.example` holds names and comments only.

### 6.3 Databases that pause when idle

The test environment's SQL databases pause when nobody is using them, to save cost. The first request after a pause is refused (error 40613, "Database ... is not currently available") while the database starts, which takes about a minute. The platform handles this once, for every app. An app does nothing.

- **Server (`server/platform/database-wake.js`, `dispatch.js`):** a request that fails because a database is starting is answered `503` with `X-Database-State: starting`, `Retry-After` and `{ error, code: 'database-starting' }`. The one error handler does this, so it covers every route. The driver refuses the connection before any statement runs, so the browser can send the request again whatever its method.
- **Browser (`web/platform/db-wake.js`):** the server adds this script to every page. It wraps `fetch`. On that 503 it covers the page with a spinner and the server's message, asks again every few seconds, and hands the page the real response once the database is up. The page never sees the 503. After five minutes it gives up with a plain 503.
- **Boot:** `setup()` that throws because its database is starting is tried again for up to five minutes. An app's own `setup()` does not throw over its database: it falls back to memory at once (section 3.1). The Vite dev server serves its own HTML, so browse through `npm start` to see the wait screen.
- **`SQL_AUTO_PAUSE`** only changes the wording. It is on unless set to `false`, which says "temporarily unavailable" instead of naming a cost-saving pause. Set it to `false` in production.

What an app must not do:

- Catch a database error in a handler or service to reword it. One that turns it into its own 4xx or 5xx, or into a `warnings` entry, hides it from the wait screen.
- Call the API any way but `fetch`. XMLHttpRequest and libraries built on it are not wrapped; `test/platform/boundaries.test.js` fails on them.

## 7. Security checklist for every route

- `auth: true` on every route. The approved exception is a route that a link in an email must open without a sign-in (Ticketing's rating link). Such a route is built with the app's `publicJson()`, never resolves an app user, checks a single-purpose expiring token that is stored only as a hash, counts unknown tokens per client and in total, records nothing on GET (mail scanners open every link), and is listed under "Public routes" in `API.md`. Any other public route needs Mat's approval first.
- The in-app role check happens in the handler or service, before any read of restricted data. Return 403 with the app's exact denied copy. Return 404 rather than 403 when revealing existence would leak information.
- Validate and bound every input: lengths, enums, dates, ids, body size (`readJson` limit) and pagination limits.
- Files go through `sendFile` (attachment disposition, `no-store`, `nosniff`). Never serve user uploads inline.
- Log server errors without request bodies or personal data.
- Anything that calls an external service (mail, blob, a model service) reads its credentials from `env` in `setup()` and has a mock adapter for tests. Tests never touch the network, except the opt-in SQL tests.
- Slow outside work (mail, MYOB, heavy exports) belongs in a background job, never inside a request.

## 8. Testing

| Where | What | How |
| --- | --- | --- |
| `test/*.test.js` | Behaviour through HTTP | `withServer`, `login` and `request` from `test/helpers.js` |
| `test/sql.test.js` | The same behaviour on SQL | Skips without `.env`; temporary schema; drop afterwards |
| `test/contract.test.js` | `docs/API.md` and the routes agree | Parses the route table, compares with the routes |
| `test/web/` | Static UI logic | `node --test` |
| `web/src/**/*.spec.tsx` | A built UI | Vitest and Testing Library; fake the API |
| `test/ui/**/*.ui.js` | The UI in a real browser | Playwright through `node --test`: `npm run test:ui` |
| `test/platform/` | The platform itself | Copied from the template; never edited in an app |

- `withServer` starts the app with a fake portal. `login(base, email)` signs in through the real handoff, so the real cookie code runs in every test.
- Test through public surfaces only, never store internals. A storage refactor with no behaviour change must not break a test.
- Cover the deliberate gaps with tests so nobody "fixes" them.
- Mute expected `console.error` output in failure-path tests rather than letting stack traces fill the output.
- **Definition of done:** `npm test` is green, `npm run test:ui` is green where the repo has browser tests, `npm run test:sql` is green when you touched SQL, `docs/API.md` is updated, and there are no secrets anywhere.

## 9. Hosting

- **DigitalOcean App Platform, region SYD1 (Sydney).** Each environment is one App Platform app, with one Web Service component per EMG app, each built from its own repo. The test environment is the app `test-emg-portal`: its components build from branch `test` with Autodeploy on, so a merge into `test` deploys that component. Production is the project "Prod EMG App Portal" and presumably deploys from `main`. An app that is not a component is not deployed; adding it is **Add components**, then its address in the portal's Admin Settings.
- **Addresses** are custom domains. On test: `https://portal-test.apps.energymatrix.com.au`, `https://ticketing-test.apps.energymatrix.com.au`, and so on for each app. Keep the portal and every app of one environment on one site (`*.apps.energymatrix.com.au`): Joules's frame needs the portal's cookie, which a browser sends to a frame only on the same site (section 5.4).
- **Settings live in two places.** App-level environment variables are shared by every component: the SQL login and each app's `<APP>_SQL_DATABASE`, the portal's address and public key, the directory token, `COOKIE_SECURE`. Component-level variables are one app's own: `APP_ID`, `APP_URL`, `APP_SESSION_SECRET` (a different value in every component; DigitalOcean does not generate it) and `APP_SESSION_MINUTES`. A component-level value beats an app-level one with the same name. `PORTAL_SIGNING_PRIVATE_KEY` is only ever on the `emg-portal` component, never app-level.
- **DigitalOcean does not set `RENDER`.** The platform treats a process as serving real people when `COOKIE_SECURE=true`, `NODE_ENV=production` or `RENDER` is set, so `COOKIE_SECURE=true` stays set. Without it the session cookie is not `Secure`, and unless `NODE_ENV=production` is set instead, an app no longer insists on `https` addresses.
- **Every component** reads `PORT`, `APP_URL`, `PORTAL_URL` and the rest from settings, and answers `GET /health`; set that as its HTTP health check path. A repo builds with `npm run build` and starts with `npm start`; the component's Settings say which commands it runs. Its log is on the app's Runtime Logs tab. The Console tab is a shell inside a running component with its settings loaded, so a script against its database (`node scripts/<script>.js`) runs there with no `.env` to copy. Actions, Force Rebuild and Deploy redeploys it.
- **The Azure SQL firewall** must allow the app's outbound addresses. The app's Networking settings show them when it has dedicated egress IPs; without them the outbound address can change.
- Each repo's `render.yaml` is left over from Render. DigitalOcean does not read it. `docs/SETUP.md` in `emg-portal` lists every setting, the order to deploy in, and the smoke test.

## 10. When to stop and ask

- The work needs a change to `server/platform/`, `web/platform/` or `test/platform/` (that is a change to the template), a new dependency, or another app's data.
- The work needs a destructive schema change or a data migration.
- The spec is ambiguous about user-facing copy or behaviour, or a "bug" might be a deliberate gap.
- Personal data would be copied into a new place, such as a model training set, a log or an export.
- A test would have to be weakened to pass.
- A task can only be done by changing `main`.
