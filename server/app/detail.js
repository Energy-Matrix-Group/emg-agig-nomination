import { acceptedLines, latestFiles, lineKey } from './board.js';
import { httpError } from '../platform/kit.js';
import { formatMilli, toMilli } from './quantity.js';
import { IN_FLIGHT, NEEDS_ATTENTION, PENDING, STATUS_LABELS } from './statuses.js';
import { readGasDay } from './time.js';

// What the pages show about batches, responses and the system. The app only reads what the design's worker
// wrote. Stored rows are never sent as they are: each goes through a function here, so the shape is the one
// API.md shows.

export function presentBatch(batch) {
  return { ...batch, statusLabel: STATUS_LABELS[batch.status] ?? batch.status };
}

export function presentFile(file) {
  if (!file) return null;
  const { body, ...rest } = file;
  return rest;
}

const groupBy = (list, key) => {
  const map = new Map();
  for (const item of list) map.set(item[key], [...(map.get(item[key]) ?? []), item]);
  return map;
};

// The Submissions list: every batch, newest first, with its lines, totals, issues, AGIG errors and file.
// `view=attention` keeps the ones that need someone (failed the checks, rejected, no answer, upload uncertain).
export async function listBatches(app, query) {
  const status = query.get('status');
  const view = query.get('view');
  const gasDay = query.get('gasDay') ? readGasDay(query.get('gasDay')) : null;
  if (query.get('gasDay') && !gasDay) throw httpError(400, 'gasDay must be a date, yyyy-mm-dd.');
  if (status && !STATUS_LABELS[status]) throw httpError(400, 'That is not a batch status.');
  const limit = Math.min(Math.max(Number.parseInt(query.get('limit') ?? '100', 10) || 100, 1), 500);
  const statuses = status ?? (view === 'attention' ? NEEDS_ATTENTION : view === 'waiting' ? [...PENDING, ...IN_FLIGHT] : null);
  const batches = await app.store.listBatches({ from: gasDay, to: gasDay, status: statuses, environment: app.settings.environment, limit });
  const ids = batches.map((batch) => batch.id);
  const [files, summaries] = await Promise.all([app.store.listFiles({ batchIds: ids }), app.store.batchSummaries(ids)]);
  const fileOf = latestFiles(files);
  const summaryOf = new Map(summaries.map((summary) => [summary.batchId, summary]));
  return {
    batches: batches.map((batch) => {
      const file = fileOf.get(batch.id) ?? null;
      const { batchId, ...summary } = summaryOf.get(batch.id) ?? { lines: 0, inletTJ: '0.000', outletTJ: '0.000', issueErrors: 0, issueWarnings: 0, agigErrors: 0 };
      return {
        ...presentBatch(batch),
        ...summary,
        file: file ? { id: file.id, fileName: file.fileName, status: file.status, builtAt: file.builtAt, uploadedAt: file.uploadedAt, respondedAt: file.respondedAt } : null,
      };
    }),
  };
}

// One batch in full: its rows first (with the worker's check findings and AGIG's errors on each), then the totals
// for each Gas Day, the timeline, the change from what AGIG held, the files and AGIG's answers.
export async function batchDetail(app, user, id) {
  const batch = Number.isInteger(id) ? await app.store.getBatch(id) : null;
  if (!batch) throw httpError(404, 'There is no such batch.');
  const [rows, issues, files, errorCodes] = await Promise.all([
    app.store.listRows([id]),
    app.store.listIssues(id),
    app.store.listFiles({ batchIds: [id] }),
    app.store.listErrorCodes(),
  ]);
  const responses = await app.store.listResponses({ fileIds: files.map((file) => file.id), limit: 50 });
  const responseErrors = await app.store.listResponseErrors(responses.map((response) => response.id));
  const codeText = new Map(errorCodes.map((code) => [code.code, code.message]));
  const decoded = (error) => ({ ...error, meaning: codeText.get(error.errorCode) ?? null });
  const errorsByRow = groupBy(responseErrors.filter((error) => error.batchRowId).map(decoded), 'batchRowId');
  const issuesByRow = groupBy(issues.filter((issue) => issue.batchRowId), 'batchRowId');
  const file = files.filter((candidate) => candidate.status !== 'FAILED').at(-1) ?? files.at(-1) ?? null;

  const days = [];
  for (const [gasDay, dayRows] of groupBy(rows, 'gasDay')) {
    const total = (type) => formatMilli(dayRows.filter((row) => row.nomType === type).reduce((sum, row) => sum + (toMilli(row.quantityTJ) ?? 0), 0));
    days.push({ gasDay, lines: dayRows.length, inletTJ: total('Inlet'), outletTJ: total('Outlet') });
  }
  days.sort((a, b) => a.gasDay.localeCompare(b.gasDay));

  return {
    batch: presentBatch(batch),
    rows: rows.map((row) => ({ ...row, agigErrors: errorsByRow.get(row.id) ?? [], issues: issuesByRow.get(row.id) ?? [] })),
    days,
    issues: issues.filter((issue) => !issue.batchRowId),
    file: presentFile(file),
    files: files.map(presentFile),
    responses: responses.map(({ rawCsv, ...response }) => ({ ...response, errors: responseErrors.filter((error) => error.responseId === response.id).map(decoded) })),
    unpinnedErrors: responseErrors.filter((error) => !error.batchRowId).map(decoded),
    timeline: [
      ['Loaded', batch.createdAt, batch.createdBy],
      ['Checked', batch.validatedAt, null],
      ['Approved', batch.approvedAt, batch.approvedBy],
      ['File made', file?.builtAt, null],
      ['Sent to AGIG', file?.uploadedAt, null],
      ['AGIG answered', file?.respondedAt, null],
    ].map(([step, at, by]) => ({ step, at: at ?? null, by })),
    changes: await changesFromAccepted(app, batch, rows),
    supersededBy: (await app.store.listBatches({ from: batch.gasDayFrom, to: batch.gasDayTo, environment: batch.environment, limit: 200 }))
      .filter((other) => other.supersedesBatchId === id).map((other) => other.id),
  };
}

