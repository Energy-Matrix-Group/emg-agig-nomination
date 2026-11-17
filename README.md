# AGIG Nominations

Shipper nominations to AGIG's TBS: every Gas Day against the cutoffs, every batch and AGIG's answers, and the alerts.

The monitoring side of the design "AGIG TBS B2B Nomination Integration – Solution Design": what the design planned as a Power BI report and SSMS procedures, as a web app people open from the portal. **It only watches.** The ops team makes the nominations in their workbook, and the design's nomination worker on the office VM loads each batch into the database, checks it, sends its SHNOM file to AGIG over SFTP, reads AGIG's emailed answer and raises the alerts. This app reads those tables:

- **Gas Day board**: the open alerts across the top, then one row per Gas Day from yesterday to a week ahead, coloured green, blue, amber, red or grey, with countdowns to 14:00 AWST the day before and 20:00 AWST on the day.
- **Submissions**: every batch, with its lines, totals, what the checks found, AGIG's errors and where its file got to. Open one to see its lines, with the problems on each, how it changes what AGIG held, the file and AGIG's answers.
- **AGIG responses**, **System and alerts** (where the ops team acknowledges and clears alerts: the one thing the app changes) and **Reference data** (read-only).

```
Workbook ──publish──> worker (office VM) ──SFTP──> AGIG TBS ──email──> worker
                          │ writes                                     │ writes
                          ▼                                            ▼
                     Azure SQL: ref, nom, ops  <── reads ──  AGIG Nominations (this app, in the portal)
```

One web service, a component of the DigitalOcean App Platform app, serving this app's UI and its API from one Node process. People sign in at the portal, which hands them to this app. See `docs/ARCHITECTURE.md`, then `docs/SPEC.md` and `docs/API.md`.

Made from `emg-app-template` 1.6.5. `server/platform/`, `web/platform/` and `test/platform/` are copied from it and are never edited here.

## Have a look

```powershell
npm install
npm run demo
```

Then open http://localhost:4001. It starts a stand-in for the portal on port 4000 that signs you in at once (as an Ops Trader), and the app on port 4001 on its memory store, with sample batches written as the worker would write them (`test/worker.js`). Nothing to set up and nothing sent anywhere; Ctrl+C stops it and forgets everything. `npm run demo -- --empty` starts with no sample data, and `npm run demo -- --viewer` signs you in as someone who may look but not settle alerts.

## Run it

```powershell
npm install
copy .env.example .env
# Fill in .env: the portal's address and PUBLIC signing key, a session secret, and the database. Then:
npm start
npm test
```

To sign in locally, run the portal too. `docs/SETUP.md` in `emg-portal` has the steps for the portal and two apps on ports 4000, 4001 and 4002.

```powershell
npm run test:sql   # the store's behaviour against a real database: needs SQL_SERVER, SQL_USER, SQL_PASSWORD, AGIG_NOMINATION_SQL_DATABASE in .env
node scripts/write-schema-script.js   # rewrites docs/schema/agig-nomination.sql after a change to server/app/store/schema.js
```

## Settings

Every setting is in `.env.example` with a comment. Real values go in `.env` (never committed) or in the environment variables of the DigitalOcean app: the shared ones at app level, this app's own at component level, secrets marked Encrypt. `test/settings.test.js` checks this table against `.env.example`.

| Name | Example (never a real secret) | Where it comes from | Needed |
| --- | --- | --- | --- |
| `PORT` | `4001` | Empty means 3000. Not set by hand on DigitalOcean. | optional |
| `COOKIE_SECURE` | `true` | `true` on DigitalOcean (app-level), empty locally. | required on DigitalOcean |
| `NODE_ENV` | `production` | Component-level, if wanted. | optional |
| `APP_ID` | `agig-nomination` | This app's id. Must match `server/app/index.js`. | required |
| `APP_URL` | `https://agig-nomination-test.apps.energymatrix.com.au` | This component's own address. Locally `http://localhost:4001`. | required in production |
| `PORTAL_URL` | `https://portal-test.apps.energymatrix.com.au` | The portal's address. Locally `http://localhost:4000`. | required |
| `PORTAL_SIGNING_PUBLIC_KEY` | `-----BEGIN PUBLIC KEY-----...` | The portal's public key. Never the private key. | required |
| `APP_SESSION_SECRET` | 32 or more random characters | Its own value in this component, marked Encrypt. | required in production |
| `APP_SESSION_MINUTES` | `30` | How long a sign-in lasts. | optional |
| `PORTAL_DIRECTORY_TOKEN` | a long random string | The same value as on the portal. This app does not look people up, so it may stay empty. | optional |
| `SQL_SERVER` | `your-server.database.windows.net` | The Azure SQL server. Empty runs on memory. | needed on test and production |
| `AGIG_NOMINATION_SQL_DATABASE` | `emg-agig-nomination` | The nomination hub's database: the one the design's setup script built and the worker writes. The app reads its `ref`, `nom` and `ops` tables, and makes any that are missing. | with `SQL_SERVER` |
| `SQL_USER`, `SQL_PASSWORD` | | A SQL login that can read the three schemas and update `ops.Alert` (to acknowledge and clear). On a new, empty database it also needs to create the tables. | with `SQL_SERVER` |
| `SQL_AUTO_PAUSE` | `false` | `false` in production. | optional |
| `NOM_ENVIRONMENT` | `NP` | Which environment's batches to show: `NP` (AGIG's test system, the default) or `PROD`. | optional |
| `NOM_CUTOFF_WARNING_MINUTES` | `60` | How close to an initial cutoff a Gas Day with nothing accepted turns amber. | optional |

## Deploy

EMG runs on DigitalOcean App Platform in Sydney (SYD1). To deploy this app to test:

1. In `test-emg-portal`, choose **Add components** and pick `Energy-Matrix-Group/emg-agig-nomination`, branch `test`, source directory `/`. Leave Autodeploy on.
2. Set its component-level variables: `APP_ID` (`agig-nomination`), `APP_URL`, `APP_SESSION_SECRET` (its own, Encrypt), `APP_SESSION_MINUTES`, and `NOM_ENVIRONMENT` if it is not `NP`.
3. Add `AGIG_NOMINATION_SQL_DATABASE` to the app-level variables: the database the worker writes. The Azure SQL firewall must allow the DigitalOcean app's outbound addresses.
4. Health check path `/health`; build `npm run build`, run `npm start`.
5. In the portal's Admin Settings, Applications, add the app: id `agig-nomination` (it must equal `APP_ID`), name `AGIG Nominations`, a one-line description, its address (the component's https address, no path) and icon `agig-nomination`, and switch it on. Then, under Users, tick **AGIG Nominations** for each person who should open it. The portal shows the generic Applications icon until it has template 1.6.5, which has this app's icon; the app's own pages have it already.

A component's log is on the app's Runtime Logs tab. `render.yaml` is left over from Render; DigitalOcean does not read it, and `test/render-blueprint.test.js` still checks it.

## Working on it

Read `AGENTS.md` first. Branch from `test` and open pull requests into `test`, never `main`.
