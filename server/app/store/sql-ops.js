import { BATCH_COLUMNS, FILE_COLUMNS, guardedUpdate } from './sql-batches.js';
import { inList, inTransaction, query, setClause, sql, timeIn, timeOut } from './sql-kit.js';

// AGIG's responses (nom.InboundResponse, nom.ResponseError), alerts (ops.Alert) and the audit trail (ops.AuditLog).

const mapResponse = (row) => ({
  id: row.ResponseId,
  messageId: row.GraphMessageId,
  receivedAt: timeOut(row.ReceivedAtUtc),
  sender: row.Sender,
  subject: row.Subject,
  attachmentName: row.AttachmentName,
  rawCsv: row.RawCsv,
  parsedFileName: row.ParsedFileName,
  parsedStatus: row.ParsedStatus,
  responseTimestamp: row.ResponseTimestamp,
  fileId: row.FileId ?? null,
  matchState: row.MatchState,
});

const mapError = (row) => ({
  id: row.ResponseErrorId,
  responseId: row.ResponseId,
  lineNumber: row.LineNumber,
  errorCode: row.ErrorCode,
  errorDescription: row.ErrorDescription,
  batchRowId: row.BatchRowId ?? null,
});

const mapAlert = (row) => ({
  id: row.AlertId,
  type: row.AlertType,
  severity: row.Severity,
  message: row.Message,
  entityType: row.RelatedEntityType ?? null,
  entityId: row.RelatedEntityId ?? null,
  raisedAt: timeOut(row.RaisedAtUtc),
  acknowledgedBy: row.AcknowledgedBy ?? null,
  acknowledgedAt: timeOut(row.AcknowledgedAtUtc),
  clearedAt: timeOut(row.ClearedAtUtc),
});

const mapAudit = (row) => ({
  id: row.AuditLogId,
  action: row.Action,
  entityType: row.EntityType,
  entityId: row.EntityId ?? null,
  detail: row.Detail,
  actor: row.ActorEmail,
  at: timeOut(row.AtUtc),
});

const RESPONSE_COLUMNS = {
  parsedFileName: ['ParsedFileName', sql.VarChar(120)],
  parsedStatus: ['ParsedStatus', sql.VarChar(10)],
  fileId: ['FileId', sql.Int],
  matchState: ['MatchState', sql.VarChar(12)],
};

const ALERT_COLUMNS = {
  acknowledgedBy: ['AcknowledgedBy', sql.NVarChar(100)],
  acknowledgedAt: ['AcknowledgedAtUtc', sql.DateTime2(0), timeIn],
  clearedAt: ['ClearedAtUtc', sql.DateTime2(0), timeIn],
};

