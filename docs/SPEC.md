# AGIG Nominations: spec

## Purpose

EMG ships gas on AGIG's pipelines (the DBNGP above all) and must nominate each Gas Day through AGIG's Transmission Business System (TBS), by uploading a SHNOM file to AGIG's SFTP. AGIG checks it against its rules and the cutoffs, and emails back Success or Failure. This app is where the ops team does all of that: enter the nominations, catch AGIG's errors before AGIG does, send the file, record AGIG's answer, and see at a glance whether every Gas Day is covered.

It implements the design "AGIG TBS B2B Nomination Integration – Solution Design" (2 October 2026) as an EMG app, so that nobody needs Power BI, SSMS or a separate Python worker. Excel stays the calculator: its numbers are pasted or uploaded here.

## Users

- **The ops team** (company role Ops Trader or Manager, and administrators): enter and publish nominations, enter Spot awards, send files, settle files with no answer, link responses, acknowledge alerts, keep the reference data.
- **Everyone else the portal lets in**: sees everything, changes nothing (`server/app/access.js`). The portal decides who may open the app at all.

## The rules (from the TBS B2B spec v3.0)

- **Cutoffs, in AWST (UTC+8 all year):** the initial nomination for Gas Day D by 14:00 on D-1; renominations until 20:00 on D; nothing more than 90 days ahead. AGIG checks the time its server receives the file. A line for D entered after 14:00 on D-1 is a renomination: allowed, with a warning to confirm.
- **The file:** `SHNOM_<ParticipantName>_<yyyymmddhhmmss>.csv` (AWST), AGIG's eleven columns with AGIG's exact header, dates `yyyy-mm-dd`, quantities with three decimals, CRLF, UTF-8 without a byte order mark. One file can carry several Gas Days. Spot nominations are extra outlet rows on the `<Shipper>_SPOT` contract with Service Type `SPOT`.
- **What people give for a line:** Gas Day, contract, designation (point) and quantity, and a note that is never sent. Shipper, Pipeline, Nom Type, Service Type, Sub Service Type and Designation Location come from the reference data, as the workbook's formulas did.
- **The checks** (`server/app/rules/check.js`), each mirroring the AGIG code it would cause: Gas Day missing or not a date (510); contract unknown, inactive or not covering the day (512); point unknown (504/506), on another pipeline or not current (505/507), a Spot contract on an inlet (505); outlet with no Service Type (519); quantity missing, not a number, negative or more than 3 decimals (503); a Marketer given (515); past the 20:00 cutoff (502); more than 90 days ahead (508); the same Gas Day, contract and point twice (DUP); outlets above the contracted capacity (522); Spot above the award (528, no award meaning zero); and as warnings, a renomination (RENOM) and outlets above inlets on a Transport contract (524). They run live as lines are entered and again on publish. A batch with an error is never made.
- **Left to AGIG**, as the design decided: whether a point is on the contract (505, 507), point minimums and limits (516, 518, 521), and whether every contracted point is present (527).

## A batch's life

Publish makes a batch, `VALIDATED`. With `NOM_AUTO_APPROVE` on (the default) publishing is the approval: it becomes `APPROVED` and its file is built at once (`BUILT`). Then the file is sent by hand or by the upload agent (`UPLOADED`; `UPLOADING` while the agent sends it), and AGIG's answer makes it `ACCEPTED` or `REJECTED`, with each error pinned to its line. No answer within `NOM_RESPONSE_TIMEOUT_MINUTES` makes it `NO_RESPONSE`; a failure part way through an upload makes it `UPLOAD_UNCERTAIN`. Neither is ever assumed accepted or sent again by itself: a person checks with AGIG or the TBS portal and settles it. A late answer still counts.

- **Old numbers never follow newer ones.** Publishing for days that have a batch waiting to be sent (validated, approved or built) always sets that batch aside (`SUPERSEDED`): its file can no longer be sent, and a waiting batch that also covered other days is named in the warning so those days can be published again. A file whose fate was unknown is not sent again once a newer batch covers any of its days, and the agent sets aside a file it could not send if a newer batch was published meanwhile. A rejected batch is never edited: the corrected lines are published again and the new batch records which one it replaces.
- **Duplicate:** a batch is not sent (`DUPLICATE`) only when, for every one of its Gas Days, its lines are exactly what AGIG holds (every field, every line, no more and no fewer), and no file for those days is with AGIG or of unknown fate. Send anyway sends it all the same.
- **Nothing goes after its cutoff:** the agent never takes a file whose first Gas Day's 20:00 cutoff has passed, and an alert asks for it to be cancelled. By hand it can still be recorded as uploaded (it may have gone in time), with a warning.
- **One file in flight:** AGIG processes files in the order they arrive, so the upload agent sends the next file only once the last has an answer; a file whose initial cutoff is within `NOM_CUTOFF_WARNING_MINUTES` goes ahead of older ones that can wait. By hand, the batch page says when another file is still waiting.
- **Nothing goes twice:** while the upload agent is at work (it has asked for work in the last 10 minutes), a built file is the agent's to send, and Mark as uploaded is refused for it. Each claim of a file gets its own 10 minutes to report back before the file is taken as uncertain.
- **AGIG's answer outranks a guess:** a batch settled by hand takes AGIG's first real answer when it comes, with an alert if they disagree. A second real answer for a file is kept and changes nothing.
- **Cancel** is for a batch not yet sent.

