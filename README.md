# AGIG Nominations

Shipper transport nominations to AGIG's TBS: enter, check, send and track every Gas Day against the cutoffs.

The web app for the design "AGIG TBS B2B Nomination Integration – Solution Design". It does what the design spread across Excel macros, a Python worker, SSMS and Power BI, in one place that people open from the portal:

- **New nomination**: type the lines, paste them from the workbook, upload a CSV, or start from a day AGIG accepted. Every line is checked as you go against the rules AGIG applies (the workbook's Check column and `usp_ValidateBatch`), and Publish makes the SHNOM file with AGIG's exact header and name.
- **Gas Day board**: yesterday to a week ahead, each day green, blue, amber, red or grey, with countdowns to 14:00 AWST the day before and 20:00 AWST on the day.
- **Submissions** and each **batch**: its timeline, AGIG's errors pinned to the lines, how it changes what AGIG held, and the actions (approve, cancel, send anyway, mark uploaded, settle).
- **AGIG responses** read from the shared mailbox with Microsoft Graph, or uploaded by hand; **Spot awards**; **Reference data** (contracts, AGIG's 82 points, error codes); **System and alerts**, with alerts to Teams.

One web service, a component of the DigitalOcean App Platform app, serving this app's UI and its API from one Node process. People sign in at the portal, which hands them to this app. See `docs/ARCHITECTURE.md`, then `docs/SPEC.md` and `docs/API.md`.

Made from `emg-app-template` 1.6.5. `server/platform/`, `web/platform/` and `test/platform/` are copied from it and are never edited here.

## Have a look

```powershell
npm install
npm run demo
```

Then open http://localhost:4001. It starts a stand-in for the portal on port 4000 that signs you in at once (as an Ops Trader), and the app on port 4001 on its memory store, with sample nominations for the next few Gas Days. Nothing to set up and nothing sent anywhere; Ctrl+C stops it and forgets everything. `npm run demo -- --empty` starts with no sample data, and `npm run demo -- --viewer` signs you in as someone who may look but not change anything.

## Run it

```powershell
npm install
copy .env.example .env
# Fill in .env: the portal's address and PUBLIC signing key, a session secret, and NOM_PARTICIPANT. Then:
npm start
npm test
```

To sign in locally, run the portal too. `docs/SETUP.md` in `emg-portal` has the steps for the portal and two apps on ports 4000, 4001 and 4002. With no `SQL_SERVER` the app keeps everything in memory, which is fine for trying it, and runs no job that reaches outside (no mailbox, no Teams).

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
| `APP_URL` | `https://agig-nomination-test.apps.energymatrix.com.au` | This component's own address. Locally `http://localhost:4001`. Also the link in Teams alerts. | required in production |
| `PORTAL_URL` | `https://portal-test.apps.energymatrix.com.au` | The portal's address. Locally `http://localhost:4000`. | required |
| `PORTAL_SIGNING_PUBLIC_KEY` | `-----BEGIN PUBLIC KEY-----...` | The portal's public key. Never the private key. | required |
| `APP_SESSION_SECRET` | 32 or more random characters | Its own value in this component, marked Encrypt. | required in production |
| `APP_SESSION_MINUTES` | `30` | How long a sign-in lasts. | optional |
| `PORTAL_DIRECTORY_TOKEN` | a long random string | The same value as on the portal. This app does not look people up, so it may stay empty. | optional |
| `SQL_SERVER` | `your-server.database.windows.net` | The Azure SQL server. Empty runs on memory. | needed on test and production |
| `AGIG_NOMINATION_SQL_DATABASE` | `emg-agig-nomination` | This app's own database. It may be the one the design's setup script already built: the app uses its `ref`, `nom` and `ops` tables as they are, and adds only what is missing. | with `SQL_SERVER` |
| `SQL_USER`, `SQL_PASSWORD` | | The SQL login. It needs to create tables in a new database; on one the setup script built, read and write is enough. | with `SQL_SERVER` |
| `SQL_AUTO_PAUSE` | `false` | `false` in production. | optional |
| `NOM_ENVIRONMENT` | `NP` | `NP` (AGIG's test system, the default) or `PROD`. | optional |
| `NOM_PARTICIPANT` | `Shipper1` | The participant name AGIG gave you, exactly, for the file names. | required to send |
| `NOM_AUTO_APPROVE` | `true` | `false` makes an operator approve each batch. | optional |
| `NOM_RESPONSE_TIMEOUT_MINUTES` | `20` | Minutes before a file with no answer raises an alert. Change it once AGIG's normal turnaround is known. | optional |
| `NOM_CUTOFF_WARNING_MINUTES` | `60` | How close to a cutoff the warnings start. | optional |
| `NOM_INITIAL_ALERT_TIME` | `13:00` | Perth time on D-1 to alert if nothing is accepted for D. | optional |
| `NOM_SFTP_KEY_EXPIRES` | `2027-10-01` | When AGIG's key expires (every 12 months). | recommended |
| `NOM_AGENT_TOKEN` | a long random string | The upload agent's token, marked Encrypt (`scripts/agent/README.md`). Empty: files are uploaded by hand. | optional |
| `NOM_MAIL_TENANT_ID`, `NOM_MAIL_CLIENT_ID`, `NOM_MAIL_CLIENT_SECRET`, `NOM_MAIL_MAILBOX` | | The Graph app registration (Mail.ReadWrite on the response mailbox only) and the mailbox. All four or none. | optional |
| `NOM_MAIL_AGIG_SENDER` | AGIG's sender address | Only emails from it are read. | recommended with the mailbox |
| `NOM_MAIL_POLL_SECONDS` | `60` | Seconds between reads. | optional |
| `NOM_TEAMS_WEBHOOK_URL` | `https://...` | A Teams Workflows webhook for alerts, marked Encrypt. | optional |

## How files reach AGIG

AGIG accepts SFTP only from the office's registered IP address, and its key is issued to us. The app runs on DigitalOcean, so it never connects to AGIG itself:

- **By hand** (no `NOM_AGENT_TOKEN`): on the batch's page, download the SHNOM file, upload it with WinSCP from the office VM, and press **Mark as uploaded**. The response timer starts then.
- **By the upload agent**: `scripts/agent/Send-Nominations.ps1` runs on the office VM every minute, collects the next file from the app over HTTPS and uploads it with WinSCP. `scripts/agent/README.md` has the setup.

AGIG's answers come back by email. With the `NOM_MAIL_*` settings the app reads them by itself; without them, save the CSV attached to AGIG's email and upload it on the AGIG responses page.

## Deploy

EMG runs on DigitalOcean App Platform in Sydney (SYD1). To deploy this app to test:

1. In `test-emg-portal`, choose **Add components** and pick `Energy-Matrix-Group/emg-agig-nomination`, branch `test`, source directory `/`. Leave Autodeploy on.
2. Set its component-level variables: `APP_ID` (`agig-nomination`), `APP_URL`, `APP_SESSION_SECRET` (its own, Encrypt), `APP_SESSION_MINUTES`, and the `NOM_*` settings above (secrets Encrypt).
3. Add `AGIG_NOMINATION_SQL_DATABASE` to the app-level variables. The database is the app's own: a new empty one, or the one the design's setup script built.
4. Health check path `/health`; build `npm run build`, run `npm start`.
5. In the portal's Admin Settings, Applications: give AGIG Nominations its address, switch it on and tick who may open it.

A component's log is on the app's Runtime Logs tab. `render.yaml` is left over from Render; DigitalOcean does not read it, and `test/render-blueprint.test.js` still checks it.

## Working on it

Read `AGENTS.md` first. Branch from `test` and open pull requests into `test`, never `main`.
