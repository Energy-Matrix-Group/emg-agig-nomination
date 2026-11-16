import { actorOf, requireOperator } from './access.js';
import { httpError } from '../platform/kit.js';
import { acceptedLines, latestFiles } from './board.js';
import { formatMilli } from './quantity.js';
import { checkLines, countIssues } from './rules/check.js';
import { cleanLine, lineKey, MAX_LINES, shnomRow } from './rules/lines.js';
import { buildShnom, sha256, shnomFileName } from './shnom.js';
import { CANCELLABLE, IN_FLIGHT, PENDING, SET_ASIDE } from './statuses.js';
import { isGasDay, renominationCutoff } from './time.js';

// Publishing a nomination and the steps after it inside the app: approve, build the SHNOM file, cancel, send a
// duplicate anyway. This is the design's Publish macro, ingest job, usp_ValidateBatch, auto-approval and build
// job, in one place. Sending the file is delivery.js; AGIG's answer is responses.js.

// What the checks need: the reference data and the Spot awards for the Gas Days in the lines.
export async function checkContext(app, lines) {
  const days = lines.map((line) => line.gasDay).filter(isGasDay).sort();
  const [contracts, designations, spotAwards] = await Promise.all([
    app.store.listContracts(),
    app.store.listDesignations(),
    days.length ? app.store.listSpotAwards({ from: days[0], to: days.at(-1) }) : [],
  ]);
  return { contracts, designations, spotAwards, now: app.clock() };
}

export function readLinesFromBody(body) {
  if (!Array.isArray(body?.lines)) throw httpError(400, 'Send the lines as a list.');
  if (body.lines.length > MAX_LINES) throw httpError(400, `A batch can hold at most ${MAX_LINES} lines.`);
  return body.lines.map(cleanLine);
}

// The lines checked, for the live Check column. Changes nothing.
export async function checkOnly(app, body) {
  const lines = readLinesFromBody(body);
  const { rows, issues } = checkLines(lines, await checkContext(app, lines));
  return { rows: rows.map(publicLine), issues, summary: countIssues(issues) };
}

function publicLine(row) {
  const { found, quantityMilli, ...line } = row;
  return { ...line, quantityTJ: quantityMilli === null ? null : formatMilli(quantityMilli) };
}

const SOURCES = { grid: 'Entered in the app', paste: 'Pasted from Excel', file: 'Uploaded file' };

// Publish: check the lines; refuse on an error, and on a warning nobody has confirmed; make the batch with its rows
// and warnings in one write; set aside the batches it replaces; then approve and build it when auto-approval is
// on. Answers { status, body } so the route can send 422 or 409 with the issues.
export async function publish(app, user, body) {
  requireOperator(user);
  const lines = readLinesFromBody(body);
  const { rows, issues } = checkLines(lines, await checkContext(app, lines));
  const summary = countIssues(issues);
  if (summary.errors) return { status: 422, body: { error: 'Fix the errors before publishing.', issues, summary } };
  if (summary.warnings && body.confirmWarnings !== true) return { status: 409, body: { error: 'Check the warnings, then publish again to confirm.', issues, summary } };

  const now = app.clock();
  const stored = rows.map((row, at) => shnomRow(row, at + 2, formatMilli)); // CSV line 1 is the header
  const days = stored.map((row) => row.gasDay).sort();
  const gasDayFrom = days[0];
  const gasDayTo = days.at(-1);
  const kind = SOURCES[body.source?.kind] ? body.source.kind : 'grid';
  const name = typeof body.source?.name === 'string' ? body.source.name.trim().slice(0, 200) : '';
  const sourceFile = `${SOURCES[kind]}${name ? `: ${name}` : ''}`;
  const contentSha256 = sha256(JSON.stringify(stored.map((row) => [row.gasDay, fingerprint(row)]).sort()));
  const sourceSha256 = sha256(JSON.stringify({ stored, by: user.id, at: now.toISOString(), sourceFile }));

  const environment = app.settings.environment;
  const overlapping = await app.store.listBatches({ from: gasDayFrom, to: gasDayTo, environment, limit: 500 });
  // A batch waiting to be sent for any of these days is set aside, always: these lines are the newer numbers.
  const supersede = overlapping.filter((batch) => PENDING.includes(batch.status));
  // A duplicate is only what AGIG already holds, line for line, for every one of its days, and only while no
  // file for those days is with AGIG or of unknown fate (AGIG may then hold something else by the time it answers).
  const unsettled = overlapping.some((batch) => [...IN_FLIGHT, 'UPLOAD_UNCERTAIN', 'NO_RESPONSE'].includes(batch.status));
  const heldIn = unsettled ? null : await sameAsHeld(app, overlapping, stored);
  const duplicate = Boolean(heldIn);
  const replaces = overlapping.find((batch) => !['CANCELLED', 'DUPLICATE'].includes(batch.status)) ?? null;

  const batch = await app.store.createBatch({
    batch: {
      environment, status: duplicate ? 'DUPLICATE' : 'VALIDATED', gasDayFrom, gasDayTo, sourceFile, sourceSha256, contentSha256,
      supersedesBatchId: replaces?.id ?? null, createdBy: actorOf(user), validatedAt: now,
    },
    rows: stored,
    issues: issues.filter((issue) => issue.severity === 'Warning'),
    supersede: { ids: supersede.map((old) => old.id), from: PENDING, fileNote: 'Not sent: a newer batch replaced it.' },
  });
  await audit(app, user, 'batch.publish', batch.id, `${stored.length} lines for ${gasDayFrom}${gasDayTo !== gasDayFrom ? ` to ${gasDayTo}` : ''}`);

  const warnings = [];
  if (supersede.length) warnings.push(`Batch ${supersede.map((old) => old.id).join(', ')} had not been sent and is now superseded by this one.`);
  for (const old of supersede.filter((other) => other.gasDayFrom < gasDayFrom || other.gasDayTo > gasDayTo)) {
    warnings.push(`Batch ${old.id} also had lines for days this batch does not cover (it ran ${old.gasDayFrom} to ${old.gasDayTo}). Those lines are no longer waiting to be sent: publish them again if they must go.`);
  }
  if (duplicate) warnings.push(`These are the numbers AGIG already holds for these Gas Days (accepted in batch ${heldIn}), so nothing is sent. Use "Send anyway" if it must go again.`);
  else if (app.settings.autoApprove) warnings.push(...await approveAndBuild(app, user, batch.id, { automatic: true }));
  return { status: 201, body: { batch: await app.store.getBatch(batch.id), warnings } };
}

