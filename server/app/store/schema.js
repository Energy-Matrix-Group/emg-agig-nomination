// The app's tables, as the design's SQL setup script made them (docs/schema/agig-nomination.sql is written from
// this file by `node scripts/write-schema-script.js`; test/schema.test.js fails when they differ). Three schemas:
// `ref` for master data, `nom` for each submission's life and `ops` for health: the design's twelve tables and two
// views, exactly. The design's worker writes them; this app reads them (and acknowledges and clears alerts).
//
// {ref}, {nom} and {ops} stand for the schema names, which are fixed in code (DEFAULT_SCHEMAS). Only the SQL tests
// use others, a throwaway set per run, checked against SCHEMA_NAME before they reach any SQL text.

export const DEFAULT_SCHEMAS = Object.freeze({ ref: 'ref', nom: 'nom', ops: 'ops' });
export const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,40}$/;

const STATUSES = "'IMPORTED','VALIDATION_FAILED','VALIDATED','APPROVED','BUILT','UPLOADING','UPLOADED','UPLOAD_UNCERTAIN','ACCEPTED','REJECTED','NO_RESPONSE','DUPLICATE','SUPERSEDED','CANCELLED'";
const FILE_STATUSES = "'BUILT','UPLOADING','UPLOADED','UPLOAD_UNCERTAIN','FAILED','RESPONDED','NO_RESPONSE'";

