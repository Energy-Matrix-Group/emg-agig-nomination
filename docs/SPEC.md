# AGIG Nominations: spec

## Purpose

EMG ships gas on AGIG's pipelines (the DBNGP above all) and nominates each Gas Day through AGIG's Transmission Business System (TBS), by uploading a SHNOM file to AGIG's SFTP. AGIG checks it against its rules and the cutoffs, and emails back Success or Failure.

The design "AGIG TBS B2B Nomination Integration – Solution Design" (2 October 2026) splits the work in two. The ops team's workbook and the **nomination worker** on the office VM do it: the workbook calculates and publishes a snapshot, and the worker loads it into Azure SQL, checks it, builds and uploads the SHNOM file, reads AGIG's answer and raises alerts. A **monitor** shows how it is going. The design planned the monitor as a Power BI report and a few SSMS procedures. **This app is that monitor**, opened from the portal, so nobody needs Power BI for it.

It only watches (Eve, 17 November 2026: "I won't make any nomination from this app"). It reads the worker's `ref`, `nom` and `ops` tables, and the one thing it changes is an alert being acknowledged or cleared.

## Users

- **The ops team** (company role Ops Trader or Manager, and administrators): watch the Gas Days, read a rejected batch's errors, and acknowledge and clear alerts.
- **Everyone else the portal lets in**: sees everything and changes nothing (`server/app/access.js`). The portal decides who may open the app at all.

## Pages

- **Gas Day board** (`/`): the open alerts in a banner across the top (worst first, with a link to all of them), then one row per Gas Day from D-1 to D+7: its status, both cutoffs with a countdown, the outlet TJ AGIG holds, the outlet TJ of the latest batch loaded, and that batch. A row opens that day's submissions.
- **Submissions** (`/batches/`): every batch, newest first, with its Gas Days, status, lines, outlet TJ, what the worker's checks found, AGIG's errors, when it was loaded and by whom, and when it was sent and answered. Filters: All, Needs attention, Waiting for AGIG, a Gas Day, a status. A row opens the batch.
- **A batch** (`/batch/?id=`): where it is in a sentence, who loaded and approved it and from which workbook snapshot, then its **lines**, each with its problems (AGIG's errors and the checks' findings, with a switch to show only the lines with one), the totals for each Gas Day, the timeline, the change from what AGIG held, AGIG's answers, and the SHNOM file to download.
- **AGIG responses** (`/responses/`): every answer, matched to its file and batch, with the attachment to download.
- **System and alerts** (`/system/`): the open alerts, worst first, with **I am on it** and **Clear** for the ops team; the files on their way (made and not sent, or with AGIG); the last file sent and the last answer; the alerts closed lately.
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

## A batch's life (as the worker writes it)

`IMPORTED` when loaded; `VALIDATED` or `VALIDATION_FAILED` after its checks (in `nom.ValidationIssue`); `APPROVED`; `BUILT` when its file is made; `UPLOADING`, then `UPLOADED`; then `ACCEPTED` or `REJECTED` from AGIG's answer (in `nom.InboundResponse`, with its error lines in `nom.ResponseError`), or `NO_RESPONSE` and `UPLOAD_UNCERTAIN` when the answer does not come or the file's fate is unknown. Side states: `DUPLICATE`, `SUPERSEDED`, `CANCELLED`. The app shows each in words (`server/app/statuses.js`).

## Known facts

- Runs as one component of the DigitalOcean App Platform app, from this repo. People sign in at the portal; an administrator adds the app and gives each person access in Admin Settings.
- Its database (`AGIG_NOMINATION_SQL_DATABASE`) is the nomination hub's: the design's twelve tables and two views in `ref`, `nom` and `ops` (`server/app/store/schema.js`, `docs/schema/agig-nomination.sql`). The app makes any that are missing, checks that the ones it finds have every column it reads, and seeds the spec's reference data into empty tables. It never alters or drops anything.
- It starts no background job and reaches nothing outside the portal and its database. Loading, checking, sending, the mailbox and the alerts are the worker's.
- `test/worker.js` stands in for the worker in the tests and the demo: it writes rows exactly as the worker will.

## Deliberate gaps

- **Nothing here makes or changes a nomination, a response or the reference data.** Every route only reads, except acknowledging and clearing an alert (`test/reference.test.js` pins it). Don't add one that does without asking.
- The app raises no alerts of its own; it shows the worker's. Its board colours are worked out each time a page asks, so they never wait for a job.

## Open questions

- The worker is still to be built (the design's Python worker). Until it is, the app shows only what is in the tables.
- For AGIG, from the design: does a later SHNOM file for a Gas Day replace all earlier lines, or only the lines it contains? The board's "AGIG holds" assumes line by line.
