# AGIG Nominations: spec

## Purpose

EMG ships gas on AGIG's pipelines (the DBNGP above all) and nominates each Gas Day through AGIG's Transmission Business System (TBS), by uploading a SHNOM file to AGIG's SFTP. AGIG checks it against its rules and the cutoffs, and emails back Success or Failure.

The design "AGIG TBS B2B Nomination Integration – Solution Design" (2 October 2026) splits the work in two. The ops team's workbook and the **nomination worker** on the office VM do it: the workbook calculates and publishes a snapshot, and the worker loads it into Azure SQL, checks it, builds and uploads the SHNOM file, reads AGIG's answer and raises alerts. A **monitor** shows how it is going. The design planned the monitor as a Power BI report and a few SSMS procedures. **This app is that monitor**, opened from the portal, so nobody needs Power BI for it.

It only watches (Eve, 17 November 2026: "I won't make any nomination from this app"). It reads the worker's `ref`, `nom` and `ops` tables, and the one thing it changes is an alert being acknowledged or cleared.

## Users

- **The ops team** (company role Ops Trader or Manager, and administrators): watch the Gas Days, read a rejected batch's errors, and acknowledge and clear alerts.
- **Everyone else the portal lets in**: sees everything and changes nothing (`server/app/access.js`). The portal decides who may open the app at all.

## Pages

- **Gas Day board** (`/`): the open alerts in a banner across the top (worst first, one line each, with a link to all of them), then one line per Gas Day from D-1 to D+7 with only what answers "is it covered, and how long have I got" (Eve, 17 November 2026: "does not need all details, make it clearer"): its status, the **next** cutoff with a countdown (the initial one until 14:00 the day before, then renominations until 20:00 on the day, then Closed; the exact time is in its tooltip, and it turns red within `NOM_CUTOFF_WARNING_MINUTES` on a day that is not accepted), and the outlet TJ AGIG holds. With several models (below, "Many models"), a day's status counts its models in each state ("6 accepted · 1 with AGIG · 1 needs attention"), and the day's name opens one line per model under it (each opening that model's latest batch), the models with nothing loaded for the day, and any line two models share; **Open all** opens every day. The **Model** picker narrows the board to one model, where a day opens that model's latest batch; the choice is in the address and remembered in the browser. On a phone each day and each model is a small card.
- **Submissions** (`/batches/`): every batch, newest first, with its **model ID** (the workbook model that made the snapshot; it and the batch number stay pinned on the left when the table scrolls sideways), its Gas Days, status, lines, outlet TJ, what the worker's checks found, AGIG's errors, when it was loaded and by whom, and when it was sent and answered. Filters: All, Needs attention, Waiting for AGIG, a Gas Day, a model, a status. A row opens the batch.
- **A batch** (`/batch/?id=`): where it is in a sentence, its model ID (under the heading and among its facts), who loaded and approved it and from which workbook snapshot, then its **lines**, each with its problems (AGIG's errors and the checks' findings, with a switch to show only the lines with one), the totals for each Gas Day, the timeline, the change from what AGIG held, AGIG's answers, and the SHNOM file to download.
- **AGIG responses** (`/responses/`): every answer, matched to its file, batch and that batch's model ID, with the attachment to download.
- **System and alerts** (`/system/`): the open alerts, worst first, with **I am on it** and **Clear** for the ops team; the files on their way (made and not sent, or with AGIG), each with its batch and model ID; the last file sent and the last answer; the alerts closed lately.
- **Reference data** (`/reference/`): the contracts, AGIG's 82 points (filtered by pipeline, direction or name), the pipelines, the 28 error codes and the SHNOM header. Read-only: the database administrator keeps them.

## Gas Day board

One row per Gas Day from D-1 to D+7 (`server/app/board.js`):

| Colour | Meaning |
| --- | --- |
| green | The latest batch loaded is the one AGIG accepted (or AGIG holds lines for the day and nothing newer is waiting) |
| blue | A file is with AGIG, waiting for its answer |
| amber | A batch is loaded but not sent yet; or nothing is accepted and the initial cutoff is within `NOM_CUTOFF_WARNING_MINUTES`, or has passed with renominations still open |
| red | The latest batch failed the worker's checks, or its file was rejected, had no answer or may not have arrived; or the 20:00 cutoff passed with nothing accepted, or with newer numbers never sent |
| grey | No active contract that day, or more than 90 days out |
| none | Nothing sent yet, with time to spare |

Cutoffs are AGIG's (spec section "Services relevant to a shipper"), in AWST (UTC+8 all year): the initial nomination for Gas Day D by 14:00 on D-1, renominations until 20:00 on D, nothing more than 90 days ahead. What AGIG *holds* for a day is worked out line by line: for each contract, Nom Type, point, marketer and service type, the value in the latest accepted file that carried it (the design's `nom.vAcceptedNomination` rule).