// Every field AGIG receives for a row, so a corrected service type or location is a change even when the
// quantities are the same.
function fingerprint(row) {
  return [row.shipper, row.pipeline, row.contract, row.nomType, row.marketer ?? '', row.serviceType ?? '', row.subServiceType ?? '',
    row.designation, row.designationLocation ?? '', row.quantityTJ].join('|');
}

// The id of the latest accepted batch when these rows are exactly what AGIG holds for each of their Gas Days
// (every line it holds, and no other), else null.
async function sameAsHeld(app, overlapping, stored) {
  const accepted = overlapping.filter((batch) => batch.status === 'ACCEPTED');
  if (!accepted.length) return null;
  const ids = accepted.map((batch) => batch.id);
  const [files, rows] = await Promise.all([app.store.listFiles({ batchIds: ids }), app.store.listRows(ids)]);
  const filesByBatch = latestFiles(files);
  const rowsByBatch = new Map();
  for (const row of rows) rowsByBatch.set(row.batchId, [...(rowsByBatch.get(row.batchId) ?? []), row]);
  for (const day of new Set(stored.map((row) => row.gasDay))) {
    const held = acceptedLines(accepted, filesByBatch, rowsByBatch, day);
    const mine = stored.filter((row) => row.gasDay === day);
    if (held.size !== mine.length) return null;
    for (const row of mine) {
      const theirs = held.get(lineKey(row));
      if (!theirs || fingerprint(theirs) !== fingerprint(row)) return null;
    }
  }
  return accepted[0].id;
}

// The batch published after this one for any of its Gas Days, if one counts (not cancelled, a duplicate or set
// aside). Its numbers are the newer ones, so this batch's file must never reach AGIG after it.
export async function newerBatch(app, batch) {
  const others = await app.store.listBatches({ from: batch.gasDayFrom, to: batch.gasDayTo, environment: batch.environment, limit: 500 });
  return others.find((other) => other.id > batch.id && !SET_ASIDE.includes(other.status)) ?? null;
}

// Approval, and the file right after it. With auto-approval on, publishing is the approval and the publisher is
// the approver (the design's auto_approve). With it off, an operator approves each batch on its page.
export async function approve(app, user, id) {
  requireOperator(user);
  const batch = await batchOr404(app, id);
  if (batch.status !== 'VALIDATED') throw httpError(409, `Batch ${id} is ${batch.status.toLowerCase()}, so it cannot be approved.`);
  await refuseIfTooLate(app, batch);
  const warnings = await approveAndBuild(app, user, id, { automatic: false });
  return { batch: await app.store.getBatch(id), warnings };
}