export const TABLES = [
  {
    schema: 'ref', name: 'Pipeline',
    columns: [
      ['PipelineCode', 'varchar(10) NOT NULL PRIMARY KEY'],
      ['PipelineName', 'nvarchar(100) NOT NULL'],
      ['IsActive', 'bit NOT NULL DEFAULT 1'],
    ],
  },
  {
    schema: 'ref', name: 'Designation',
    columns: [
      ['DesignationId', 'int IDENTITY(1,1) PRIMARY KEY'],
      ['PipelineCode', 'varchar(10) NOT NULL REFERENCES {ref}.Pipeline(PipelineCode)'],
      ['DesignationCode', 'varchar(20) NOT NULL'],
      ['Direction', "varchar(6) NOT NULL CHECK (Direction IN ('Inlet','Outlet'))"],
      ['LocationName', 'nvarchar(100) NOT NULL'],
      ['Notes', 'nvarchar(200) NULL'],
      ['SpecSection', 'varchar(10) NULL'],
      ['ValidFrom', 'date NOT NULL'],
      ['ValidTo', 'date NULL'],
    ],
    constraints: ['CONSTRAINT UQ_Designation UNIQUE (PipelineCode, DesignationCode, ValidFrom)'],
  },
  {
    schema: 'ref', name: 'FileTemplate',
    columns: [
      ['ColumnOrder', 'tinyint NOT NULL PRIMARY KEY'],
      ['ColumnName', 'varchar(60) NOT NULL'],
      ['IsMandatory', 'bit NOT NULL'],
    ],
  },
  {
    schema: 'ref', name: 'ErrorCode',
    columns: [
      ['ErrorCode', 'char(3) NOT NULL PRIMARY KEY'],
      ['ErrorMessage', 'nvarchar(200) NOT NULL'],
    ],
  },
  {
    schema: 'ref', name: 'Contract',
    columns: [
      ['ContractId', 'int IDENTITY(1,1) PRIMARY KEY'],
      ['ContractCode', 'varchar(60) NOT NULL UNIQUE'],
      ['ContractType', "varchar(10) NOT NULL CHECK (ContractType IN ('Transport','Spot'))"],
      ['PipelineCode', 'varchar(10) NOT NULL REFERENCES {ref}.Pipeline(PipelineCode)'],
      ['StartDate', 'date NOT NULL'],
      ['EndDate', 'date NULL'],
      ['ContractedCapacityTJ', 'decimal(12,3) NULL'],
      ['ServiceType', 'varchar(10) NULL'],
      ['SubServiceType', 'varchar(10) NULL'],
      ['IsActive', 'bit NOT NULL DEFAULT 1'],
    ],
  },
  {
    schema: 'nom', name: 'Batch',
    columns: [
      ['BatchId', 'int IDENTITY(1,1) PRIMARY KEY'],
      ['Environment', "varchar(4) NOT NULL CHECK (Environment IN ('NP','PROD'))"],
      ['Status', `varchar(20) NOT NULL DEFAULT 'IMPORTED' CHECK (Status IN (${STATUSES}))`],
      ['GasDayFrom', 'date NOT NULL'],
      ['GasDayTo', 'date NOT NULL'],
      ['SourceFile', 'nvarchar(400) NOT NULL'],
      ['SourceSha256', 'char(64) NOT NULL'],
      ['ContentSha256', 'char(64) NOT NULL'],
      ['SupersedesBatchId', 'int NULL REFERENCES {nom}.Batch(BatchId)'],
      ['CreatedBy', 'nvarchar(100) NOT NULL'],
      ['CreatedAtUtc', 'datetime2(0) NOT NULL DEFAULT sysutcdatetime()'],
      ['ValidatedAtUtc', 'datetime2(0) NULL'],
      ['ApprovedBy', 'nvarchar(100) NULL'],
      ['ApprovedAtUtc', 'datetime2(0) NULL'],
      ['RowVer', 'rowversion'],
      // Which model in the workbook made this snapshot, as the worker read it (Eve added it, 18 November 2026).
      // NULL for batches loaded before it. The app shows it as text, whatever its type in the database.
      ['ModelId', 'nvarchar(100) NULL'],
    ],
    constraints: ['CONSTRAINT CK_Batch_Days CHECK (GasDayTo >= GasDayFrom)', 'CONSTRAINT UQ_Batch_Source UNIQUE (SourceSha256)'],
    indexes: [['IX_Batch_Status', '(Status, Environment)'], ['IX_Batch_Days', '(GasDayFrom, GasDayTo)']],
  },
  {
    schema: 'nom', name: 'BatchRow',
    columns: [
      ['BatchRowId', 'int IDENTITY(1,1) PRIMARY KEY'],
      ['BatchId', 'int NOT NULL REFERENCES {nom}.Batch(BatchId)'],
      ['CsvLineNumber', 'int NOT NULL'],
      ['GasDay', 'date NOT NULL'],
      ['Shipper', 'varchar(50) NOT NULL'],
      ['Pipeline', 'varchar(10) NOT NULL'],
      ['Contract', 'varchar(60) NOT NULL'],
      ['NomType', "varchar(10) NOT NULL CHECK (NomType IN ('Inlet','Outlet'))"],
      ['Marketer', 'varchar(50) NULL'],
      ['ServiceType', 'varchar(10) NULL'],
      ['SubServiceType', 'varchar(10) NULL'],
      ['Designation', 'varchar(20) NOT NULL'],
      ['DesignationLocation', 'nvarchar(100) NULL'],
      ['QuantityTJ', 'decimal(12,3) NOT NULL CHECK (QuantityTJ >= 0)'],
      ['ModelNote', 'nvarchar(400) NULL'],
    ],
    constraints: ['CONSTRAINT UQ_BatchRow UNIQUE (BatchId, CsvLineNumber)'],
  },
  {
    schema: 'nom', name: 'ValidationIssue',
    columns: [
      ['ValidationIssueId', 'int IDENTITY(1,1) PRIMARY KEY'],
      ['BatchId', 'int NOT NULL REFERENCES {nom}.Batch(BatchId)'],
      ['BatchRowId', 'int NULL REFERENCES {nom}.BatchRow(BatchRowId)'],
      ['RuleCode', 'varchar(10) NOT NULL'],
      ['Severity', "varchar(7) NOT NULL CHECK (Severity IN ('Error','Warning'))"],
      ['Message', 'nvarchar(500) NOT NULL'],
      ['CreatedAtUtc', 'datetime2(0) NOT NULL DEFAULT sysutcdatetime()'],
    ],
    indexes: [['IX_ValidationIssue_Batch', '(BatchId)']],
  },
  {
    schema: 'nom', name: 'OutboundFile',
    columns: [
      ['FileId', 'int IDENTITY(1,1) PRIMARY KEY'],
      ['BatchId', 'int NOT NULL REFERENCES {nom}.Batch(BatchId)'],
      ['FileName', 'varchar(120) NOT NULL UNIQUE'],
      ['FileBody', 'varbinary(max) NOT NULL'],
      ['Sha256', 'char(64) NOT NULL'],
      ['Status', `varchar(20) NOT NULL DEFAULT 'BUILT' CHECK (Status IN (${FILE_STATUSES}))`],
      ['Attempts', 'int NOT NULL DEFAULT 0'],
      ['LastError', 'nvarchar(2000) NULL'],
      ['BuiltAtUtc', 'datetime2(0) NOT NULL DEFAULT sysutcdatetime()'],
      ['UploadedAtUtc', 'datetime2(0) NULL'],
      ['RemoteSize', 'bigint NULL'],
      ['RespondedAtUtc', 'datetime2(0) NULL'],
    ],
    indexes: [['IX_OutboundFile_Status', '(Status)'], ['IX_OutboundFile_Batch', '(BatchId)']],
  },
  {
    schema: 'nom', name: 'InboundResponse',
    columns: [
      ['ResponseId', 'int IDENTITY(1,1) PRIMARY KEY'],
      ['GraphMessageId', 'varchar(200) NOT NULL UNIQUE'],
      ['ReceivedAtUtc', 'datetime2(0) NOT NULL'],
      ['Sender', 'varchar(200) NULL'],
      ['Subject', 'nvarchar(300) NOT NULL'],
      ['AttachmentName', 'nvarchar(200) NULL'],
      ['RawCsv', 'nvarchar(max) NULL'],
      ['ParsedFileName', 'varchar(120) NULL'],
      ['ParsedStatus', "varchar(10) NULL CHECK (ParsedStatus IN ('Success','Failure'))"],
      ['ResponseTimestamp', 'varchar(14) NULL'],
      ['FileId', 'int NULL REFERENCES {nom}.OutboundFile(FileId)'],
      ['MatchState', "varchar(12) NOT NULL DEFAULT 'UNMATCHED' CHECK (MatchState IN ('UNMATCHED','MATCHED','MANUAL','UNPARSEABLE'))"],
    ],
    indexes: [['IX_InboundResponse_FileName', '(ParsedFileName)']],
  },
  {
    schema: 'nom', name: 'ResponseError',
    columns: [
      ['ResponseErrorId', 'int IDENTITY(1,1) PRIMARY KEY'],
      ['ResponseId', 'int NOT NULL REFERENCES {nom}.InboundResponse(ResponseId)'],
      ['LineNumber', 'int NOT NULL'],
      ['ErrorCode', 'varchar(5) NOT NULL'],
      ['ErrorDescription', 'nvarchar(300) NULL'],
      ['BatchRowId', 'int NULL REFERENCES {nom}.BatchRow(BatchRowId)'],
    ],
    indexes: [['IX_ResponseError_Response', '(ResponseId)']],
  },

  {
    schema: 'ops', name: 'Alert',
    columns: [
      ['AlertId', 'int IDENTITY(1,1) PRIMARY KEY'],
      ['AlertType', 'varchar(40) NOT NULL'],
      ['Severity', "varchar(8) NOT NULL CHECK (Severity IN ('Info','Warning','Critical'))"],
      ['Message', 'nvarchar(1000) NOT NULL'],
      ['RelatedEntityType', 'varchar(20) NULL'],
      ['RelatedEntityId', 'int NULL'],
      ['RaisedAtUtc', 'datetime2(0) NOT NULL DEFAULT sysutcdatetime()'],
      ['AcknowledgedBy', 'nvarchar(100) NULL'],
      ['AcknowledgedAtUtc', 'datetime2(0) NULL'],
      ['ClearedAtUtc', 'datetime2(0) NULL'],
    ],
    indexes: [['IX_Alert_Open', '(ClearedAtUtc, Severity)']],
  },

];

