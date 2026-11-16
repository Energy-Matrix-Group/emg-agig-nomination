# AGIG Nominations

Shipper transport nominations to AGIG's TBS: enter, check, send and track every Gas Day against the cutoffs.

One Render web service: it serves this app's UI and its API from one Node process. People sign in at the portal, which hands them to this app. See `docs/ARCHITECTURE.md`.

Made from `emg-app-template` 1.6.5. `server/platform/`, `web/platform/` and `test/platform/` are copied from it and are never edited here.

## Run it

```powershell
npm install
copy .env.example .env
# Fill in .env: the portal's address and PUBLIC signing key, and a session secret. Then:
npm start
npm test
```

To sign in locally, run the portal too. `docs/SETUP.md` in `emg-portal` has the steps for the portal and two apps on ports 4000, 4001 and 4002.

## Settings

Every setting is in `.env.example` with a comment. Real values go in `.env` (never committed) or in the Render dashboard. `docs/SETUP.md` in `emg-portal` explains where each value comes from.

| Name | Example (never a real secret) | Where it comes from | Needed |
| --- | --- | --- | --- |
| `PORT` | `4001` | Render sets it. Empty means 3000. | optional |
| `COOKIE_SECURE` | `true` | `true` on Render, empty locally | optional |
| `NODE_ENV` | `production` | Render | optional |
| `APP_ID` | `agig-nomination` | This app's id. Must match `server/app/index.js`. | required |
| `APP_URL` | `https://emg-agig-nomination.onrender.com` | This service's own address, once Render has made it. Locally `http://localhost:4001`. | required in production |
| `PORTAL_URL` | `https://emg-portal.onrender.com` | The portal's address. Locally `http://localhost:4000`. | required |
| `PORTAL_SIGNING_PUBLIC_KEY` | `-----BEGIN PUBLIC KEY-----...` | The portal's public key (PEM, or base64 of the PEM). Never the private key. | required |
| `APP_SESSION_SECRET` | 32 or more random characters | Render can generate it (`generateValue`). Signs this app's cookie. | required in production |
| `APP_SESSION_MINUTES` | `30` | How long a sign-in lasts. Absolute, not sliding. Empty means 30. | optional |
| `PORTAL_DIRECTORY_TOKEN` | a long random string | The same value as on the portal. Lets the app look up users. | needed if the app looks up users |
| `SQL_SERVER` | `your-server.database.windows.net` | The Azure SQL server. Empty runs on memory. | optional |
| `AGIG_NOMINATION_SQL_DATABASE` | `emg-agig-nomination` | This app's own database on that server | with `SQL_SERVER` |
| `SQL_USER`, `SQL_PASSWORD` | | The SQL login | with `SQL_SERVER` |
| `SQL_AUTO_PAUSE` | `false` | `true` or empty while the databases pause when idle. `false` in production. | optional |

The Azure SQL firewall must allow this service's outbound addresses (Render dashboard, the service, Connect, Outbound). `docs/SETUP.md` in `emg-portal` has the step.

## Deploy

`render.yaml` describes the one service. It links the Render environment group `emg-test`, which holds the settings the services share (the portal's address and public key, the directory token, the SQL login), so make that group first (`docs/SETUP.md` in `emg-portal`, section 4.0). Create the service from the blueprint on the `test` branch and apply: there is nothing to type. `APP_URL` in `render.yaml` is the service's address; the portal learns it from the group (`PORTAL_APP_<ID>_URL`) or in Admin Settings, Applications. The group's SQL login is for the live apps, so `render.yaml` sets `SQL_SERVER` empty to keep this app on memory. When the app gets a database, delete that entry and add `AGIG_NOMINATION_SQL_DATABASE` to the group. `docs/SETUP.md` in `emg-portal` has the full steps and the Azure SQL firewall step.

## Working on it

Read `AGENTS.md` first. Branch from `test` and open pull requests into `test`, never `main`.
