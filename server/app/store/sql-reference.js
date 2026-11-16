import { bit, dateIn, dateOut, decimalIn, decimalOut, query, setClause, sql, timeOut } from './sql-kit.js';

// Reference data (ref) and Spot awards (nom.SpotAward) in SQL.

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

const mapAward = (row) => ({
  id: row.SpotAwardId,
  gasDay: dateOut(row.GasDay),
  contractCode: row.ContractCode,
  awardedTJ: decimalOut(row.AwardedTJ),
  enteredBy: row.EnteredBy,
  enteredAt: timeOut(row.EnteredAtUtc),
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

const DESIGNATION_COLUMNS = {
  pipelineCode: ['PipelineCode', sql.VarChar(10)],
  code: ['DesignationCode', sql.VarChar(20)],
  direction: ['Direction', sql.VarChar(6)],
  locationName: ['LocationName', sql.NVarChar(100)],
  notes: ['Notes', sql.NVarChar(200)],
  specSection: ['SpecSection', sql.VarChar(10)],
  validFrom: ['ValidFrom', sql.Date, dateIn],
  validTo: ['ValidTo', sql.Date, dateIn],
};

export function referenceStore(pool, s) {
  async function insert(table, columns, record, idColumn, map) {
    const fields = Object.keys(columns).filter((field) => field in record);
    const params = Object.fromEntries(fields.map((field) => {
      const [, type, toSql = (value) => value] = columns[field];
      return [field, [type, record[field] === null || record[field] === undefined ? null : toSql(record[field])]];
    }));
    const result = await query(pool, `INSERT ${table} (${fields.map((field) => columns[field][0]).join(', ')})
      OUTPUT inserted.* VALUES (${fields.map((field) => `@${field}`).join(', ')})`, params);
    return map(result.recordset[0]);
  }

  async function update(table, columns, idColumn, id, patch, map) {
    const set = setClause(patch, columns);
    const result = await query(pool, `UPDATE ${table} SET ${set.text} OUTPUT inserted.* WHERE ${idColumn} = @id`, { ...set.params, id: [sql.Int, id] });
    return result.recordset[0] ? map(result.recordset[0]) : null;
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
    createContract: (contract) => insert(`${s.ref}.Contract`, CONTRACT_COLUMNS, contract, 'ContractId', mapContract),
    updateContract: (id, patch) => update(`${s.ref}.Contract`, CONTRACT_COLUMNS, 'ContractId', id, patch, mapContract),
    createDesignation: (designation) => insert(`${s.ref}.Designation`, DESIGNATION_COLUMNS, designation, 'DesignationId', mapDesignation),
    updateDesignation: (id, patch) => update(`${s.ref}.Designation`, DESIGNATION_COLUMNS, 'DesignationId', id, patch, mapDesignation),

    async listSpotAwards({ from = null, to = null } = {}) {
      const result = await query(pool, `SELECT * FROM ${s.nom}.SpotAward
        WHERE (@from IS NULL OR GasDay >= @from) AND (@to IS NULL OR GasDay <= @to)
        ORDER BY GasDay, ContractCode`, { from: [sql.Date, dateIn(from)], to: [sql.Date, dateIn(to)] });
      return result.recordset.map(mapAward);
    },
    async saveSpotAward({ gasDay, contractCode, awardedTJ, enteredBy }) {
      const result = await query(pool, `
        MERGE ${s.nom}.SpotAward WITH (HOLDLOCK) AS target
        USING (SELECT @gasDay AS GasDay, @contractCode AS ContractCode) AS source
          ON target.GasDay = source.GasDay AND target.ContractCode = source.ContractCode
        WHEN MATCHED THEN UPDATE SET AwardedTJ = @awardedTJ, EnteredBy = @enteredBy, EnteredAtUtc = sysutcdatetime()
        WHEN NOT MATCHED THEN INSERT (GasDay, ContractCode, AwardedTJ, EnteredBy) VALUES (@gasDay, @contractCode, @awardedTJ, @enteredBy)
        OUTPUT inserted.*;`, {
        gasDay: [sql.Date, dateIn(gasDay)],
        contractCode: [sql.VarChar(60), contractCode],
        awardedTJ: [sql.Decimal(12, 3), decimalIn(awardedTJ)],
        enteredBy: [sql.NVarChar(100), enteredBy],
      });
      return mapAward(result.recordset[0]);
    },
    async deleteSpotAward(id) {
      const result = await query(pool, `DELETE FROM ${s.nom}.SpotAward WHERE SpotAwardId = @id`, { id: [sql.Int, id] });
      return result.rowsAffected[0] > 0;
    },
  };
}
