import { quantityText } from '../quantity.js';
import { DESIGNATIONS, ERROR_CODES, FILE_TEMPLATE, PIPELINES } from '../reference/seed.js';

// The in-memory twin of the SQL store, with the same async interface (store/README.md lists it). Tests run on it,
// and so does a laptop with no SQL_SERVER. It copies what goes in and what comes out, so nobody can change a
// stored record by holding on to an object, exactly as a database behaves.

const copy = (value) => (value === undefined ? undefined : structuredClone(value));
const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
const overlaps = (batch, from, to) => (!from || batch.gasDayTo >= from) && (!to || batch.gasDayFrom <= to);

export function createMemoryStore({ clock = () => new Date() } = {}) {
  const ids = {};
  const nextId = (table) => (ids[table] = (ids[table] ?? 0) + 1);
  const now = () => clock().toISOString();

  const pipelines = PIPELINES.map(copy);
  const fileTemplate = FILE_TEMPLATE.map(copy);
  const errorCodes = ERROR_CODES.map(copy);
  const designations = DESIGNATIONS.map((designation) => ({ id: nextId('designation'), ...copy(designation) }));
  const contracts = [];
  const spotAwards = [];
  const batches = [];
  const rows = [];
  const issues = [];
  const files = [];
  const responses = [];
  const responseErrors = [];
  const alerts = [];
  const audit = [];

  const withoutBody = ({ body, ...file }) => copy(file);
  const findFile = (id) => files.find((file) => file.id === id);
  const findBatch = (id) => batches.find((batch) => batch.id === id);
  const applyPatch = (record, patch) => Object.assign(record, copy(Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, iso(value)]))));
  const guarded = (record, patch, from) => {
    if (!record) return false;
    if (from && !from.includes(record.status)) return false;
    applyPatch(record, patch);
    return true;
  };

  function insertResponseErrors(responseId, list) {
    for (const error of list) responseErrors.push({ id: nextId('responseError'), responseId, ...copy(error) });
  }

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
    async updateContract(id, patch) {
      const record = contracts.find((contract) => contract.id === id);
      if (!record) return null;
      applyPatch(record, patch);
      if ('capacityTJ' in patch) record.capacityTJ = quantityText(patch.capacityTJ);
      return copy(record);
    },
    async createDesignation(designation) {
      const record = { id: nextId('designation'), ...copy(designation) };
      designations.push(record);
      return copy(record);
    },
    async updateDesignation(id, patch) {
      const record = designations.find((designation) => designation.id === id);
      if (!record) return null;
      applyPatch(record, patch);
      return copy(record);
    },

    // Spot awards (one per Gas Day and Spot contract)
    async listSpotAwards({ from = null, to = null } = {}) {
      return spotAwards.filter((award) => (!from || award.gasDay >= from) && (!to || award.gasDay <= to))
        .sort((a, b) => a.gasDay.localeCompare(b.gasDay) || a.contractCode.localeCompare(b.contractCode)).map(copy);
    },
    async saveSpotAward({ gasDay, contractCode, awardedTJ, enteredBy }) {
      let record = spotAwards.find((award) => award.gasDay === gasDay && award.contractCode === contractCode);
      if (!record) {
        record = { id: nextId('spotAward'), gasDay, contractCode };
        spotAwards.push(record);
      }
      Object.assign(record, { awardedTJ: quantityText(awardedTJ), enteredBy, enteredAt: now() });
      return copy(record);
    },
    async deleteSpotAward(id) {
      const at = spotAwards.findIndex((award) => award.id === id);
      if (at < 0) return false;
      spotAwards.splice(at, 1);
      return true;
    },

    // Batches, their rows and the issues the checks found. One call writes them together, and sets aside the
    // batches it supersedes, so a half-made batch never exists.
    async createBatch({ batch, rows: newRows, issues: newIssues, supersede = null }) {
      const record = {
        id: nextId('batch'), supersedesBatchId: null, validatedAt: null, approvedBy: null, approvedAt: null,
        ...copy(batch), validatedAt: iso(batch.validatedAt), approvedAt: iso(batch.approvedAt), createdAt: now(),
      };
      batches.push(record);
      const rowIds = [];
      for (const row of newRows) {
        const id = nextId('row');
        rowIds.push(id);
        rows.push({ id, batchId: record.id, ...copy(row), quantityTJ: quantityText(row.quantityTJ) });
      }
      for (const issue of newIssues) {
        const batchRowId = issue.line === null || issue.line === undefined ? null : rowIds[issue.line] ?? null;
        issues.push({ id: nextId('issue'), batchId: record.id, batchRowId, rule: issue.rule, severity: issue.severity, message: issue.message, createdAt: now() });
      }
      for (const id of supersede?.ids ?? []) {
        const old = findBatch(id);
        if (!old || !supersede.from.includes(old.status)) continue;
        old.status = 'SUPERSEDED';
        for (const file of files.filter((candidate) => candidate.batchId === id && candidate.status === 'BUILT')) {
          file.status = 'FAILED';
          file.lastError = supersede.fileNote;
        }
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
    async listRows(batchIds) {
      return rows.filter((row) => batchIds.includes(row.batchId)).sort((a, b) => a.batchId - b.batchId || a.csvLineNumber - b.csvLineNumber).map(copy);
    },
    async listIssues(batchId) { return issues.filter((issue) => issue.batchId === batchId).map(copy); },
    async updateBatch(id, patch, { from = null } = {}) { return guarded(findBatch(id), patch, from); },

    // Outbound files: the exact bytes sent to AGIG
    async createFile(file) {
      if (files.some((existing) => existing.fileName === file.fileName)) throw Object.assign(new Error('duplicate file name'), { duplicateFileName: true });
      const record = {
        id: nextId('file'), attempts: 0, lastError: null, uploadedAt: null, remoteSize: null, respondedAt: null,
        ...copy(file), builtAt: now(),
      };
      files.push(record);
      return withoutBody(record);
    },
    async getFile(id, { body = false } = {}) {
      const file = findFile(id);
      if (!file) return null;
      return body ? { ...withoutBody(file), body: Buffer.from(file.body) } : withoutBody(file);
    },
    async findFileByName(fileName) {
      const file = files.find((candidate) => candidate.fileName === fileName);
      return file ? withoutBody(file) : null;
    },
    async listFiles({ status = null, batchIds = null } = {}) {
      return files.filter((file) => (!status || [].concat(status).includes(file.status)) && (!batchIds || batchIds.includes(file.batchId)))
        .sort((a, b) => a.id - b.id).map(withoutBody);
    },
    async updateFile(id, patch, { from = null } = {}) {
      const file = findFile(id);
      const next = { ...patch };
      if (next.attempts === '+1') next.attempts = (file?.attempts ?? 0) + 1;
      return guarded(file, next, from);
    },

    // AGIG's responses. Recording one, its error lines and the file's and batch's new status is one write.
    async findResponseByMessageId(messageId) { return copy(responses.find((response) => response.messageId === messageId)) ?? null; },
    async getResponse(id) { return copy(responses.find((response) => response.id === id)) ?? null; },
    async listResponses({ limit = 200, fileIds = null } = {}) {
      return responses.filter((response) => !fileIds || fileIds.includes(response.fileId)).sort((a, b) => b.id - a.id).slice(0, limit).map(copy);
    },
    async listResponseErrors(responseIds) { return responseErrors.filter((error) => responseIds.includes(error.responseId)).map(copy); },
    async recordResponse({ response, errors = [], file = null, batch = null }) {
      const record = { id: nextId('response'), fileId: null, ...copy(response), receivedAt: iso(response.receivedAt) };
      responses.push(record);
      insertResponseErrors(record.id, errors);
      if (file) applyPatch(findFile(file.id), file.patch);
      if (batch) applyPatch(findBatch(batch.id), batch.patch);
      return copy(record);
    },
    async linkResponse({ responseId, patch, errors = [], file = null, batch = null }) {
      const record = responses.find((response) => response.id === responseId);
      if (!record) return null;
      applyPatch(record, patch);
      insertResponseErrors(record.id, errors);
      if (file) applyPatch(findFile(file.id), file.patch);
      if (batch) applyPatch(findBatch(batch.id), batch.patch);
      return copy(record);
    },

    // Alerts. An alert that is still open (not cleared) for the same thing is not raised twice.
    async raiseAlert(alert) {
      const open = alerts.find((existing) => !existing.clearedAt && existing.type === alert.type
        && existing.entityType === (alert.entityType ?? null) && existing.entityId === (alert.entityId ?? null));
      if (open) return { alert: copy(open), created: false };
      const record = {
        id: nextId('alert'), entityType: null, entityId: null, ...copy(alert),
        raisedAt: now(), acknowledgedBy: null, acknowledgedAt: null, clearedAt: null,
      };
      alerts.push(record);
      return { alert: copy(record), created: true };
    },
    async listAlerts({ open = null, afterId = null, limit = 200 } = {}) {
      return alerts.filter((alert) => (open === null || !alert.clearedAt === open) && (afterId === null || alert.id > afterId))
        .sort((a, b) => b.id - a.id).slice(0, limit).map(copy);
    },
    async updateAlert(id, patch) {
      const record = alerts.find((alert) => alert.id === id);
      if (!record) return null;
      applyPatch(record, patch);
      return copy(record);
    },
    async clearAlerts({ type, entityType = null, entityId = null }) {
      let count = 0;
      for (const alert of alerts) {
        if (alert.clearedAt || alert.type !== type || alert.entityType !== entityType || alert.entityId !== entityId) continue;
        alert.clearedAt = now();
        count += 1;
      }
      return count;
    },

    // The audit trail: who changed what, for reference data and every action on a batch.
    async addAudit(entry) {
      const record = { id: nextId('audit'), entityId: null, detail: null, ...copy(entry), at: now() };
      audit.push(record);
      return copy(record);
    },
    async listAudit({ entityType = null, entityId = null, limit = 100 } = {}) {
      return audit.filter((entry) => (!entityType || entry.entityType === entityType) && (entityId === null || entry.entityId === entityId))
        .sort((a, b) => b.id - a.id).slice(0, limit).map(copy);
    },
  };
}
