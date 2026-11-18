import { dateIn, dateOut, decimalIn, decimalOut, inList, inTransaction, query, setClause, sql, timeIn, timeOut } from './sql-kit.js';

// Batches, their rows, the issues the worker's checks found, and the outbound files, in SQL. The app reads them;
// the writes are the worker's, used by the tests and the demo to stand in for it.

const ROWS_PER_INSERT = 100; // 14 parameters a row keeps a statement well under SQL Server's 2,100

export const mapBatch = (row) => ({
  id: row.BatchId,
  environment: row.Environment,
  status: row.Status,
  gasDayFrom: dateOut(row.GasDayFrom),
  gasDayTo: dateOut(row.GasDayTo),
  sourceFile: row.SourceFile,
  sourceSha256: row.SourceSha256,
  contentSha256: row.ContentSha256,
  supersedesBatchId: row.SupersedesBatchId ?? null,
  createdBy: row.CreatedBy,
  createdAt: timeOut(row.CreatedAtUtc),
  validatedAt: timeOut(row.ValidatedAtUtc),
  approvedBy: row.ApprovedBy ?? null,
  approvedAt: timeOut(row.ApprovedAtUtc),
  modelId: row.ModelId === null || row.ModelId === undefined ? null : String(row.ModelId),
});

const mapRow = (row) => ({
  id: row.BatchRowId,
  batchId: row.BatchId,
  csvLineNumber: row.CsvLineNumber,
  gasDay: dateOut(row.GasDay),
  shipper: row.Shipper,
  pipeline: row.Pipeline,
  contract: row.Contract,
  nomType: row.NomType,
  marketer: row.Marketer,
  serviceType: row.ServiceType,
  subServiceType: row.SubServiceType,
  designation: row.Designation,
  designationLocation: row.DesignationLocation,
  quantityTJ: decimalOut(row.QuantityTJ),
  note: row.ModelNote,
});

const mapIssue = (row) => ({
  id: row.ValidationIssueId,
  batchId: row.BatchId,
  batchRowId: row.BatchRowId,
  rule: row.RuleCode,
  severity: row.Severity,
  message: row.Message,
  createdAt: timeOut(row.CreatedAtUtc),
});

export const mapFile = (row) => ({
  id: row.FileId,
  batchId: row.BatchId,
  fileName: row.FileName,
  ...(row.FileBody ? { body: Buffer.from(row.FileBody) } : {}),
  sha256: row.Sha256,
  status: row.Status,
  attempts: row.Attempts,
  lastError: row.LastError,
  builtAt: timeOut(row.BuiltAtUtc),
  uploadedAt: timeOut(row.UploadedAtUtc),
  remoteSize: row.RemoteSize === null || row.RemoteSize === undefined ? null : Number(row.RemoteSize),
  respondedAt: timeOut(row.RespondedAtUtc),
});

export const BATCH_COLUMNS = {
  status: ['Status', sql.VarChar(20)],
  validatedAt: ['ValidatedAtUtc', sql.DateTime2(0), timeIn],
  approvedBy: ['ApprovedBy', sql.NVarChar(100)],
  approvedAt: ['ApprovedAtUtc', sql.DateTime2(0), timeIn],
};

export const FILE_COLUMNS = {
  status: ['Status', sql.VarChar(20)],
  attempts: ['Attempts', sql.Int],
  lastError: ['LastError', sql.NVarChar(2000)],
  uploadedAt: ['UploadedAtUtc', sql.DateTime2(0), timeIn],
  remoteSize: ['RemoteSize', sql.BigInt],
  respondedAt: ['RespondedAtUtc', sql.DateTime2(0), timeIn],
};

const FILE_SUMMARY = 'FileId, BatchId, FileName, Sha256, Status, Attempts, LastError, BuiltAtUtc, UploadedAtUtc, RemoteSize, RespondedAtUtc';