// The design's two views, unchanged, for anyone who reads the database directly (SSMS, Excel, a report). The app
// works these out itself (board.js), so it never reads them.
export const VIEWS = [
  {
    schema: 'nom', name: 'vAcceptedNomination',
    body: `WITH ranked AS (
    SELECT r.BatchRowId, r.BatchId, r.GasDay, r.Shipper, r.Pipeline, r.Contract, r.NomType,
           r.Marketer, r.ServiceType, r.SubServiceType, r.Designation, r.QuantityTJ,
           f.FileName, f.UploadedAtUtc,
           ROW_NUMBER() OVER (PARTITION BY r.GasDay, r.Contract, r.NomType, r.Designation,
                                           ISNULL(r.Marketer, ''), ISNULL(r.ServiceType, '')
                              ORDER BY f.UploadedAtUtc DESC) AS rn
    FROM {nom}.BatchRow r
    JOIN {nom}.Batch b        ON b.BatchId = r.BatchId
    JOIN {nom}.OutboundFile f ON f.BatchId = b.BatchId
    WHERE b.Status = 'ACCEPTED'
)
SELECT BatchRowId, BatchId, GasDay, Shipper, Pipeline, Contract, NomType, Marketer,
       ServiceType, SubServiceType, Designation, QuantityTJ, FileName, UploadedAtUtc
FROM ranked
WHERE rn = 1`,
  },
  {
    schema: 'nom', name: 'vGasDayStatus',
    body: `WITH today AS (
    SELECT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'W. Australia Standard Time' AS date) AS d
),
days AS (
    SELECT DATEADD(day, v.n, t.d) AS GasDay
    FROM today t
    CROSS JOIN (VALUES (-1), (0), (1), (2), (3), (4), (5), (6), (7)) AS v(n)
),
cover AS (
    SELECT d.GasDay, b.BatchId, b.Status, b.Environment, b.CreatedAtUtc, f.FileName, f.UploadedAtUtc
    FROM days d
    JOIN {nom}.Batch b ON d.GasDay BETWEEN b.GasDayFrom AND b.GasDayTo
    LEFT JOIN {nom}.OutboundFile f ON f.BatchId = b.BatchId
)
SELECT d.GasDay,
       DATEADD(hour, 14, CAST(DATEADD(day, -1, d.GasDay) AS datetime2(0))) AS InitialCutoffAwst,
       DATEADD(hour, 20, CAST(d.GasDay AS datetime2(0)))                   AS RenomCutoffAwst,
       la.BatchId       AS LastAcceptedBatchId,
       la.UploadedAtUtc AS LastAcceptedUploadUtc,
       lp.BatchId       AS LastPublishedBatchId,
       lp.Status        AS LastPublishedStatus,
       lp.CreatedAtUtc  AS LastPublishedAtUtc,
       inf.FileName     AS InFlightFile
FROM days d
OUTER APPLY (SELECT TOP 1 x.BatchId, x.UploadedAtUtc FROM cover x
             WHERE x.GasDay = d.GasDay AND x.Status = 'ACCEPTED'
             ORDER BY x.UploadedAtUtc DESC) la
OUTER APPLY (SELECT TOP 1 x.BatchId, x.Status, x.CreatedAtUtc FROM cover x
             WHERE x.GasDay = d.GasDay AND x.Status NOT IN ('DUPLICATE', 'CANCELLED')
             ORDER BY x.CreatedAtUtc DESC) lp
OUTER APPLY (SELECT TOP 1 x.FileName FROM cover x
             WHERE x.GasDay = d.GasDay AND x.Status IN ('UPLOADED', 'UPLOAD_UNCERTAIN')
             ORDER BY x.UploadedAtUtc DESC) inf`,
  },
];