// How this batch differs from what AGIG held before it, line by line: the design's "Change view".
async function changesFromAccepted(app, batch, rows) {
  const others = await app.store.listBatches({ from: batch.gasDayFrom, to: batch.gasDayTo, environment: batch.environment, limit: 500 });
  const earlier = others.filter((other) => other.id < batch.id);
  const ids = earlier.map((other) => other.id);
  const [files, otherRows] = await Promise.all([app.store.listFiles({ batchIds: ids }), app.store.listRows(ids)]);
  const filesByBatch = latestFiles(files);
  const rowsByBatch = groupBy(otherRows, 'batchId');
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
  const batchIds = [...new Set([...files.values()].filter(Boolean).map((file) => file.batchId))];
  const modelOf = new Map(batchIds.length ? (await app.store.listBatches({ ids: batchIds, limit: 1000 })).map((batch) => [batch.id, batch.modelId ?? null]) : []);
  return {
    responses: responses.map(({ rawCsv, ...response }) => {
      const batchId = files.get(response.fileId)?.batchId ?? null;
      return {
        ...response,
        batchId,
        modelId: batchId === null ? null : modelOf.get(batchId) ?? null,
        errorCount: errors.filter((error) => error.responseId === response.id).length,
      };
    }),
  };
}

// The System page: the open alerts, the ones closed lately, and where the files are.
export async function systemView(app) {
  const [open, closed, files] = await Promise.all([
    app.store.listAlerts({ open: true, limit: 200 }),
    app.store.listAlerts({ open: false, limit: 15 }),
    app.store.listFiles({ status: ['BUILT', 'UPLOADING', 'UPLOADED', 'UPLOAD_UNCERTAIN', 'RESPONDED', 'NO_RESPONSE'] }),
  ]);
  const batches = new Map((await app.store.listBatches({ ids: [...new Set(files.map((file) => file.batchId))], environment: app.settings.environment, limit: 1000 }))
    .map((batch) => [batch.id, batch]));
  const here = files.filter((file) => batches.has(file.batchId));
  const brief = (file) => ({ id: file.id, batchId: file.batchId, modelId: batches.get(file.batchId)?.modelId ?? null, fileName: file.fileName, status: file.status, builtAt: file.builtAt, uploadedAt: file.uploadedAt, respondedAt: file.respondedAt });
  const latest = (field) => here.filter((file) => file[field]).sort((a, b) => b[field].localeCompare(a[field]))[0] ?? null;
  return {
    environment: app.settings.environment,
    storage: app.databaseConnected === false ? 'memory-fallback' : app.store.kind,
    alerts: open,
    closedAlerts: closed,
    withAgig: here.filter((file) => ['UPLOADING', 'UPLOADED', 'UPLOAD_UNCERTAIN', 'NO_RESPONSE'].includes(file.status)).map(brief),
    waiting: here.filter((file) => file.status === 'BUILT').map(brief),
    lastSent: latest('uploadedAt') && brief(latest('uploadedAt')),
    lastAnswered: latest('respondedAt') && brief(latest('respondedAt')),
  };
}
