import { bit, dateIn, dateOut, decimalIn, decimalOut, query, sql } from './sql-kit.js';

// Reference data (ref) in SQL. The app only reads it; createContract is for the tests and the demo, standing in
// for the database administrator's scripts.

const mapDesignation = (row) => ({
  id: row.DesignationId,
  pipelineCode: row.PipelineCode,
  code: row.DesignationCode,
  direction: row.Direction,
  locationName: row.LocationName,
  notes: row.Notes,
  specSection: row.SpecSection,
  validFrom: dateOut(row.ValidFrom),
  validTo: dateOut(row.ValidTo),
});

const mapContract = (row) => ({
  id: row.ContractId,
  code: row.ContractCode,
  type: row.ContractType,
  pipelineCode: row.PipelineCode,
  startDate: dateOut(row.StartDate),
  endDate: dateOut(row.EndDate),
  capacityTJ: decimalOut(row.ContractedCapacityTJ),
  serviceType: row.ServiceType,
  subServiceType: row.SubServiceType,
  isActive: bit(row.IsActive),
});

const CONTRACT_COLUMNS = {
  code: ['ContractCode', sql.VarChar(60)],
  type: ['ContractType', sql.VarChar(10)],
  pipelineCode: ['PipelineCode', sql.VarChar(10)],
  startDate: ['StartDate', sql.Date, dateIn],
  endDate: ['EndDate', sql.Date, dateIn],
  capacityTJ: ['ContractedCapacityTJ', sql.Decimal(12, 3), decimalIn],
  serviceType: ['ServiceType', sql.VarChar(10)],
  subServiceType: ['SubServiceType', sql.VarChar(10)],
  isActive: ['IsActive', sql.Bit],
};

export function referenceStore(pool, s) {
  async function insert(table, columns, record, map) {
    const fields = Object.keys(columns).filter((field) => field in record);
    const params = Object.fromEntries(fields.map((field) => {
      const [, type, toSql = (value) => value] = columns[field];
      return [field, [type, record[field] === null || record[field] === undefined ? null : toSql(record[field])]];
    }));
    const result = await query(pool, `INSERT ${table} (${fields.map((field) => columns[field][0]).join(', ')})
      OUTPUT inserted.* VALUES (${fields.map((field) => `@${field}`).join(', ')})`, params);
    return map(result.recordset[0]);
  }

  return {
    async listPipelines() {
      const result = await query(pool, `SELECT PipelineCode, PipelineName, IsActive FROM ${s.ref}.Pipeline ORDER BY PipelineCode`);
      return result.recordset.map((row) => ({ code: row.PipelineCode, name: row.PipelineName, isActive: bit(row.IsActive) }));
    },
    async listFileTemplate() {
      const result = await query(pool, `SELECT ColumnOrder, ColumnName, IsMandatory FROM ${s.ref}.FileTemplate ORDER BY ColumnOrder`);
      return result.recordset.map((row) => ({ order: row.ColumnOrder, name: row.ColumnName, mandatory: bit(row.IsMandatory) }));
    },
    async listErrorCodes() {
      const result = await query(pool, `SELECT ErrorCode, ErrorMessage FROM ${s.ref}.ErrorCode ORDER BY ErrorCode`);
      return result.recordset.map((row) => ({ code: row.ErrorCode.trim(), message: row.ErrorMessage }));
    },
    async listDesignations() {
      const result = await query(pool, `SELECT * FROM ${s.ref}.Designation ORDER BY DesignationId`);
      return result.recordset.map(mapDesignation);
    },
    async listContracts() {
      const result = await query(pool, `SELECT * FROM ${s.ref}.Contract ORDER BY ContractId`);
      return result.recordset.map(mapContract);
    },
    createContract: (contract) => insert(`${s.ref}.Contract`, CONTRACT_COLUMNS, contract, mapContract),
  };
}
