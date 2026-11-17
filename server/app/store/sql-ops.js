import { BATCH_COLUMNS, FILE_COLUMNS, guardedUpdate } from './sql-batches.js';
import { inList, inTransaction, query, setClause, sql, timeIn, timeOut } from './sql-kit.js';

// AGIG's responses (nom.InboundResponse, nom.ResponseError) and alerts (ops.Alert). The app reads them and
// acknowledges or clears alerts; recording a response and raising an alert are the worker's, used by the tests and
// the demo to stand in for it.

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
    async raiseAlert(alert) {
      const result = await query(pool, `INSERT ${s.ops}.Alert (AlertType, Severity, Message, RelatedEntityType, RelatedEntityId, RaisedAtUtc)
        OUTPUT inserted.* VALUES (@type, @severity, @message, @entityType, @entityId, ISNULL(@raisedAt, sysutcdatetime()))`, {
        type: [sql.VarChar(40), alert.type], severity: [sql.VarChar(8), alert.severity], message: [sql.NVarChar(1000), alert.message.slice(0, 1000)],
        entityType: [sql.VarChar(20), alert.entityType ?? null], entityId: [sql.Int, alert.entityId ?? null], raisedAt: [sql.DateTime2(0), timeIn(alert.raisedAt)],
      });
      return mapAlert(result.recordset[0]);
    },
    async listAlerts({ open = null, limit = 200 } = {}) {
      const result = await query(pool, `SELECT TOP (@limit) * FROM ${s.ops}.Alert
        WHERE (@open IS NULL OR (@open = 1 AND ClearedAtUtc IS NULL) OR (@open = 0 AND ClearedAtUtc IS NOT NULL))
        ORDER BY AlertId DESC`, {
        limit: [sql.Int, limit], open: [sql.Bit, open === null ? null : open],
      });
      return result.recordset.map(mapAlert);
    },
    async updateAlert(id, patch) {
      const set = setClause(patch, ALERT_COLUMNS);
      const result = await query(pool, `UPDATE ${s.ops}.Alert SET ${set.text} OUTPUT inserted.* WHERE AlertId = @id`, { ...set.params, id: [sql.Int, id] });
      return result.recordset[0] ? mapAlert(result.recordset[0]) : null;
    },
  };
}
