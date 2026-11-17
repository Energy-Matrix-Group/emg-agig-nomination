-- AGIG Nominations: the tables, indexes and views the app makes at boot (server/app/store/schema.js).
-- Written by `node scripts/write-schema-script.js`; do not edit by hand. test/schema.test.js checks it.
--
-- It is the design's SQL setup script (sections 1 to 4 and 6): its twelve tables and two views.
-- Every statement is guarded, so it is safe to run on a database the setup script already built: it makes
-- only what is missing and never alters or drops anything. The spec's reference data (pipelines, the SHNOM
-- template, the 82 points and the 28 error codes) is seeded by the app into tables that are empty.

IF SCHEMA_ID('ref') IS NULL EXEC('CREATE SCHEMA [ref]');
GO

IF SCHEMA_ID('nom') IS NULL EXEC('CREATE SCHEMA [nom]');
GO

IF SCHEMA_ID('ops') IS NULL EXEC('CREATE SCHEMA [ops]');
GO

IF OBJECT_ID('ref.Pipeline', 'U') IS NULL
CREATE TABLE ref.Pipeline (
    PipelineCode varchar(10) NOT NULL PRIMARY KEY,
    PipelineName nvarchar(100) NOT NULL,
    IsActive bit NOT NULL DEFAULT 1
);
GO

IF OBJECT_ID('ref.Designation', 'U') IS NULL
CREATE TABLE ref.Designation (
    DesignationId int IDENTITY(1,1) PRIMARY KEY,
    PipelineCode varchar(10) NOT NULL REFERENCES ref.Pipeline(PipelineCode),
    DesignationCode varchar(20) NOT NULL,
    Direction varchar(6) NOT NULL CHECK (Direction IN ('Inlet','Outlet')),
    LocationName nvarchar(100) NOT NULL,
    Notes nvarchar(200) NULL,
    SpecSection varchar(10) NULL,
    ValidFrom date NOT NULL,
    ValidTo date NULL,
    CONSTRAINT UQ_Designation UNIQUE (PipelineCode, DesignationCode, ValidFrom)
);
GO

IF OBJECT_ID('ref.FileTemplate', 'U') IS NULL
CREATE TABLE ref.FileTemplate (
    ColumnOrder tinyint NOT NULL PRIMARY KEY,
    ColumnName varchar(60) NOT NULL,
    IsMandatory bit NOT NULL
);
GO

IF OBJECT_ID('ref.ErrorCode', 'U') IS NULL
CREATE TABLE ref.ErrorCode (
    ErrorCode char(3) NOT NULL PRIMARY KEY,
    ErrorMessage nvarchar(200) NOT NULL
);
GO

IF OBJECT_ID('ref.Contract', 'U') IS NULL
CREATE TABLE ref.Contract (
    ContractId int IDENTITY(1,1) PRIMARY KEY,
    ContractCode varchar(60) NOT NULL UNIQUE,
    ContractType varchar(10) NOT NULL CHECK (ContractType IN ('Transport','Spot')),
    PipelineCode varchar(10) NOT NULL REFERENCES ref.Pipeline(PipelineCode),
    StartDate date NOT NULL,
    EndDate date NULL,
    ContractedCapacityTJ decimal(12,3) NULL,
    ServiceType varchar(10) NULL,
    SubServiceType varchar(10) NULL,
    IsActive bit NOT NULL DEFAULT 1
);
GO