// UPDATE ... SET ... WHERE id = @id [AND Status IN (...)]; true when a row changed.
export async function guardedUpdate(runner, table, idColumn, id, patch, columns, from) {
  const set = setClause(patch, columns);
  const statuses = from ? inList('from', sql.VarChar(20), from) : null;
  const result = await query(runner, `UPDATE ${table} SET ${set.text} WHERE ${idColumn} = @id${statuses ? ` AND Status IN (${statuses.text})` : ''}`, {
    ...set.params, ...(statuses?.params ?? {}), id: [sql.Int, id],
  });
  return result.rowsAffected[0] > 0;
}

export function batchStore(pool, s) {
  return {
    async createBatch({ batch, rows, issues = [] }) {
      return inTransaction(pool, async (tx) => {
        const created = await query(tx, `INSERT ${s.nom}.Batch (Environment, Status, GasDayFrom, GasDayTo, SourceFile, SourceSha256,
            ContentSha256, SupersedesBatchId, CreatedBy, CreatedAtUtc, ValidatedAtUtc, ApprovedBy, ApprovedAtUtc, ModelId)
          OUTPUT inserted.*
          VALUES (@environment, @status, @gasDayFrom, @gasDayTo, @sourceFile, @sourceSha256, @contentSha256, @supersedesBatchId,
            @createdBy, ISNULL(@createdAt, sysutcdatetime()), @validatedAt, @approvedBy, @approvedAt, @modelId)`, {
          environment: [sql.VarChar(4), batch.environment],
          status: [sql.VarChar(20), batch.status],
          gasDayFrom: [sql.Date, dateIn(batch.gasDayFrom)],
          gasDayTo: [sql.Date, dateIn(batch.gasDayTo)],
          sourceFile: [sql.NVarChar(400), batch.sourceFile],
          sourceSha256: [sql.Char(64), batch.sourceSha256],
          contentSha256: [sql.Char(64), batch.contentSha256],
          supersedesBatchId: [sql.Int, batch.supersedesBatchId ?? null],
          createdBy: [sql.NVarChar(100), batch.createdBy],
          createdAt: [sql.DateTime2(0), timeIn(batch.createdAt)],
          validatedAt: [sql.DateTime2(0), timeIn(batch.validatedAt)],
          approvedBy: [sql.NVarChar(100), batch.approvedBy ?? null],
          approvedAt: [sql.DateTime2(0), timeIn(batch.approvedAt)],
          modelId: [sql.NVarChar(100), batch.modelId ?? null],
        });
        const record = mapBatch(created.recordset[0]);

        const idByLine = new Map();
        for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
          const chunk = rows.slice(start, start + ROWS_PER_INSERT);
          const params = { batchId: [sql.Int, record.id] };
          const values = chunk.map((row, at) => {
            const n = start + at;
            Object.assign(params, {
              [`l${n}`]: [sql.Int, row.csvLineNumber], [`d${n}`]: [sql.Date, dateIn(row.gasDay)], [`sh${n}`]: [sql.VarChar(50), row.shipper],
              [`p${n}`]: [sql.VarChar(10), row.pipeline], [`c${n}`]: [sql.VarChar(60), row.contract], [`t${n}`]: [sql.VarChar(10), row.nomType],
              [`m${n}`]: [sql.VarChar(50), row.marketer ?? null], [`st${n}`]: [sql.VarChar(10), row.serviceType ?? null],
              [`ss${n}`]: [sql.VarChar(10), row.subServiceType ?? null], [`g${n}`]: [sql.VarChar(20), row.designation],
              [`gl${n}`]: [sql.NVarChar(100), row.designationLocation ?? null], [`q${n}`]: [sql.Decimal(12, 3), decimalIn(row.quantityTJ)],
              [`n${n}`]: [sql.NVarChar(400), row.note ?? null],
            });
            return `(@batchId, @l${n}, @d${n}, @sh${n}, @p${n}, @c${n}, @t${n}, @m${n}, @st${n}, @ss${n}, @g${n}, @gl${n}, @q${n}, @n${n})`;
          });
          const inserted = await query(tx, `INSERT ${s.nom}.BatchRow (BatchId, CsvLineNumber, GasDay, Shipper, Pipeline, Contract, NomType,
              Marketer, ServiceType, SubServiceType, Designation, DesignationLocation, QuantityTJ, ModelNote)
            OUTPUT inserted.BatchRowId, inserted.CsvLineNumber VALUES ${values.join(', ')}`, params);
          for (const row of inserted.recordset) idByLine.set(row.CsvLineNumber, row.BatchRowId);
        }

        for (const issue of issues) {
          const rowId = issue.line === null || issue.line === undefined ? null : idByLine.get(rows[issue.line]?.csvLineNumber) ?? null;
          await query(tx, `INSERT ${s.nom}.ValidationIssue (BatchId, BatchRowId, RuleCode, Severity, Message)
            VALUES (@batchId, @rowId, @rule, @severity, @message)`, {
            batchId: [sql.Int, record.id], rowId: [sql.Int, rowId], rule: [sql.VarChar(10), issue.rule],
            severity: [sql.VarChar(7), issue.severity], message: [sql.NVarChar(500), issue.message.slice(0, 500)],
          });
        }

        return record;
      });
    },
    async getBatch(id) {
      const result = await query(pool, `SELECT * FROM ${s.nom}.Batch WHERE BatchId = @id`, { id: [sql.Int, id] });
      return result.recordset[0] ? mapBatch(result.recordset[0]) : null;
    },
    async listBatches({ from = null, to = null, status = null, environment = null, limit = 200, ids = null } = {}) {
      const statuses = status ? inList('status', sql.VarChar(20), [].concat(status)) : null;
      const idList = ids ? inList('id', sql.Int, ids) : null;
      const result = await query(pool, `SELECT TOP (@limit) * FROM ${s.nom}.Batch
        WHERE (@from IS NULL OR GasDayTo >= @from) AND (@to IS NULL OR GasDayFrom <= @to)
          AND (@environment IS NULL OR Environment = @environment)
          ${statuses ? `AND Status IN (${statuses.text})` : ''} ${idList ? `AND BatchId IN (${idList.text})` : ''}
        ORDER BY BatchId DESC`, {
        limit: [sql.Int, limit], from: [sql.Date, dateIn(from)], to: [sql.Date, dateIn(to)],
        environment: [sql.VarChar(4), environment], ...(statuses?.params ?? {}), ...(idList?.params ?? {}),
      });
      return result.recordset.map(mapBatch);
    },
    // For each batch: its lines, inlet and outlet totals, the issues the checks found, and AGIG's error lines.
    async batchSummaries(batchIds) {
      if (!batchIds.length) return [];
      const ids = inList('id', sql.Int, batchIds);
      const result = await query(pool, `SELECT b.BatchId,
          (SELECT COUNT(*) FROM ${s.nom}.BatchRow r WHERE r.BatchId = b.BatchId) AS Lines,
          (SELECT ISNULL(SUM(r.QuantityTJ), 0) FROM ${s.nom}.BatchRow r WHERE r.BatchId = b.BatchId AND r.NomType = 'Inlet') AS InletTJ,
          (SELECT ISNULL(SUM(r.QuantityTJ), 0) FROM ${s.nom}.BatchRow r WHERE r.BatchId = b.BatchId AND r.NomType = 'Outlet') AS OutletTJ,
          (SELECT COUNT(*) FROM ${s.nom}.ValidationIssue i WHERE i.BatchId = b.BatchId AND i.Severity = 'Error') AS IssueErrors,
          (SELECT COUNT(*) FROM ${s.nom}.ValidationIssue i WHERE i.BatchId = b.BatchId AND i.Severity = 'Warning') AS IssueWarnings,
          (SELECT COUNT(*) FROM ${s.nom}.ResponseError e
             JOIN ${s.nom}.InboundResponse ir ON ir.ResponseId = e.ResponseId
             JOIN ${s.nom}.OutboundFile f ON f.FileId = ir.FileId
           WHERE f.BatchId = b.BatchId) AS AgigErrors
        FROM ${s.nom}.Batch b WHERE b.BatchId IN (${ids.text})`, ids.params);
      const byId = new Map(result.recordset.map((row) => [row.BatchId, row]));
      return batchIds.filter((id) => byId.has(id)).map((id) => {
        const row = byId.get(id);
        return {
          batchId: id, lines: row.Lines, inletTJ: decimalOut(row.InletTJ), outletTJ: decimalOut(row.OutletTJ),
          issueErrors: row.IssueErrors, issueWarnings: row.IssueWarnings, agigErrors: row.AgigErrors,
        };
      });
    },
    async listRows(batchIds) {
      if (!batchIds.length) return [];
      const ids = inList('id', sql.Int, batchIds);
      const result = await query(pool, `SELECT * FROM ${s.nom}.BatchRow WHERE BatchId IN (${ids.text}) ORDER BY BatchId, CsvLineNumber`, ids.params);
      return result.recordset.map(mapRow);
    },
    async listIssues(batchId) {
      const result = await query(pool, `SELECT * FROM ${s.nom}.ValidationIssue WHERE BatchId = @id ORDER BY ValidationIssueId`, { id: [sql.Int, batchId] });
      return result.recordset.map(mapIssue);
    },
    updateBatch: (id, patch, { from = null } = {}) => guardedUpdate(pool, `${s.nom}.Batch`, 'BatchId', id, patch, BATCH_COLUMNS, from),

    async createFile(file) {
      try {
        const result = await query(pool, `INSERT ${s.nom}.OutboundFile (BatchId, FileName, FileBody, Sha256, Status)
          OUTPUT ${FILE_SUMMARY.split(', ').map((column) => `inserted.${column}`).join(', ')}
          VALUES (@batchId, @fileName, @body, @sha256, @status)`, {
          batchId: [sql.Int, file.batchId], fileName: [sql.VarChar(120), file.fileName], body: [sql.VarBinary(sql.MAX), file.body],
          sha256: [sql.Char(64), file.sha256], status: [sql.VarChar(20), file.status],
        });
        return mapFile(result.recordset[0]);
      } catch (error) {
        // 2627: a unique key. The only one a new file can break is its name.
        if (error?.number === 2627 || error?.originalError?.info?.number === 2627) throw Object.assign(new Error('duplicate file name'), { duplicateFileName: true });
        throw error;
      }
    },
    async getFile(id, { body = false } = {}) {
      const result = await query(pool, `SELECT ${body ? '*' : FILE_SUMMARY} FROM ${s.nom}.OutboundFile WHERE FileId = @id`, { id: [sql.Int, id] });
      return result.recordset[0] ? mapFile(result.recordset[0]) : null;
    },
    async listFiles({ status = null, batchIds = null } = {}) {
      const statuses = status ? inList('status', sql.VarChar(20), [].concat(status)) : null;
      const ids = batchIds ? inList('id', sql.Int, batchIds) : null;
      if (ids && !batchIds.length) return [];
      const result = await query(pool, `SELECT ${FILE_SUMMARY} FROM ${s.nom}.OutboundFile WHERE 1 = 1
        ${statuses ? `AND Status IN (${statuses.text})` : ''} ${ids ? `AND BatchId IN (${ids.text})` : ''} ORDER BY FileId`, {
        ...(statuses?.params ?? {}), ...(ids?.params ?? {}),
      });
      return result.recordset.map(mapFile);
    },
    updateFile: (id, patch, { from = null } = {}) => guardedUpdate(pool, `${s.nom}.OutboundFile`, 'FileId', id, patch, FILE_COLUMNS, from),
  };
}