async function approveAndBuild(app, user, id, { automatic }) {
  const approved = await app.store.updateBatch(id, { status: 'APPROVED', approvedBy: actorOf(user), approvedAt: app.clock() }, { from: ['VALIDATED'] });
  if (!approved) return [];
  if (!automatic) await audit(app, user, 'batch.approve', id, null);
  return buildFile(app, id);
}

// The SHNOM file for an approved batch: its exact bytes and their SHA-256 are kept, so the record is exactly what
// was sent. Runs straight after approval, and from the background job for any approved batch still without one.
const building = new Set();

export async function buildFile(app, id) {
  if (!app.settings.participant) return ['The file cannot be made until NOM_PARTICIPANT (the participant name AGIG gave you) is set.'];
  if (building.has(id)) return [];
  building.add(id);
  try {
    const batch = await app.store.getBatch(id);
    if (batch?.status !== 'APPROVED') return [];
    const live = (await app.store.listFiles({ batchIds: [id] })).find((file) => file.status !== 'FAILED');
    if (!live) {
      const rows = await app.store.listRows([id]);
      const header = (await app.store.listFileTemplate()).map((column) => column.name);
      const body = buildShnom(rows, header);
      let when = app.clock();
      for (let attempt = 0; ; attempt += 1) {
        try {
          await app.store.createFile({ batchId: id, fileName: shnomFileName(app.settings.participant, when), body, sha256: sha256(body), status: 'BUILT' });
          break;
        } catch (error) {
          // A file name must be unique, and it carries the time to the second: take the next second.
          if (!error.duplicateFileName || attempt >= 10) throw error;
          when = new Date(when.getTime() + 1000);
        }
      }
    }
    await app.store.updateBatch(id, { status: 'BUILT' }, { from: ['APPROVED'] });
    return [];
  } finally {
    building.delete(id);
  }
}

// Approved batches that still have no file (the participant name was missing, or the app stopped half way).
export async function buildPending(app) {
  const waiting = await app.store.listBatches({ status: 'APPROVED', environment: app.settings.environment, limit: 50 });
  const settled = app.clock().getTime() - 30_000; // leave a batch approved a moment ago to the request approving it
  for (const batch of waiting) {
    if (!batch.approvedAt || new Date(batch.approvedAt).getTime() <= settled) await buildFile(app, batch.id);
  }
}

export async function cancel(app, user, id) {
  requireOperator(user);
  const batch = await batchOr404(app, id);
  if (!CANCELLABLE.includes(batch.status)) throw httpError(409, `Batch ${id} is ${batch.status.toLowerCase()}: only a batch that has not been sent can be cancelled.`);
  const files = (await app.store.listFiles({ batchIds: [id] })).filter((file) => file.status === 'BUILT');
  if (!await app.store.updateBatch(id, { status: 'CANCELLED' }, { from: CANCELLABLE })) throw httpError(409, `Batch ${id} changed just now. Look again.`);
  for (const file of files) await app.store.updateFile(file.id, { status: 'FAILED', lastError: `Not sent: cancelled by ${actorOf(user)}.` }, { from: ['BUILT'] });
  await audit(app, user, 'batch.cancel', id, null);
  return { batch: await app.store.getBatch(id) };
}

// A duplicate is not sent, because AGIG already has those numbers. "Send anyway" sends it all the same.
export async function sendAnyway(app, user, id) {
  requireOperator(user);
  const batch = await batchOr404(app, id);
  if (batch.status !== 'DUPLICATE') throw httpError(409, `Batch ${id} is not a duplicate.`);
  await refuseIfTooLate(app, batch);
  if (!await app.store.updateBatch(id, { status: 'VALIDATED' }, { from: ['DUPLICATE'] })) throw httpError(409, `Batch ${id} changed just now. Look again.`);
  await audit(app, user, 'batch.send-anyway', id, null);
  const warnings = await approveAndBuild(app, user, id, { automatic: false });
  return { batch: await app.store.getBatch(id), warnings };
}

// AGIG checks a file against the time it arrives, so an approval after the cutoff would only be rejected (502).
async function refuseIfTooLate(app, batch) {
  const rows = await app.store.listRows([batch.id]);
  const late = [...new Set(rows.map((row) => row.gasDay))].filter((day) => app.clock() > renominationCutoff(day));
  if (late.length) throw httpError(422, `Too late: the 20:00 cutoff has passed for ${late.join(', ')}. Publish the other days again on their own.`);
}

export async function batchOr404(app, id) {
  const batch = Number.isInteger(id) ? await app.store.getBatch(id) : null;
  if (!batch) throw httpError(404, 'There is no such batch.');
  return batch;
}

export async function audit(app, user, action, entityId, detail, entityType = 'Batch') {
  await app.store.addAudit({ action, entityType, entityId, detail, actor: actorOf(user) });
}

