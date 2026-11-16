# AGIG Nominations API

Every route needs a signed-in person, except any listed under [Public routes](#public-routes). The portal has already checked that the person may open this app. What they may do inside it is this app's own business: everyone who can open the app may look at everything, and only the ops team may change anything (company role Ops Trader or Manager, or an administrator: `server/app/access.js`). Anyone else gets `403` `Only the ops team can change nominations here. Ask an administrator if you need to.`

`test/contract.test.js` fails if this table and `server/app/index.js` disagree. Change both in the same commit.

## Conventions

- Bodies are JSON. Send `Content-Type: application/json`. Bodies are limited to 100 KB, except the routes marked *large*, which take 1 MB (a pasted batch of 2,000 lines, or an AGIG response).
- A success response is the JSON shown.
- A failure is `{ "error": "<message>" }` with a 4xx or 5xx status. Anything unexpected returns `Something went wrong. Please try again.` and is logged.
- Without a session, an API route answers `401` with `{ "error": "Sign in required", "signIn": "<portal handoff address>" }`. The shared UI client sends the whole page to `signIn`.
- While the app runs on its memory fallback (its database could not be used), every route that changes something answers `503` `AGIG Nominations is running without its database, so it is not taking changes. Try again shortly.`
- A Gas Day is `yyyy-mm-dd`. Times are ISO 8601 in UTC; AWST is UTC+8 all year. Quantities are text with three decimals, `"12.500"`, in TJ.
- Everything is for the environment the app is set to (`NOM_ENVIRONMENT`, `NP` or `PROD`).

### A line

What people give for each nomination line: `{ gasDay, contract, designation, quantity, marketer?, note? }`, all text. The rest of the SHNOM row comes from the reference data. A checked line (a *row*) adds `shipper`, `pipeline`, `nomType`, `serviceType`, `subServiceType`, `designationLocation` and `quantityTJ` (three decimals, or `null` when the quantity cannot be read).

### An issue

`{ line, lines, rule, severity, message }`. `line` is the 0-based line it belongs to, or `null` for a total; `lines` lists the lines a total was made from. `rule` is the AGIG error code the check mirrors (`502`, `503`, `504/506`, `505`, `507`, `508`, `510`, `512`, `515`, `519`, `522`, `524`, `528`) or one of the app's own: `DUP` (the same Gas Day, contract and designation twice), `RENOM` (after 14:00 the day before: a renomination), `EMPTY`, `SIZE` (more than 2,000 lines). `severity` is `Error` or `Warning`. A warning (`RENOM`, `524`) can be published once confirmed; an error cannot.

### A batch

`{ id, environment, status, statusLabel, gasDayFrom, gasDayTo, sourceFile, sourceSha256, contentSha256, supersedesBatchId, createdBy, createdAt, validatedAt, approvedBy, approvedAt }`. `status` is one of `VALIDATED`, `APPROVED`, `BUILT`, `UPLOADING`, `UPLOADED`, `UPLOAD_UNCERTAIN`, `ACCEPTED`, `REJECTED`, `NO_RESPONSE`, `DUPLICATE`, `SUPERSEDED`, `CANCELLED` (`IMPORTED` and `VALIDATION_FAILED` are allowed by the table but never written: a batch with an error is never made). `statusLabel` says it in words.

## Routes

| Method | Path | Who | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/agig-nomination/session` | anyone | `{ user, canOperate, environment, participant, autoApprove, delivery, mailbox, today, databaseConnected, openAlerts }`: what the pages need to know. `delivery` is `agent` when the upload agent is set up (`NOM_AGENT_TOKEN`), else `manual`; `mailbox` is whether the response mailbox is set up; `today` is today's Gas Day date in Perth; `openAlerts` counts the alerts still open. |
| `GET` | `/api/agig-nomination/board` | anyone | `{ today, now, environment, days }`: the Gas Day board, D-1 to D+7. Each day is `{ gasDay, offset, colour, label, initialCutoff, renominationCutoff, latest, accepted, held }`. `colour` is `green`, `blue`, `amber`, `red`, `grey` or `none` (`docs/SPEC.md`, "Gas Day board"). `latest` is the latest batch that counts (`{ batchId, status, statusLabel, createdAt, createdBy, fileName, inletTJ, outletTJ }` for that day) or `null`; `accepted` the latest accepted batch (`{ batchId, fileName, sentAt }`) or `null`; `held` what AGIG holds for the day, line by line from every accepted file: `{ lines, inletTJ, outletTJ }`. |
| `GET` | `/api/agig-nomination/reference` | anyone | `{ pipelines, contracts, designations, errorCodes, fileTemplate }`. A contract is `{ id, code, type, pipelineCode, startDate, endDate, capacityTJ, serviceType, subServiceType, isActive }`; a designation `{ id, pipelineCode, code, direction, locationName, notes, specSection, validFrom, validTo }`. |
| `POST` | `/api/agig-nomination/contracts` | ops team | Body: a contract without `id`. `201` `{ contract }`. `400` naming every problem (the code is `<Shipper>_<ref>`, a known pipeline, dates, a capacity of at most 3 decimals, a Service Type); `409` for a code already used. A Spot contract's Service Type is `SPOT` unless given. Written to the audit trail. |
| `PUT` | `/api/agig-nomination/contracts/:id` | ops team | Body: the whole contract. `{ contract }`. The audit trail records each field that changed. `404` for an unknown id. |
| `POST` | `/api/agig-nomination/designations` | ops team | Body `{ pipelineCode, code, direction, locationName, notes?, specSection?, validFrom, validTo? }`: a new point, or a new version of one AGIG renamed (the same code with a later `validFrom`). `201` `{ designation }`; `409` when that code already starts on that day. |
| `PUT` | `/api/agig-nomination/designations/:id` | ops team | Body `{ locationName, notes?, validTo? }`. Only the name, notes and end date of a point change, because old batches refer to its code, pipeline and start. `{ designation }`. |
| `GET` | `/api/agig-nomination/spot-awards` | anyone | Query `from`, `to` (default a week ago to 30 days ahead). `{ from, to, awards }`, each `{ id, gasDay, contractCode, awardedTJ, enteredBy, enteredAt }`. |
| `PUT` | `/api/agig-nomination/spot-awards` | ops team | Body `{ gasDay, contractCode, awardedTJ }`. Sets the Spot award for that Gas Day and Spot contract, made or changed in place. `{ award }`. `400` for a contract that is not Spot. |
| `DELETE` | `/api/agig-nomination/spot-awards/:id` | ops team | `{ deleted: true }`, or `404`. |
| `POST` | `/api/agig-nomination/lines/read` | anyone | *Large.* Body `{ text }`: rows copied from Excel (tab-separated) or a CSV. `{ lines, skipped, problems }`. Columns are found by their header (AGIG's names, in any order, and short forms such as `Quantity`); with no header, eleven columns are read in AGIG's order and four as Gas Day, Contract, Designation, Quantity. Dates may be `17/11/2026`, `17-Nov-26` or an Excel serial number. Rows with no contract are counted in `skipped`. Changes nothing. |
| `POST` | `/api/agig-nomination/lines/check` | anyone | *Large.* Body `{ lines }` (at most 2,000). `{ rows, issues, summary: { errors, warnings } }`: the live Check column. Changes nothing. |
| `GET` | `/api/agig-nomination/batches` | anyone | Query `gasDay`, `status`, `limit` (1 to 500, default 100). `{ batches }`, newest first, each a batch with `file` (`{ id, fileName, status, builtAt, uploadedAt, respondedAt }` or `null`). |
| `POST` | `/api/agig-nomination/batches` | ops team | *Large.* Publish. Body `{ lines, source?: { kind: 'grid' \| 'paste' \| 'file', name? }, confirmWarnings? }`. The lines are checked again: `422` `{ error, issues, summary }` on any error (no batch is made), `409` `{ error, issues, summary }` on warnings unless `confirmWarnings` is `true`. Otherwise `201` `{ batch, warnings }`. The batch is `DUPLICATE` when its numbers equal the latest accepted batch for the same Gas Days, and is then not sent. A batch for the same days that was waiting to be sent becomes `SUPERSEDED` and its file can no longer be sent. With `NOM_AUTO_APPROVE` on (the default), the batch is approved by the publisher and its file built at once (`BUILT`); without `NOM_PARTICIPANT` it stays `APPROVED` and `warnings` says why. |
| `GET` | `/api/agig-nomination/batches/:id` | anyone | One batch in full: `{ batch, rows, issues, file, files, responses, unpinnedErrors, timeline, changes, supersededBy, audit, actions }`. Each row has `agigErrors` (AGIG's errors on its line, each `{ errorCode, errorDescription, meaning }`) and `issues` (the warnings confirmed at publishing). `timeline` is the six steps with their times. `changes` is how it differs from what AGIG held before it: `{ gasDay, contract, nomType, designation, before, after, change }`. `actions` says which buttons apply for this person: `approve`, `cancel`, `sendAnyway`, `markUploaded`, `resolve`, `download`. `404` for an unknown id. |
| `GET` | `/api/agig-nomination/batches/:id/file` | anyone | The SHNOM file, exactly the bytes sent, as an attachment named as AGIG receives it (`SHNOM_<Participant>_<yyyymmddhhmmss>.csv`). `404` when the batch has no file. |
| `POST` | `/api/agig-nomination/batches/:id/approve` | ops team | For a `VALIDATED` batch (auto-approval off): approve it and build its file. `{ batch, warnings }`. `409` in any other status; `422` once the 20:00 cutoff has passed for one of its days. |
| `POST` | `/api/agig-nomination/batches/:id/cancel` | ops team | For a batch not yet sent. `{ batch }`; its built file is marked not sent. `409` otherwise. |
| `POST` | `/api/agig-nomination/batches/:id/send-anyway` | ops team | For a `DUPLICATE`: approve and build it all the same. `{ batch, warnings }`. |
| `POST` | `/api/agig-nomination/batches/:id/uploaded` | ops team | The file was uploaded by hand (WinSCP from the office VM): `UPLOADED` now, and the response timer starts. For a `BUILT` or `UPLOAD_UNCERTAIN` batch. `{ batch, warnings }`; `warnings` names any other file still waiting for AGIG's answer. `409` otherwise. |
| `POST` | `/api/agig-nomination/batches/:id/resolve` | ops team | Body `{ outcome, note? }` for a `NO_RESPONSE` or `UPLOAD_UNCERTAIN` batch, once someone has checked with AGIG or the TBS portal: `accepted`, `rejected`, or `send-again` (back to `BUILT`). `{ batch }`. `400` for another outcome, `409` in another status. |
| `GET` | `/api/agig-nomination/responses` | anyone | `{ responses }`, newest first: `{ id, messageId, receivedAt, sender, subject, attachmentName, parsedFileName, parsedStatus, responseTimestamp, fileId, matchState, batchId, errorCount }`. `matchState` is `MATCHED`, `MANUAL`, `UNMATCHED` or `UNPARSEABLE`. |
| `POST` | `/api/agig-nomination/responses` | ops team | *Large.* Body `{ fileName, text }`: the CSV attached to AGIG's email, uploaded by hand. `201` `{ response, ... }`: with `status` (`ACCEPTED` or `REJECTED`) and `batchId` when it matched a file, `unmatched: true` when it names a file this app did not send, or `problem` when it cannot be read (no End row, no Filename, a Status that is neither Success nor Failure). `409` when that exact response is already recorded. |
| `GET` | `/api/agig-nomination/responses/:id/file` | anyone | The response as AGIG sent it, as an attachment. `404` when there is none. |
| `POST` | `/api/agig-nomination/responses/:id/link` | ops team | Body `{ fileName }`: an `UNMATCHED` response that is about one of our files after all. It is applied to that file as if it had matched (`MANUAL`). `404` for an unknown response or file; `409` for a response that is not `UNMATCHED`. |
| `GET` | `/api/agig-nomination/alerts` | anyone | Query `open`: `true` (default), `false` or `all`. `{ alerts }`, newest first: `{ id, type, severity, message, entityType, entityId, raisedAt, acknowledgedBy, acknowledgedAt, clearedAt }`. |
| `POST` | `/api/agig-nomination/alerts/:id/acknowledge` | ops team | `{ alert }`: someone is on it. It stays open. |
| `POST` | `/api/agig-nomination/alerts/:id/clear` | ops team | `{ alert }`: closed. The same problem found again raises a new alert. |
| `GET` | `/api/agig-nomination/system` | anyone | `{ environment, participant, autoApprove, responseTimeoutMinutes, cutoffWarningMinutes, storage, delivery, mailbox, keyExpires, keyDaysLeft, teams, jobs, alerts, audit }`: the System page. `delivery` is `{ mode, agentSeenAt, inFlight, waiting, lastSent, lastAnswered }`; `mailbox` `{ configured, mailbox, lastRunAt, lastOkAt, lastError, failures, recorded }` (never a secret); `alerts` the open alerts; `audit` the 30 latest changes. |
| `POST` | `/api/agig-nomination/mailbox/check` | ops team | Reads the response mailbox now, in the background. `202` `{ started: true }`. `409` when the mailbox is not set up; `503` on the memory store. |
| `POST` | `/api/agig-nomination/agent/claim` | the upload agent | `Authorization: Bearer <NOM_AGENT_TOKEN>`; a person's session is refused (`403` `Only the upload agent may use this.`). The next file to upload: `{ file: { id, batchId, fileName, sha256, size, body }, environment }` with `body` in base64, and the file and batch become `UPLOADING`. `{ file: null }` when there is none, and `{ file: null, waitingFor }` while another file waits for AGIG's answer (one at a time, unless the next file's initial cutoff is within `NOM_CUTOFF_WARNING_MINUTES`). |
| `POST` | `/api/agig-nomination/agent/files/:id` | the upload agent | Body `{ outcome, remoteSize?, error? }`. `uploaded` with the size the agent found on AGIG's server (a size that differs from what was sent is taken as `uncertain`); `not-sent` when the connection failed before the upload began (back to `BUILT`, an alert after three tries); `uncertain` when it failed during the upload (never sent again by itself; an alert). `{ recorded }`. `409` for a file that is not `UPLOADING`. |

## What Joules can do here

Joules, the EMG helper in the portal, works in this app for a person through the platform's door (below), as that person. These are the actions in `assistant` in `server/app/index.js`; `test/contract.test.js` fails if this table and that list disagree. They only look: publishing stays a deliberate step on the New nomination page.

| Action | Kind | What it does |
| --- | --- | --- |
| `gas_day_status` | read | `{ environment, today, days }`: for D-1 to D+7, each Gas Day's status in words and colour, both cutoffs (UTC), the latest batch and the outlet TJ AGIG holds. |
| `batch_status` | read | Input `{ batchId }`. `{ found, id, status, gasDays, publishedBy, lines, file, timeline, agigErrors, path }`, or `{ found: false }`. |
| `open_alerts` | read | `{ alerts }`: up to 30 open alerts, `{ id, type, severity, message, raisedAt, acknowledged }`. |

## Public routes

None. A route that must open without a sign-in (for example a link in an email) needs Mat's approval first. It is built with `auth: false` and `public: true`, and listed here. The upload agent's two routes are not public: they need the agent's bearer token (`service: 'NOM_AGENT_TOKEN'`).

## Routes every app has

These come from the platform in `server/platform/`. They are the same in every app and are not part of the contract test.

- `GET /health`: `{ "ok": true }`. No sign-in. Set it as the component's HTTP health check path on DigitalOcean.
- `GET /api/status`: `{ "databaseConnected": true }`. No sign-in. `false` means the app is running on memory because its database could not be used.
- `GET /api/me`: `{ "user": { "id", "email", "displayName", "isPortalAdmin", "role" }, "portalUrl": "<portal address>", "appId": "<this app's id>" }`. Needs a session.
- `GET /api/apps/<id>`: this app's own catalogue entry, `{ "app": { "id", "name", "description", "statusLabel", "message", "href" } }`. Needs a session. Any other id is a 404.
- `POST /api/logout`: clears this app's cookie and answers `{ "logoutUrl": "<portal address>/logout" }`.
- `POST /auth/callback`: the portal posts a signed token here (form fields `token` and `return`).
- `GET /api/assistant` and `POST /api/assistant/<action>`: the door for Joules, the portal's helper (`server/platform/assistant.js`). Only the portal can use it, with a token it signed for one person, this app and one thing to do.
