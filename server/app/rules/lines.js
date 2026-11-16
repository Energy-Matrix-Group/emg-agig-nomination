import { parseQuantity } from '../quantity.js';
import { isGasDay } from '../time.js';

// A nomination line as people enter it, and the SHNOM row it becomes.
//
// People give four things for each line: the Gas Day, the contract, the designation and the quantity (and a note
// of their own, never sent). Everything else in the row comes from the reference data, as the workbook's
// formulas filled it: the Shipper is the part of the contract code before the underscore (Shipper1_FH01), the
// Pipeline is the contract's, the Nom Type is the designation's direction, the outlet Service Type and Sub Service
// Type are the contract's, and the Designation Location is the point's name. Marketer is kept as given, so the
// check can say it must be blank (AGIG 515).

export const MAX_LINES = 2000;
const LIMITS = { gasDay: 40, contract: 60, designation: 20, quantity: 40, marketer: 50, note: 400 };

// Trims a line from the browser to the fields the app takes, as text, cut to sensible lengths.
export function cleanLine(raw) {
  const line = {};
  for (const [field, max] of Object.entries(LIMITS)) {
    line[field] = typeof raw?.[field] === 'string' || typeof raw?.[field] === 'number' ? String(raw[field]).trim().slice(0, max) : '';
  }
  return line;
}

// Reference data indexed for the lookups below.
export function indexReference({ contracts, designations }) {
  const contractByCode = new Map(contracts.map((contract) => [contract.code, contract]));
  const designationsByCode = new Map();
  for (const designation of designations) {
    const list = designationsByCode.get(designation.code) ?? [];
    list.push(designation);
    designationsByCode.set(designation.code, list);
  }
  return { contractByCode, designationsByCode };
}

export function isValidOn(record, day, fromField = 'validFrom', toField = 'validTo') {
  return record[fromField] <= day && (!record[toField] || day <= record[toField]);
}

// The point a line means: the one with that code on the contract's pipeline that is valid on the Gas Day, else
// one on that pipeline that is valid on another day, else one with that code on another pipeline.
export function findDesignation(index, code, pipelineCode, day) {
  const candidates = index.designationsByCode.get(code) ?? [];
  const onPipeline = candidates.filter((designation) => designation.pipelineCode === pipelineCode);
  return onPipeline.find((designation) => isGasDay(day) && isValidOn(designation, day))
    ?? onPipeline[0]
    ?? candidates[0]
    ?? null;
}

export function shipperOf(contractCode) {
  const at = String(contractCode ?? '').indexOf('_');
  return at > 0 ? contractCode.slice(0, at) : '';
}

// The full SHNOM row for a line, with what was found on the way (for the checks).
export function enrichLine(line, index) {
  const contract = index.contractByCode.get(line.contract) ?? null;
  const pipeline = contract?.pipelineCode ?? '';
  const designation = line.designation ? findDesignation(index, line.designation, pipeline, line.gasDay) : null;
  const nomType = designation?.direction ?? '';
  const outlet = nomType === 'Outlet';
  const quantity = parseQuantity(line.quantity);
  return {
    ...line,
    shipper: shipperOf(line.contract),
    pipeline,
    nomType,
    serviceType: outlet ? contract?.serviceType ?? '' : '',
    subServiceType: outlet ? contract?.subServiceType || contract?.serviceType || '' : '',
    designationLocation: designation?.locationName ?? '',
    quantityMilli: quantity.milli ?? null,
    found: { contract, designation, quantityError: quantity.error ?? null },
  };
}

// The row as it is stored and sent: the eleven SHNOM fields, the quantity as three-decimal text, and the note.
export function shnomRow(enriched, csvLineNumber, formatMilli) {
  return {
    csvLineNumber,
    gasDay: enriched.gasDay,
    shipper: enriched.shipper,
    pipeline: enriched.pipeline,
    contract: enriched.contract,
    nomType: enriched.nomType,
    marketer: enriched.marketer || null,
    serviceType: enriched.serviceType || null,
    subServiceType: enriched.subServiceType || null,
    designation: enriched.designation,
    designationLocation: enriched.designationLocation || null,
    quantityTJ: formatMilli(enriched.quantityMilli),
    note: enriched.note || null,
  };
}

// What makes two rows the same line for AGIG: the Gas Day, contract, Nom Type and designation (the design's
// duplicate rule, and the key nom.vAcceptedNomination ranks by).
export function lineKey(row) {
  return [row.gasDay, row.contract, row.nomType, row.designation, row.marketer ?? '', row.serviceType ?? ''].join('|');
}