## Gas Day board

One card per Gas Day from D-1 to D+7 (`server/app/board.js`):

| Colour | Meaning |
| --- | --- |
| green | The latest numbers published are the ones AGIG accepted (or AGIG holds lines for the day and nothing newer is waiting) |
| blue | A file is with AGIG, waiting for its answer |
| amber | Published numbers not sent yet, or the initial cutoff is within the warning with nothing accepted |
| red | The latest file was rejected, had no answer or may not have arrived; or the 20:00 cutoff passed with nothing accepted |
| grey | No active contract that day, or more than 90 days out |
| none | Nothing sent yet, with time to spare |

What AGIG *holds* for a day is worked out line by line: for each contract, Nom Type, point, marketer and service type, the value in the latest accepted file that carried it (the design's `nom.vAcceptedNomination` rule).

## Alerts

Raised once while open, shown on the System page and the board, and posted to Teams when `NOM_TEAMS_WEBHOOK_URL` is set (`server/app/watchdog.js`, `teams.js`): a rejection (with 501 and reference-data hints), no answer in time, an uncertain or repeatedly failing upload, nothing accepted for D at `NOM_INITIAL_ALERT_TIME` (13:00) on D-1 or near today's 20:00, newer numbers not sent near a cutoff, the SFTP key expiring (45, 14, 3 days), the mailbox failing three times running, a quiet upload agent, and a response that could not be read or matched.

## Known facts

- Runs as one component of the DigitalOcean App Platform app, from this repo. People sign in at the portal; an administrator gives each person access.
- Data lives in this app's own SQL database: the design's `ref`, `nom` and `ops` schemas and tables (`server/app/store/schema.js`, `docs/schema/agig-nomination.sql`), plus `nom.SpotAward` and `ops.AuditLog`. It never reads another app's database.
- The app never connects to AGIG's SFTP: AGIG only accepts the office's registered IP, and its key stays on the office VM. Files go by hand (WinSCP) or by the upload agent (`scripts/agent/`).
- AGIG's answers are read from a shared mailbox with Microsoft Graph over `fetch` (no SDK), only on a real database, or uploaded by hand.
- Every change to reference data, Spot awards, a batch or a response link is in `ops.AuditLog`, with who made it.

## What changed from the design, and why

| Design | Here | Why |
| --- | --- | --- |
| Excel `B2B_Export` with a Check column, `Spot_Award` tab, ref tabs and macros | The New nomination page (paste, CSV, type), the Spot awards page, reference data read live | One set of rules instead of two; nothing to keep in step on each laptop |
| Publish macro saves a snapshot to `F:\AGIG SFTP TEST`; a worker ingests it | Publish in the browser; the batch is made in one transaction | No shared folder or file polling; every batch still records its source and who published it |
| `usp_ValidateBatch` in SQL | `rules/check.js`, run live and on publish | The same rules work on the memory store in tests and on SQL; errors are seen before publishing |
| Python worker: build, SFTP, mailbox, watchdog | The app's background jobs; SFTP by hand or by the upload agent on the VM | The app runs on DigitalOcean, which AGIG has not whitelisted, and the template allows no new dependency (an SFTP library) without Mat's approval |
| Spot awards and contract-point pairs not in SQL | Spot awards in `nom.SpotAward`; pairs still left to the ops team and AGIG (505/507) | The workbook tab is gone, so the awards need a home; the pairing decision is the design's |
| Power BI report and SSMS procedures | The board, Submissions, batch, responses, system and reference pages, with their buttons | The point of this app |
| `nomhub.yaml` | `NOM_*` settings | The template's settings, in DigitalOcean |

## Deliberate gaps

- A batch with an error is never made, so `IMPORTED` and `VALIDATION_FAILED` are never written (the table allows them).
- Contract-to-point pairing, point limits and missing points are not checked here (AGIG reports them).
- The upload agent's PowerShell script is not run by the tests (they run on Linux); its two routes are.
- Draft lines are kept in the person's browser until published, not on the server.
- Contract and point codes are unique without regard to case, as SQL Server compares them.

## Open questions (for AGIG, from the design)

- Does a later SHNOM file for a Gas Day replace all earlier lines, or only the lines it contains? (Decides whether every file must carry the full day; the board's "AGIG holds" assumes line by line.)
- Can one file cover several Gas Days, and does one bad row reject the whole file?
- The remote folder; whether processed files are removed; whether files may be uploaded as `.tmp` and renamed.
- The normal turnaround of the response email, and its sender address (`NOM_RESPONSE_TIMEOUT_MINUTES`, `NOM_MAIL_AGIG_SENDER`).
- Line numbering in the response (is the header line 1? the app assumes so).
- CSV encoding and line endings (the app sends UTF-8 without BOM, CRLF).
- The SSH key type, and the exact participant name.
- The TNP inlet code printed as `TNP 01-01`, and codes 100, 115 and 120 seen in AGIG's examples but not in Appendix J.
