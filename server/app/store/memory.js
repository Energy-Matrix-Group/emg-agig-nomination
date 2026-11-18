import { formatMilli, quantityText, toMilli } from '../quantity.js';
import { DESIGNATIONS, ERROR_CODES, FILE_TEMPLATE, PIPELINES } from '../reference/seed.js';

// The in-memory twin of the SQL store, with the same async interface. Tests run on it, and so does a laptop with
// no SQL_SERVER (npm run demo). It copies what goes in and what comes out, so nobody can change a stored record by
// holding on to an object, exactly as a database behaves.
//
// The app only reads, and writes nothing but an alert being acknowledged or cleared. The other writes here
// (contracts, batches, files, responses, alerts) are what the design's worker does: the tests and the demo use
// them to stand in for it (test/worker.js).

const copy = (value) => (value === undefined ? undefined : structuredClone(value));
const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
const overlaps = (batch, from, to) => (!from || batch.gasDayTo >= from) && (!to || batch.gasDayFrom <= to);
const isoFields = (record) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, iso(value)]));

export function createMemoryStore({ clock = () => new Date() } = {}) {
  const ids = {};
  const nextId = (table) => (ids[table] = (ids[table] ?? 0) + 1);
  const now = () => clock().toISOString();

  const pipelines = PIPELINES.map(copy);
  const fileTemplate = FILE_TEMPLATE.map(copy);
  const errorCodes = ERROR_CODES.map(copy);
  const designations = DESIGNATIONS.map((designation) => ({ id: nextId('designation'), ...copy(designation) }));
  const contracts = [];
  const batches = [];
  const rows = [];
  const issues = [];
  const files = [];
  const responses = [];
  const responseErrors = [];
  const alerts = [];

  const withoutBody = ({ body, ...file }) => copy(file);
  const findBatch = (id) => batches.find((batch) => batch.id === id);
  const findFile = (id) => files.find((file) => file.id === id);
  const applyPatch = (record, patch) => record && Object.assign(record, copy(isoFields(patch)));
  const guarded = (record, patch, from) => {
    if (!record || (from && !from.includes(record.status))) return false;
    applyPatch(record, patch);
    return true;
  };

  return {
    kind: 'memory',

    // Reference data
    async listPipelines() { return pipelines.map(copy); },
    async listFileTemplate() { return fileTemplate.map(copy); },
    async listErrorCodes() { return errorCodes.map(copy); },
    async listDesignations() { return designations.map(copy); },
    async listContracts() { return contracts.map(copy); },
    async createContract(contract) {
      const record = { id: nextId('contract'), ...copy(contract), capacityTJ: quantityText(contract.capacityTJ) };
      contracts.push(record);
      return copy(record);
    },

    // Batches, their rows and the issues the worker's checks found
    async createBatch({ batch, rows: newRows, issues: newIssues = [] }) {
      const record = {
        id: nextId('batch'), supersedesBatchId: null, validatedAt: null, approvedBy: null, approvedAt: null, modelId: null,
        ...copy(isoFields(batch)), createdAt: iso(batch.createdAt) ?? now(),
      };
      batches.push(record);
      const rowIds = [];
      for (const row of newRows) {
        const id = nextId('row');
        rowIds.push(id);
        rows.push({ id, batchId: record.id, note: null, ...copy(row), quantityTJ: quantityText(row.quantityTJ) });
      }
      for (const issue of newIssues) {
        const batchRowId = issue.line === null || issue.line === undefined ? null : rowIds[issue.line] ?? null;
        issues.push({ id: nextId('issue'), batchId: record.id, batchRowId, rule: issue.rule, severity: issue.severity, message: issue.message, createdAt: now() });
      }
      return copy(record);
    },
    async getBatch(id) { return copy(findBatch(id)) ?? null; },
    async listBatches({ from = null, to = null, status = null, environment = null, limit = 200, ids = null } = {}) {
      return batches
        .filter((batch) => overlaps(batch, from, to) && (!status || [].concat(status).includes(batch.status))
          && (!environment || batch.environment === environment) && (!ids || ids.includes(batch.id)))
        .sort((a, b) => b.id - a.id).slice(0, limit).map(copy);
    },
    // For each batch: its lines, inlet and outlet totals, the issues the checks found, and AGIG's error lines.
    async batchSummaries(batchIds) {
      return batchIds.map((batchId) => {
        const mine = rows.filter((row) => row.batchId === batchId);
        const total = (type) => formatMilli(mine.filter((row) => row.nomType === type).reduce((sum, row) => sum + (toMilli(row.quantityTJ) ?? 0), 0));
        const fileIds = files.filter((file) => file.batchId === batchId).map((file) => file.id);
        const responseIds = responses.filter((response) => fileIds.includes(response.fileId)).map((response) => response.id);
        const found = issues.filter((issue) => issue.batchId === batchId);
        return {
          batchId,
          lines: mine.length,
          inletTJ: total('Inlet'),
          outletTJ: total('Outlet'),
          issueErrors: found.filter((issue) => issue.severity === 'Error').length,
          issueWarnings: found.filter((issue) => issue.severity === 'Warning').length,
          agigErrors: responseErrors.filter((error) => responseIds.includes(error.responseId)).length,
        };
      });
    },
    async listRows(batchIds) {
      return rows.filter((row) => batchIds.includes(row.batchId)).sort((a, b) => a.batchId - b.batchId || a.csvLineNumber - b.csvLineNumber).map(copy);
    },
    async listIssues(batchId) { return issues.filter((issue) => issue.batchId === batchId).map(copy); },
    async updateBatch(id, patch, { from = null } = {}) { return guarded(findBatch(id), patch, from); },

    // Outbound files: the exact bytes sent to AGIG
    async createFile(file) {
      const record = { id: nextId('file'), attempts: 0, lastError: null, uploadedAt: null, remoteSize: null, respondedAt: null, ...copy(isoFields(file)), builtAt: iso(file.builtAt) ?? now() };
      files.push(record);
      return withoutBody(record);
    },
    async getFile(id, { body = false } = {}) {
      const file = findFile(id);
      if (!file) return null;
      return body ? { ...withoutBody(file), body: Buffer.from(file.body) } : withoutBody(file);
    },
    async listFiles({ status = null, batchIds = null } = {}) {
      return files.filter((file) => (!status || [].concat(status).includes(file.status)) && (!batchIds || batchIds.includes(file.batchId)))
        .sort((a, b) => a.id - b.id).map(withoutBody);
    },
    async updateFile(id, patch, { from = null } = {}) { return guarded(findFile(id), patch, from); },

    // AGIG's responses, recorded with their error lines and the file's and batch's new status in one write
    async getResponse(id) { return copy(responses.find((response) => response.id === id)) ?? null; },
    async listResponses({ limit = 200, fileIds = null } = {}) {
      return responses.filter((response) => !fileIds || fileIds.includes(response.fileId)).sort((a, b) => b.id - a.id).slice(0, limit).map(copy);
    },
    async listResponseErrors(responseIds) { return responseErrors.filter((error) => responseIds.includes(error.responseId)).map(copy); },
    async recordResponse({ response, errors = [], file = null, batch = null }) {
      const record = { id: nextId('response'), fileId: null, ...copy(isoFields(response)) };
      responses.push(record);
      for (const error of errors) responseErrors.push({ id: nextId('responseError'), responseId: record.id, batchRowId: null, ...copy(error) });
      if (file) applyPatch(findFile(file.id), file.patch);
      if (batch) applyPatch(findBatch(batch.id), batch.patch);
      return copy(record);
    },

    // Alerts: raised by the worker; acknowledged and cleared here
    async raiseAlert(alert) {
      const record = { id: nextId('alert'), entityType: null, entityId: null, ...copy(alert), raisedAt: iso(alert.raisedAt) ?? now(), acknowledgedBy: null, acknowledgedAt: null, clearedAt: null };
      alerts.push(record);
      return copy(record);
    },
    async listAlerts({ open = null, limit = 200 } = {}) {
      return alerts.filter((alert) => open === null || !alert.clearedAt === open).sort((a, b) => b.id - a.id).slice(0, limit).map(copy);
    },
    async updateAlert(id, patch) {
      const record = alerts.find((alert) => alert.id === id);
      if (!record) return null;
      applyPatch(record, patch);
      return copy(record);
    },
  };
}