IF OBJECT_ID('nom.Batch', 'U') IS NULL
CREATE TABLE nom.Batch (
    BatchId int IDENTITY(1,1) PRIMARY KEY,
    Environment varchar(4) NOT NULL CHECK (Environment IN ('NP','PROD')),
    Status varchar(20) NOT NULL DEFAULT 'IMPORTED' CHECK (Status IN ('IMPORTED','VALIDATION_FAILED','VALIDATED','APPROVED','BUILT','UPLOADING','UPLOADED','UPLOAD_UNCERTAIN','ACCEPTED','REJECTED','NO_RESPONSE','DUPLICATE','SUPERSEDED','CANCELLED')),
    GasDayFrom date NOT NULL,
    GasDayTo date NOT NULL,
    SourceFile nvarchar(400) NOT NULL,
    SourceSha256 char(64) NOT NULL,
    ContentSha256 char(64) NOT NULL,
    SupersedesBatchId int NULL REFERENCES nom.Batch(BatchId),
    CreatedBy nvarchar(100) NOT NULL,
    CreatedAtUtc datetime2(0) NOT NULL DEFAULT sysutcdatetime(),
    ValidatedAtUtc datetime2(0) NULL,
    ApprovedBy nvarchar(100) NULL,
    ApprovedAtUtc datetime2(0) NULL,
    RowVer rowversion,
    CONSTRAINT CK_Batch_Days CHECK (GasDayTo >= GasDayFrom),
    CONSTRAINT UQ_Batch_Source UNIQUE (SourceSha256)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Batch_Status' AND object_id = OBJECT_ID('nom.Batch'))
CREATE INDEX IX_Batch_Status ON nom.Batch (Status, Environment);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Batch_Days' AND object_id = OBJECT_ID('nom.Batch'))
CREATE INDEX IX_Batch_Days ON nom.Batch (GasDayFrom, GasDayTo);
GO

IF OBJECT_ID('nom.BatchRow', 'U') IS NULL
CREATE TABLE nom.BatchRow (
    BatchRowId int IDENTITY(1,1) PRIMARY KEY,
    BatchId int NOT NULL REFERENCES nom.Batch(BatchId),
    CsvLineNumber int NOT NULL,
    GasDay date NOT NULL,
    Shipper varchar(50) NOT NULL,
    Pipeline varchar(10) NOT NULL,
    Contract varchar(60) NOT NULL,
    NomType varchar(10) NOT NULL CHECK (NomType IN ('Inlet','Outlet')),
    Marketer varchar(50) NULL,
    ServiceType varchar(10) NULL,
    SubServiceType varchar(10) NULL,
    Designation varchar(20) NOT NULL,
    DesignationLocation nvarchar(100) NULL,
    QuantityTJ decimal(12,3) NOT NULL CHECK (QuantityTJ >= 0),
    ModelNote nvarchar(400) NULL,
    CONSTRAINT UQ_BatchRow UNIQUE (BatchId, CsvLineNumber)
);
GO

IF OBJECT_ID('nom.ValidationIssue', 'U') IS NULL
CREATE TABLE nom.ValidationIssue (
    ValidationIssueId int IDENTITY(1,1) PRIMARY KEY,
    BatchId int NOT NULL REFERENCES nom.Batch(BatchId),
    BatchRowId int NULL REFERENCES nom.BatchRow(BatchRowId),
    RuleCode varchar(10) NOT NULL,
    Severity varchar(7) NOT NULL CHECK (Severity IN ('Error','Warning')),
    Message nvarchar(500) NOT NULL,
    CreatedAtUtc datetime2(0) NOT NULL DEFAULT sysutcdatetime()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ValidationIssue_Batch' AND object_id = OBJECT_ID('nom.ValidationIssue'))
CREATE INDEX IX_ValidationIssue_Batch ON nom.ValidationIssue (BatchId);
GO

IF OBJECT_ID('nom.OutboundFile', 'U') IS NULL
CREATE TABLE nom.OutboundFile (
    FileId int IDENTITY(1,1) PRIMARY KEY,
    BatchId int NOT NULL REFERENCES nom.Batch(BatchId),
    FileName varchar(120) NOT NULL UNIQUE,
    FileBody varbinary(max) NOT NULL,
    Sha256 char(64) NOT NULL,
    Status varchar(20) NOT NULL DEFAULT 'BUILT' CHECK (Status IN ('BUILT','UPLOADING','UPLOADED','UPLOAD_UNCERTAIN','FAILED','RESPONDED','NO_RESPONSE')),
    Attempts int NOT NULL DEFAULT 0,
    LastError nvarchar(2000) NULL,
    BuiltAtUtc datetime2(0) NOT NULL DEFAULT sysutcdatetime(),
    UploadedAtUtc datetime2(0) NULL,
    RemoteSize bigint NULL,
    RespondedAtUtc datetime2(0) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OutboundFile_Status' AND object_id = OBJECT_ID('nom.OutboundFile'))
CREATE INDEX IX_OutboundFile_Status ON nom.OutboundFile (Status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OutboundFile_Batch' AND object_id = OBJECT_ID('nom.OutboundFile'))
CREATE INDEX IX_OutboundFile_Batch ON nom.OutboundFile (BatchId);
GO

IF OBJECT_ID('nom.InboundResponse', 'U') IS NULL
CREATE TABLE nom.InboundResponse (
    ResponseId int IDENTITY(1,1) PRIMARY KEY,
    GraphMessageId varchar(200) NOT NULL UNIQUE,
    ReceivedAtUtc datetime2(0) NOT NULL,
    Sender varchar(200) NULL,
    Subject nvarchar(300) NOT NULL,
    AttachmentName nvarchar(200) NULL,
    RawCsv nvarchar(max) NULL,
    ParsedFileName varchar(120) NULL,
    ParsedStatus varchar(10) NULL CHECK (ParsedStatus IN ('Success','Failure')),
    ResponseTimestamp varchar(14) NULL,
    FileId int NULL REFERENCES nom.OutboundFile(FileId),
    MatchState varchar(12) NOT NULL DEFAULT 'UNMATCHED' CHECK (MatchState IN ('UNMATCHED','MATCHED','MANUAL','UNPARSEABLE'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_InboundResponse_FileName' AND object_id = OBJECT_ID('nom.InboundResponse'))
CREATE INDEX IX_InboundResponse_FileName ON nom.InboundResponse (ParsedFileName);
GO

IF OBJECT_ID('nom.ResponseError', 'U') IS NULL
CREATE TABLE nom.ResponseError (
    ResponseErrorId int IDENTITY(1,1) PRIMARY KEY,
    ResponseId int NOT NULL REFERENCES nom.InboundResponse(ResponseId),
    LineNumber int NOT NULL,
    ErrorCode varchar(5) NOT NULL,
    ErrorDescription nvarchar(300) NULL,
    BatchRowId int NULL REFERENCES nom.BatchRow(BatchRowId)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ResponseError_Response' AND object_id = OBJECT_ID('nom.ResponseError'))
CREATE INDEX IX_ResponseError_Response ON nom.ResponseError (ResponseId);
GO

IF OBJECT_ID('ops.Alert', 'U') IS NULL
CREATE TABLE ops.Alert (
    AlertId int IDENTITY(1,1) PRIMARY KEY,
    AlertType varchar(40) NOT NULL,
    Severity varchar(8) NOT NULL CHECK (Severity IN ('Info','Warning','Critical')),
    Message nvarchar(1000) NOT NULL,
    RelatedEntityType varchar(20) NULL,
    RelatedEntityId int NULL,
    RaisedAtUtc datetime2(0) NOT NULL DEFAULT sysutcdatetime(),
    AcknowledgedBy nvarchar(100) NULL,
    AcknowledgedAtUtc datetime2(0) NULL,
    ClearedAtUtc datetime2(0) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Alert_Open' AND object_id = OBJECT_ID('ops.Alert'))
CREATE INDEX IX_Alert_Open ON ops.Alert (ClearedAtUtc, Severity);
GO

IF OBJECT_ID('nom.vAcceptedNomination', 'V') IS NULL
EXEC('CREATE VIEW nom.vAcceptedNomination AS
WITH ranked AS (
    SELECT r.BatchRowId, r.BatchId, r.GasDay, r.Shipper, r.Pipeline, r.Contract, r.NomType,
           r.Marketer, r.ServiceType, r.SubServiceType, r.Designation, r.QuantityTJ,
           f.FileName, f.UploadedAtUtc,
           ROW_NUMBER() OVER (PARTITION BY r.GasDay, r.Contract, r.NomType, r.Designation,
                                           ISNULL(r.Marketer, ''''), ISNULL(r.ServiceType, '''')
                              ORDER BY f.UploadedAtUtc DESC) AS rn
    FROM nom.BatchRow r
    JOIN nom.Batch b        ON b.BatchId = r.BatchId
    JOIN nom.OutboundFile f ON f.BatchId = b.BatchId
    WHERE b.Status = ''ACCEPTED''
)
SELECT BatchRowId, BatchId, GasDay, Shipper, Pipeline, Contract, NomType, Marketer,
       ServiceType, SubServiceType, Designation, QuantityTJ, FileName, UploadedAtUtc
FROM ranked
WHERE rn = 1');
GO

IF OBJECT_ID('nom.vGasDayStatus', 'V') IS NULL
EXEC('CREATE VIEW nom.vGasDayStatus AS
WITH today AS (
    SELECT CAST(SYSDATETIMEOFFSET() AT TIME ZONE ''W. Australia Standard Time'' AS date) AS d
),
days AS (
    SELECT DATEADD(day, v.n, t.d) AS GasDay
    FROM today t
    CROSS JOIN (VALUES (-1), (0), (1), (2), (3), (4), (5), (6), (7)) AS v(n)
),
cover AS (
    SELECT d.GasDay, b.BatchId, b.Status, b.Environment, b.CreatedAtUtc, f.FileName, f.UploadedAtUtc
    FROM days d
    JOIN nom.Batch b ON d.GasDay BETWEEN b.GasDayFrom AND b.GasDayTo
    LEFT JOIN nom.OutboundFile f ON f.BatchId = b.BatchId
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
             WHERE x.GasDay = d.GasDay AND x.Status = ''ACCEPTED''
             ORDER BY x.UploadedAtUtc DESC) la
OUTER APPLY (SELECT TOP 1 x.BatchId, x.Status, x.CreatedAtUtc FROM cover x
             WHERE x.GasDay = d.GasDay AND x.Status NOT IN (''DUPLICATE'', ''CANCELLED'')
             ORDER BY x.CreatedAtUtc DESC) lp
OUTER APPLY (SELECT TOP 1 x.FileName FROM cover x
             WHERE x.GasDay = d.GasDay AND x.Status IN (''UPLOADED'', ''UPLOAD_UNCERTAIN'')
             ORDER BY x.UploadedAtUtc DESC) inf');
GO