export function checkSchemas(schemas) {
  for (const key of ['ref', 'nom', 'ops']) {
    if (!SCHEMA_NAME.test(String(schemas?.[key] ?? ''))) throw new Error(`Schema name for ${key} is not allowed`);
  }
  return schemas;
}

export function fill(text, schemas) {
  return text.replace(/\{(ref|nom|ops)\}/g, (_, key) => schemas[key]);
}

// The statements that make each table, index and view that is missing. Each is guarded, so running them again
// changes nothing, and none alters or drops anything.
export function schemaStatements(schemas = DEFAULT_SCHEMAS) {
  checkSchemas(schemas);
  const statements = [];
  for (const key of ['ref', 'nom', 'ops']) {
    statements.push(`IF SCHEMA_ID('${schemas[key]}') IS NULL EXEC('CREATE SCHEMA [${schemas[key]}]')`);
  }
  for (const table of TABLES) {
    const name = `${schemas[table.schema]}.${table.name}`;
    const lines = [...table.columns.map(([column, type]) => `    ${column} ${fill(type, schemas)}`), ...(table.constraints ?? []).map((line) => `    ${line}`)];
    statements.push(`IF OBJECT_ID('${name}', 'U') IS NULL\nCREATE TABLE ${name} (\n${lines.join(',\n')}\n)`);
    for (const [index, columns] of table.indexes ?? []) {
      statements.push(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${index}' AND object_id = OBJECT_ID('${name}'))\nCREATE INDEX ${index} ON ${name} ${columns}`);
    }
  }
  for (const view of VIEWS) {
    const name = `${schemas[view.schema]}.${view.name}`;
    const body = `CREATE VIEW ${name} AS\n${fill(view.body, schemas)}`;
    statements.push(`IF OBJECT_ID('${name}', 'V') IS NULL\nEXEC('${body.replaceAll("'", "''")}')`);
  }
  return statements;
}