### Many models

Eve runs more than six workbook models (18 November 2026). Each publishes its own snapshots, so each batch belongs to one model (`nom.Batch.ModelId`), and each model's file goes to AGIG on its own. Two facts from Eve make that safe, and the board rests on them:

- **AGIG replaces only the lines a file carries.** A later file for a Gas Day changes the lines in it and leaves every other line as it was. So model B's file never undoes model A's, and what AGIG holds for a day is every model's accepted lines together, line by line, as above.
- **No two models nominate the same line** (contract, Nom Type, point, marketer and service type). If two did, AGIG would keep whichever file arrived later, so one model's number would silently replace the other's.

So the board judges each Gas Day **model by model**, with the colours above, from that model's batches alone: a newer batch from one model says nothing about another. The day is as bad as its worst model (red, then amber, blue, none, green); with a single model, the day is that model. A model that loaded a batch in the last 14 days (`ACTIVE_MODEL_DAYS`) and has loaded nothing for a Gas Day is listed for it as "nothing loaded", without colouring the day, because the app cannot know whether that model was meant to nominate that day. A line two models' latest batches both nominate makes the day at least amber, and both batches say so. A batch's change view compares it with its own model's earlier batches only. A batch with no model id (from before the column) counts as a model of its own.

## A batch's life (as the worker writes it)

`IMPORTED` when loaded; `VALIDATED` or `VALIDATION_FAILED` after its checks (in `nom.ValidationIssue`); `APPROVED`; `BUILT` when its file is made; `UPLOADING`, then `UPLOADED`; then `ACCEPTED` or `REJECTED` from AGIG's answer (in `nom.InboundResponse`, with its error lines in `nom.ResponseError`), or `NO_RESPONSE` and `UPLOAD_UNCERTAIN` when the answer does not come or the file's fate is unknown. Side states: `DUPLICATE`, `SUPERSEDED`, `CANCELLED`. The app shows each in words (`server/app/statuses.js`).

## Known facts

- Runs as one component of the DigitalOcean App Platform app, from this repo. People sign in at the portal; an administrator adds the app and gives each person access in Admin Settings.
- Its database (`AGIG_NOMINATION_SQL_DATABASE`) is the nomination hub's: the design's twelve tables and two views in `ref`, `nom` and `ops` (`server/app/store/schema.js`, `docs/schema/agig-nomination.sql`). The app makes any that are missing, checks that the ones it finds have every column it reads, and seeds the spec's reference data into empty tables. It never alters or drops anything.
- It starts no background job and reaches nothing outside the portal and its database. Loading, checking, sending, the mailbox and the alerts are the worker's.
- `test/worker.js` stands in for the worker in the tests and the demo: it writes rows exactly as the worker will.
- **The model ID** (Eve, 18 November 2026: "I have added the model ID for each snapshot ... so that users know which one is which") is `nom.Batch.ModelId`, written by the worker for each snapshot. The app shows it as text whatever its type in the database, and a dash for a batch from before it (`NULL`). A database whose `nom.Batch` has no `ModelId` is refused at boot by name, like any other missing column. The app makes it `nvarchar(100) NULL` only when it makes the table itself, in an empty database.

## Deliberate gaps

- **Nothing here makes or changes a nomination, a response or the reference data.** Every route only reads, except acknowledging and clearing an alert (`test/reference.test.js` pins it). Don't add one that does without asking.
- The app raises no alerts of its own; it shows the worker's. Its board colours are worked out each time a page asks, so they never wait for a job.

## Open questions

- The worker is still to be built (the design's Python worker). Until it is, the app shows only what is in the tables.
- ~~For AGIG, from the design: does a later SHNOM file for a Gas Day replace all earlier lines, or only the lines it contains?~~ Answered by Eve, 18 November 2026: only the lines it contains. The board's "AGIG holds" works line by line, and each model may send its own files ("Many models").
