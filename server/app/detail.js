import { canOperate } from './access.js';
import { acceptedLines, latestFiles } from './board.js';
import { httpError } from '../platform/kit.js';
import { formatMilli, toMilli } from './quantity.js';
import { lineKey } from './rules/lines.js';
import { CANCELLABLE, STATUS_LABELS } from './statuses.js';
import { readGasDay } from './time.js';

// What the pages show about batches and responses: the submissions list, one batch in full, and the responses.
// Stored rows are never sent as they are: each goes through a function here, so the shape is the one API.md shows.

export function presentBatch(batch) {
  return { ...batch, statusLabel: STATUS_LABELS[batch.status] ?? batch.status };
}

export function presentFile(file) {
  if (!file) return null;
  const { body, ...rest } = file;
  return rest;
}

export async function listBatches(app, query) {
  const status = query.get('status');
  const gasDay = query.get('gasDay') ? readGasDay(query.get('gasDay')) : null;
  if (query.get('gasDay') && !gasDay) throw httpError(400, 'gasDay must be a date, yyyy-mm-dd.');
  if (status && !STATUS_LABELS[status]) throw httpError(400, 'That is not a batch status.');
  const limit = Math.min(Math.max(Number.parseInt(query.get('limit') ?? '100', 10) || 100, 1), 500);
  const batches = await app.store.listBatches({ from: gasDay, to: gasDay, status, environment: app.settings.environment, limit });
  const files = latestFiles(await app.store.listFiles({ batchIds: batches.map((batch) => batch.id) }));
  return {
    batches: batches.map((batch) => {
      const file = files.get(batch.id) ?? null;
      return { ...presentBatch(batch), file: file ? { id: file.id, fileName: file.fileName, status: file.status, builtAt: file.builtAt, uploadedAt: file.uploadedAt, respondedAt: file.respondedAt } : null };
    }),
  };
}

export async function batchDetail(app, user, id) {
  const batch = Number.isInteger(id) ? await app.store.getBatch(id) : null;
  if (!batch) throw httpError(404, 'There is no such batch.');
  const [rows, issues, files, errorCodes, audit] = await Promise.all([
    app.store.listRows([id]),
    app.store.listIssues(id),
    app.store.listFiles({ batchIds: [id] }),
    app.store.listErrorCodes(),
    app.store.listAudit({ entityType: 'Batch', entityId: id, limit: 50 }),
  ]);
  const responses = await app.store.listResponses({ fileIds: files.map((file) => file.id), limit: 50 });
  const responseErrors = await app.store.listResponseErrors(responses.map((response) => response.id));
  const codeText = new Map(errorCodes.map((code) => [code.code, code.message]));
  const decoded = (error) => ({ ...error, meaning: codeText.get(error.errorCode) ?? null });
  const errorsByRow = new Map();
  for (const error of responseErrors) {
    if (error.batchRowId) errorsByRow.set(error.batchRowId, [...(errorsByRow.get(error.batchRowId) ?? []), decoded(error)]);
  }
  const issuesByRow = new Map();
  for (const issue of issues) {
    if (issue.batchRowId) issuesByRow.set(issue.batchRowId, [...(issuesByRow.get(issue.batchRowId) ?? []), issue]);
  }
  const file = files.filter((candidate) => candidate.status !== 'FAILED').at(-1) ?? files.at(-1) ?? null;
  const manualUpload = file && ['BUILT', 'UPLOAD_UNCERTAIN'].includes(file.status);
  const operator = canOperate(user);

  return {
    batch: presentBatch(batch),
    rows: rows.map((row) => ({ ...row, agigErrors: errorsByRow.get(row.id) ?? [], issues: issuesByRow.get(row.id) ?? [] })),
    issues: issues.filter((issue) => !issue.batchRowId),
    file: presentFile(file),
    files: files.map(presentFile),
    responses: responses.map((response) => {
      const { rawCsv, ...rest } = response;
      return { ...rest, errors: responseErrors.filter((error) => error.responseId === response.id).map(decoded) };
    }),
    unpinnedErrors: responseErrors.filter((error) => !error.batchRowId).map(decoded),
    timeline: [
      ['Published', batch.createdAt, batch.createdBy],
      ['Checked', batch.validatedAt, null],
      ['Approved', batch.approvedAt, batch.approvedBy],
      ['File made', file?.builtAt, null],
      ['Sent to AGIG', file?.uploadedAt, null],
      ['AGIG answered', file?.respondedAt, null],
    ].map(([step, at, by]) => ({ step, at: at ?? null, by })),
    changes: await changesFromAccepted(app, batch, rows),
    supersededBy: (await app.store.listBatches({ from: batch.gasDayFrom, to: batch.gasDayTo, environment: batch.environment, limit: 200 }))
      .filter((other) => other.supersedesBatchId === id).map((other) => other.id),
    audit,
    actions: {
      approve: operator && batch.status === 'VALIDATED',
      cancel: operator && CANCELLABLE.includes(batch.status),
      sendAnyway: operator && batch.status === 'DUPLICATE',
      markUploaded: operator && Boolean(manualUpload) && ['BUILT', 'UPLOAD_UNCERTAIN'].includes(batch.status),
      resolve: operator && ['NO_RESPONSE', 'UPLOAD_UNCERTAIN'].includes(batch.status),
      download: Boolean(file),
    },
  };
}

// How this batch differs from what AGIG held before it, line by line: the design's "Change view".
async function changesFromAccepted(app, batch, rows) {
  const others = await app.store.listBatches({ from: batch.gasDayFrom, to: batch.gasDayTo, environment: batch.environment, limit: 500 });
  const earlier = others.filter((other) => other.id < batch.id);
  const ids = earlier.map((other) => other.id);
  const [files, otherRows] = await Promise.all([app.store.listFiles({ batchIds: ids }), app.store.listRows(ids)]);
  const filesByBatch = latestFiles(files);
  const rowsByBatch = new Map();
  for (const row of otherRows) rowsByBatch.set(row.batchId, [...(rowsByBatch.get(row.batchId) ?? []), row]);
  const changes = [];
  for (const day of [...new Set(rows.map((row) => row.gasDay))].sort()) {
    const before = acceptedLines(earlier, filesByBatch, rowsByBatch, day);
    const after = new Map(rows.filter((row) => row.gasDay === day).map((row) => [lineKey(row), row]));
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const was = before.get(key);
      const now = after.get(key);
      const wasMilli = was ? toMilli(was.quantityTJ) : null;
      const nowMilli = now ? toMilli(now.quantityTJ) : null;
      if (wasMilli === nowMilli) continue;
      const row = now ?? was;
      changes.push({
        gasDay: day, contract: row.contract, nomType: row.nomType, designation: row.designation,
        before: wasMilli === null ? null : formatMilli(wasMilli),
        after: nowMilli === null ? null : formatMilli(nowMilli),
        change: formatMilli((nowMilli ?? 0) - (wasMilli ?? 0)),
      });
    }
  }
  return changes;
}

export async function listResponses(app) {
  const responses = await app.store.listResponses({ limit: 200 });
  const errors = await app.store.listResponseErrors(responses.map((response) => response.id));
  const files = new Map();
  for (const response of responses) {
    if (response.fileId && !files.has(response.fileId)) files.set(response.fileId, await app.store.getFile(response.fileId));
  }
  return {
    responses: responses.map(({ rawCsv, ...response }) => ({
      ...response,
      batchId: files.get(response.fileId)?.batchId ?? null,
      errorCount: errors.filter((error) => error.responseId === response.id).length,
    })),
  };
}
