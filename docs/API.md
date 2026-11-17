# AGIG Nominations API

Every route needs a signed-in person, except any listed under [Public routes](#public-routes). The portal has already checked that the person may open this app. What they may do inside it is this app's own business: everyone who can open it may look at everything, and the one change it takes, acknowledging or clearing an alert, is for the ops team (company role Ops Trader or Manager, or an administrator: `server/app/access.js`). Anyone else gets `403` `Only the ops team can acknowledge or clear alerts. Ask an administrator if you need to.`

**The app only watches.** The design's nomination worker loads each batch from the ops team's workbook, checks it, sends its SHNOM file to AGIG, records AGIG's emailed answer and raises the alerts, in the `ref`, `nom` and `ops` tables. Every route here reads those tables, except the two alert routes. That is deliberate (`test/reference.test.js` pins it): don't add a route that changes a batch, a response or the reference data without asking.

`test/contract.test.js` fails if this table and `server/app/index.js` disagree. Change both in the same commit.

## Conventions

- A success response is the JSON shown. A failure is `{ "error": "<message>" }` with a 4xx or 5xx status. Anything unexpected returns `Something went wrong. Please try again.` and is logged.
- Without a session, an API route answers `401` with `{ "error": "Sign in required", "signIn": "<portal handoff address>" }`. The shared UI client sends the whole page to `signIn`.
- An id in a path that is not a number is a `404` `There is no such record.`
- A Gas Day is `yyyy-mm-dd`. Times are ISO 8601 in UTC; AWST is UTC+8 all year. Quantities are text with three decimals, `"12.500"`, in TJ.
- Batches are those of the environment the app is set to (`NOM_ENVIRONMENT`, `NP` or `PROD`).

### A batch

`{ id, environment, status, statusLabel, gasDayFrom, gasDayTo, sourceFile, sourceSha256, contentSha256, supersedesBatchId, createdBy, createdAt, validatedAt, approvedBy, approvedAt }`, as the worker wrote it. `status` is one of `IMPORTED`, `VALIDATION_FAILED`, `VALIDATED`, `APPROVED`, `BUILT`, `UPLOADING`, `UPLOADED`, `UPLOAD_UNCERTAIN`, `ACCEPTED`, `REJECTED`, `NO_RESPONSE`, `DUPLICATE`, `SUPERSEDED`, `CANCELLED`; `statusLabel` says it in words. `sourceFile` is the workbook snapshot it was loaded from.

## Routes

| Method | Path | Who | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/agig-nomination/session` | anyone | `{ user, canActOnAlerts, environment, today, databaseConnected, openAlerts }`: what the pages need to know. `today` is today's Gas Day date in Perth; `openAlerts` counts the alerts still open. |
| `GET` | `/api/agig-nomination/board` | anyone | `{ today, now, environment, cutoffWarningMinutes, days }`: the Gas Day board, D-1 to D+7. `cutoffWarningMinutes` is `NOM_CUTOFF_WARNING_MINUTES`, how close a cutoff counts as close. Each day is `{ gasDay, offset, colour, label, initialCutoff, renominationCutoff, latest, accepted, held }`. `colour` is `green`, `blue`, `amber`, `red`, `grey` or `none` (`docs/SPEC.md`, "Gas Day board"). `latest` is the latest batch that counts (`{ batchId, status, statusLabel, createdAt, createdBy, fileName, inletTJ, outletTJ }` for that day) or `null`; `accepted` the latest accepted batch (`{ batchId, fileName, sentAt }`) or `null`; `held` what AGIG holds for the day, line by line from every accepted file: `{ lines, inletTJ, outletTJ }`. |
| `GET` | `/api/agig-nomination/reference` | anyone | `{ pipelines, contracts, designations, errorCodes, fileTemplate }`, read-only. A contract is `{ id, code, type, pipelineCode, startDate, endDate, capacityTJ, serviceType, subServiceType, isActive }`; a designation `{ id, pipelineCode, code, direction, locationName, notes, specSection, validFrom, validTo }`. |
| `GET` | `/api/agig-nomination/batches` | anyone | Query `gasDay`, `status`, `view` (`attention`: failed the checks, rejected, no answer or upload uncertain; `waiting`: loaded or sent, no answer yet) and `limit` (1 to 500, default 100). `{ batches }`, newest first, each a batch with `lines`, `inletTJ`, `outletTJ`, `issueErrors` and `issueWarnings` (what the worker's checks found), `agigErrors` (AGIG's error lines) and `file` (`{ id, fileName, status, builtAt, uploadedAt, respondedAt }` or `null`). `400` for a `gasDay` that is not a date or an unknown `status`. |
| `GET` | `/api/agig-nomination/batches/:id` | anyone | One batch in full: `{ batch, rows, days, issues, file, files, responses, unpinnedErrors, timeline, changes, supersededBy }`. Each row has `issues` (what the worker's checks found on it) and `agigErrors` (AGIG's errors on its line, each `{ lineNumber, errorCode, errorDescription, meaning }`). `days` is `{ gasDay, lines, inletTJ, outletTJ }` for each Gas Day in it; `issues` the findings about the batch as a whole; `unpinnedErrors` AGIG's errors on a line the file does not have. `timeline` is the six steps with their times. `changes` is how it differs from what AGIG held before it: `{ gasDay, contract, nomType, designation, before, after, change }`. `404` for an unknown id. |
| `GET` | `/api/agig-nomination/batches/:id/file` | anyone | The SHNOM file, exactly the bytes the worker sent, as an attachment named as AGIG received it. `404` when the batch has no file. |
| `GET` | `/api/agig-nomination/responses` | anyone | `{ responses }`, newest first: `{ id, messageId, receivedAt, sender, subject, attachmentName, parsedFileName, parsedStatus, responseTimestamp, fileId, matchState, batchId, errorCount }`. `matchState` is `MATCHED`, `MANUAL`, `UNMATCHED` or `UNPARSEABLE`. |
| `GET` | `/api/agig-nomination/responses/:id/file` | anyone | AGIG's attachment as it arrived, as a download. `404` when there is none. |
| `GET` | `/api/agig-nomination/alerts` | anyone | Query `open`: `true` (default), `false` or `all`. `{ alerts }`, newest first: `{ id, type, severity, message, entityType, entityId, raisedAt, acknowledgedBy, acknowledgedAt, clearedAt }`. |
| `POST` | `/api/agig-nomination/alerts/:id/acknowledge` | ops team | `{ alert }`: someone is on it (the design's `ops.usp_AckAlert`). It stays open. `404` for an unknown alert; `503` on the memory fallback. |
| `POST` | `/api/agig-nomination/alerts/:id/clear` | ops team | `{ alert }`: closed. `404` for an unknown alert; `503` on the memory fallback. |
| `GET` | `/api/agig-nomination/system` | anyone | `{ environment, storage, alerts, closedAlerts, withAgig, waiting, lastSent, lastAnswered }`: the System page. `alerts` are the open ones, `closedAlerts` the 15 closed most lately; `withAgig` the files sent or being sent with no answer yet (or none in time, or of unknown fate), `waiting` the files made and not sent, each `{ id, batchId, fileName, status, builtAt, uploadedAt, respondedAt }`; `lastSent` and `lastAnswered` the latest of each, or `null`. |

## What Joules can do here

Joules, the EMG helper in the portal, works in this app for a person through the platform's door (below), as that person. These are the actions in `assistant` in `server/app/index.js`; `test/contract.test.js` fails if this table and that list disagree. They only look, as the app does.

| Action | Kind | What it does |
| --- | --- | --- |
| `gas_day_status` | read | `{ environment, today, days }`: for D-1 to D+7, each Gas Day's status in words and colour, both cutoffs (UTC), the latest batch and the outlet TJ AGIG holds. |
| `batch_status` | read | Input `{ batchId }`. `{ found, id, status, gasDays, publishedBy, lines, file, timeline, agigErrors, path }`, or `{ found: false }`. |
| `open_alerts` | read | `{ alerts }`: up to 30 open alerts, `{ id, type, severity, message, raisedAt, acknowledged }`. |

## Public routes

None. A route that must open without a sign-in needs Mat's approval first. It is built with `auth: false` and `public: true`, and listed here.

## Routes every app has

These come from the platform in `server/platform/`. They are the same in every app and are not part of the contract test.

- `GET /health`: `{ "ok": true }`. No sign-in. Set it as the component's HTTP health check path on DigitalOcean.
- `GET /api/status`: `{ "databaseConnected": true }`. No sign-in. `false` means the app is running on memory because its database could not be used.
- `GET /api/me`: `{ "user": { "id", "email", "displayName", "isPortalAdmin", "role" }, "portalUrl": "<portal address>", "appId": "<this app's id>" }`. Needs a session.
- `GET /api/apps/<id>`: this app's own catalogue entry. Needs a session. Any other id is a 404.
- `POST /api/logout`: clears this app's cookie and answers `{ "logoutUrl": "<portal address>/logout" }`.
- `POST /auth/callback`: the portal posts a signed token here (form fields `token` and `return`).
- `GET /api/assistant` and `POST /api/assistant/<action>`: the door for Joules, the portal's helper (`server/platform/assistant.js`). Only the portal can use it, with a token it signed for one person, this app and one thing to do.