export function opsStore(pool, s) {
  async function insertErrors(tx, responseId, errors) {
    for (const error of errors) {
      await query(tx, `INSERT ${s.nom}.ResponseError (ResponseId, LineNumber, ErrorCode, ErrorDescription, BatchRowId)
        VALUES (@responseId, @line, @code, @description, @rowId)`, {
        responseId: [sql.Int, responseId], line: [sql.Int, error.lineNumber], code: [sql.VarChar(5), error.errorCode],
        description: [sql.NVarChar(300), error.errorDescription ?? null], rowId: [sql.Int, error.batchRowId ?? null],
      });
    }
  }

  async function applyStatus(tx, file, batch) {
    if (file) await guardedUpdate(tx, `${s.nom}.OutboundFile`, 'FileId', file.id, file.patch, FILE_COLUMNS, null);
    if (batch) await guardedUpdate(tx, `${s.nom}.Batch`, 'BatchId', batch.id, batch.patch, BATCH_COLUMNS, null);
  }

  return {
    async findResponseByMessageId(messageId) {
      const result = await query(pool, `SELECT * FROM ${s.nom}.InboundResponse WHERE GraphMessageId = @id`, { id: [sql.VarChar(200), messageId] });
      return result.recordset[0] ? mapResponse(result.recordset[0]) : null;
    },
    async getResponse(id) {
      const result = await query(pool, `SELECT * FROM ${s.nom}.InboundResponse WHERE ResponseId = @id`, { id: [sql.Int, id] });
      return result.recordset[0] ? mapResponse(result.recordset[0]) : null;
    },
    async listResponses({ limit = 200, fileIds = null } = {}) {
      if (fileIds && !fileIds.length) return [];
      const ids = fileIds ? inList('file', sql.Int, fileIds) : null;
      const result = await query(pool, `SELECT TOP (@limit) * FROM ${s.nom}.InboundResponse
        ${ids ? `WHERE FileId IN (${ids.text})` : ''} ORDER BY ResponseId DESC`, { limit: [sql.Int, limit], ...(ids?.params ?? {}) });
      return result.recordset.map(mapResponse);
    },
    async listResponseErrors(responseIds) {
      if (!responseIds.length) return [];
      const ids = inList('id', sql.Int, responseIds);
      const result = await query(pool, `SELECT * FROM ${s.nom}.ResponseError WHERE ResponseId IN (${ids.text}) ORDER BY ResponseErrorId`, ids.params);
      return result.recordset.map(mapError);
    },
    async recordResponse({ response, errors = [], file = null, batch = null }) {
      return inTransaction(pool, async (tx) => {
        const result = await query(tx, `INSERT ${s.nom}.InboundResponse (GraphMessageId, ReceivedAtUtc, Sender, Subject, AttachmentName, RawCsv,
            ParsedFileName, ParsedStatus, ResponseTimestamp, FileId, MatchState)
          OUTPUT inserted.*
          VALUES (@messageId, @receivedAt, @sender, @subject, @attachmentName, @rawCsv, @parsedFileName, @parsedStatus, @responseTimestamp, @fileId, @matchState)`, {
          messageId: [sql.VarChar(200), response.messageId],
          receivedAt: [sql.DateTime2(0), timeIn(response.receivedAt)],
          sender: [sql.VarChar(200), response.sender ?? null],
          subject: [sql.NVarChar(300), response.subject],
          attachmentName: [sql.NVarChar(200), response.attachmentName ?? null],
          rawCsv: [sql.NVarChar(sql.MAX), response.rawCsv ?? null],
          parsedFileName: [sql.VarChar(120), response.parsedFileName ?? null],
          parsedStatus: [sql.VarChar(10), response.parsedStatus ?? null],
          responseTimestamp: [sql.VarChar(14), response.responseTimestamp ?? null],
          fileId: [sql.Int, response.fileId ?? null],
          matchState: [sql.VarChar(12), response.matchState],
        });
        const record = mapResponse(result.recordset[0]);
        await insertErrors(tx, record.id, errors);
        await applyStatus(tx, file, batch);
        return record;
      });
    },
    async linkResponse({ responseId, patch, errors = [], file = null, batch = null }) {
      return inTransaction(pool, async (tx) => {
        const set = setClause(patch, RESPONSE_COLUMNS);
        const result = await query(tx, `UPDATE ${s.nom}.InboundResponse SET ${set.text} OUTPUT inserted.* WHERE ResponseId = @id`, {
          ...set.params, id: [sql.Int, responseId],
        });
        if (!result.recordset[0]) return null;
        await insertErrors(tx, responseId, errors);
        await applyStatus(tx, file, batch);
        return mapResponse(result.recordset[0]);
      });
    },

    async raiseAlert(alert) {
      const params = {
        type: [sql.VarChar(40), alert.type], severity: [sql.VarChar(8), alert.severity], message: [sql.NVarChar(1000), alert.message.slice(0, 1000)],
        entityType: [sql.VarChar(20), alert.entityType ?? null], entityId: [sql.Int, alert.entityId ?? null],
      };
      return inTransaction(pool, async (tx) => {
        const open = await query(tx, `SELECT TOP 1 * FROM ${s.ops}.Alert WITH (UPDLOCK, HOLDLOCK)
          WHERE ClearedAtUtc IS NULL AND AlertType = @type
            AND ((@entityType IS NULL AND RelatedEntityType IS NULL) OR RelatedEntityType = @entityType)
            AND ((@entityId IS NULL AND RelatedEntityId IS NULL) OR RelatedEntityId = @entityId)`, params);
        if (open.recordset[0]) return { alert: mapAlert(open.recordset[0]), created: false };
        const created = await query(tx, `INSERT ${s.ops}.Alert (AlertType, Severity, Message, RelatedEntityType, RelatedEntityId)
          OUTPUT inserted.* VALUES (@type, @severity, @message, @entityType, @entityId)`, params);
        return { alert: mapAlert(created.recordset[0]), created: true };
      });
    },
    async listAlerts({ open = null, afterId = null, limit = 200, oldestFirst = false } = {}) {
      const result = await query(pool, `SELECT TOP (@limit) * FROM ${s.ops}.Alert
        WHERE (@open IS NULL OR (@open = 1 AND ClearedAtUtc IS NULL) OR (@open = 0 AND ClearedAtUtc IS NOT NULL))
          AND (@afterId IS NULL OR AlertId > @afterId)
        ORDER BY AlertId ${oldestFirst ? 'ASC' : 'DESC'}`, {
        limit: [sql.Int, limit], open: [sql.Bit, open === null ? null : open], afterId: [sql.Int, afterId],
      });
      return result.recordset.map(mapAlert);
    },
    async updateAlert(id, patch) {
      const set = setClause(patch, ALERT_COLUMNS);
      const result = await query(pool, `UPDATE ${s.ops}.Alert SET ${set.text} OUTPUT inserted.* WHERE AlertId = @id`, { ...set.params, id: [sql.Int, id] });
      return result.recordset[0] ? mapAlert(result.recordset[0]) : null;
    },
    async clearAlerts({ type, entityType = null, entityId = null }) {
      const result = await query(pool, `UPDATE ${s.ops}.Alert SET ClearedAtUtc = sysutcdatetime()
        WHERE ClearedAtUtc IS NULL AND AlertType = @type
          AND ((@entityType IS NULL AND RelatedEntityType IS NULL) OR RelatedEntityType = @entityType)
          AND ((@entityId IS NULL AND RelatedEntityId IS NULL) OR RelatedEntityId = @entityId)`, {
        type: [sql.VarChar(40), type], entityType: [sql.VarChar(20), entityType], entityId: [sql.Int, entityId],
      });
      return result.rowsAffected[0];
    },

    async addAudit(entry) {
      const result = await query(pool, `INSERT ${s.ops}.AuditLog (Action, EntityType, EntityId, Detail, ActorEmail)
        OUTPUT inserted.* VALUES (@action, @entityType, @entityId, @detail, @actor)`, {
        action: [sql.VarChar(40), entry.action], entityType: [sql.VarChar(20), entry.entityType], entityId: [sql.Int, entry.entityId ?? null],
        detail: [sql.NVarChar(1000), entry.detail ? entry.detail.slice(0, 1000) : null], actor: [sql.NVarChar(200), entry.actor],
      });
      return mapAudit(result.recordset[0]);
    },
    async listAudit({ entityType = null, entityId = null, limit = 100 } = {}) {
      const result = await query(pool, `SELECT TOP (@limit) * FROM ${s.ops}.AuditLog
        WHERE (@entityType IS NULL OR EntityType = @entityType) AND (@entityId IS NULL OR EntityId = @entityId)
        ORDER BY AuditLogId DESC`, {
        limit: [sql.Int, limit], entityType: [sql.VarChar(20), entityType], entityId: [sql.Int, entityId],
      });
      return result.recordset.map(mapAudit);
    },
  };
}
