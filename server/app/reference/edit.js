import { actorOf, requireOperator } from '../access.js';
import { audit } from '../batches.js';
import { httpError } from '../../platform/kit.js';
import { formatMilli, parseQuantity } from '../quantity.js';
import { addDays, awstToday, isGasDay } from '../time.js';

// Changing the reference data and the Spot awards, which the design left to SSMS and the workbook's Spot_Award
// tab. Every change is checked here and written to the audit trail (ops.AuditLog) with who made it.

const CONTRACT_CODE = /^[A-Za-z0-9]+_[A-Za-z0-9][A-Za-z0-9_-]{0,58}$/;
const SERVICE_TYPE = /^[A-Za-z0-9]{1,10}$/;
const POINT_CODE = /^[A-Za-z0-9][A-Za-z0-9 -]{0,19}$/;

export async function getReference(app) {
  const [pipelines, contracts, designations, errorCodes, fileTemplate] = await Promise.all([
    app.store.listPipelines(),
    app.store.listContracts(),
    app.store.listDesignations(),
    app.store.listErrorCodes(),
    app.store.listFileTemplate(),
  ]);
  return { pipelines, contracts, designations, errorCodes, fileTemplate };
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function readContract(body, pipelines) {
  const problems = [];
  const code = text(body.code, 60);
  const type = body.type === 'Spot' ? 'Spot' : body.type === 'Transport' ? 'Transport' : null;
  const pipelineCode = text(body.pipelineCode, 10);
  const startDate = text(body.startDate, 10);
  const endDate = text(body.endDate, 10) || null;
  const capacityRaw = body.capacityTJ === null || body.capacityTJ === undefined ? '' : String(body.capacityTJ).trim();
  const capacity = capacityRaw ? parseQuantity(capacityRaw) : null;
  const serviceType = text(body.serviceType, 10) || (type === 'Spot' ? 'SPOT' : '');
  const subServiceType = text(body.subServiceType, 10) || null;
  if (!CONTRACT_CODE.test(code)) problems.push('The contract code is the shipper name, an underscore and the contract reference, as in Shipper1_FH01.');
  if (!type) problems.push('The type is Transport or Spot.');
  if (!pipelines.some((pipeline) => pipeline.code === pipelineCode)) problems.push('Choose one of AGIG\'s pipelines.');
  if (!isGasDay(startDate)) problems.push('The start date is a date, yyyy-mm-dd.');
  if (endDate && (!isGasDay(endDate) || endDate < startDate)) problems.push('The end date is a date on or after the start date, or blank.');
  if (capacity?.error) problems.push(`Contracted capacity: ${capacity.error}`);
  if (!SERVICE_TYPE.test(serviceType)) problems.push('The outlet Service Type is letters and digits, such as T1 or SPOT.');
  if (subServiceType && !SERVICE_TYPE.test(subServiceType)) problems.push('The Sub Service Type is letters and digits, or blank for the same as the Service Type.');
  if (problems.length) throw httpError(400, problems.join(' '));
  return {
    code, type, pipelineCode, startDate, endDate,
    capacityTJ: capacity ? formatMilli(capacity.milli) : null,
    serviceType, subServiceType, isActive: body.isActive !== false,
  };
}

export async function saveContract(app, user, id, body) {
  requireOperator(user);
  const [pipelines, contracts] = await Promise.all([app.store.listPipelines(), app.store.listContracts()]);
  const contract = readContract(body ?? {}, pipelines);
  if (contracts.some((other) => other.code === contract.code && other.id !== id)) throw httpError(409, `There is already a contract ${contract.code}.`);
  let saved;
  if (id === null) {
    saved = await app.store.createContract(contract);
    await audit(app, user, 'contract.create', saved.id, describe(contract), 'Contract');
  } else {
    const before = contracts.find((other) => other.id === id);
    if (!before) throw httpError(404, 'There is no such contract.');
    saved = await app.store.updateContract(id, contract);
    const changed = Object.keys(contract).filter((key) => String(before[key] ?? '') !== String(contract[key] ?? ''));
    await audit(app, user, 'contract.update', id, changed.length ? changed.map((key) => `${key}: ${before[key] ?? '-'} to ${contract[key] ?? '-'}`).join('; ') : 'no change', 'Contract');
  }
  return { contract: saved };
}

function describe(contract) {
  return `${contract.code}, ${contract.type}, ${contract.pipelineCode}, ${contract.startDate} to ${contract.endDate ?? 'open'}, capacity ${contract.capacityTJ ?? '-'} TJ, ${contract.serviceType}`;
}

// A new point, or a new version of one AGIG renamed (same code, a later ValidFrom). An existing point only ever
// gets a new name, notes or an end date: its code, pipeline and start stay, because old batches refer to them.
export async function saveDesignation(app, user, id, body = {}) {
  requireOperator(user);
  const designations = await app.store.listDesignations();
  const locationName = text(body.locationName, 100);
  const notes = text(body.notes, 200) || null;
  const validTo = text(body.validTo, 10) || null;
  if (id !== null) {
    const before = designations.find((designation) => designation.id === id);
    if (!before) throw httpError(404, 'There is no such point.');
    if (!locationName) throw httpError(400, 'The location name is needed.');
    if (validTo && (!isGasDay(validTo) || validTo < before.validFrom)) throw httpError(400, 'The end date is a date on or after the start date, or blank.');
    const saved = await app.store.updateDesignation(id, { locationName, notes, validTo });
    await audit(app, user, 'designation.update', id, `${before.code}: ${before.locationName} to ${locationName}; valid to ${before.validTo ?? 'open'} to ${validTo ?? 'open'}`, 'Designation');
    return { designation: saved };
  }
  const pipelines = await app.store.listPipelines();
  const point = {
    pipelineCode: text(body.pipelineCode, 10),
    code: text(body.code, 20),
    direction: body.direction === 'Inlet' || body.direction === 'Outlet' ? body.direction : null,
    locationName,
    notes,
    specSection: text(body.specSection, 10) || null,
    validFrom: text(body.validFrom, 10),
    validTo,
  };
  const problems = [];
  if (!pipelines.some((pipeline) => pipeline.code === point.pipelineCode)) problems.push('Choose one of AGIG\'s pipelines.');
  if (!POINT_CODE.test(point.code)) problems.push('The designation code is letters, digits, spaces and hyphens, at most 20.');
  if (!point.direction) problems.push('The direction is Inlet or Outlet.');
  if (!point.locationName) problems.push('The location name is needed.');
  if (!isGasDay(point.validFrom)) problems.push('Valid from is a date, yyyy-mm-dd.');
  if (point.validTo && (!isGasDay(point.validTo) || point.validTo < point.validFrom)) problems.push('Valid to is a date on or after valid from, or blank.');
  if (problems.length) throw httpError(400, problems.join(' '));
  if (designations.some((other) => other.pipelineCode === point.pipelineCode && other.code === point.code && other.validFrom === point.validFrom)) {
    throw httpError(409, `${point.code} on ${point.pipelineCode} already starts on ${point.validFrom}.`);
  }
  const saved = await app.store.createDesignation(point);
  await audit(app, user, 'designation.create', saved.id, `${point.pipelineCode} ${point.code} (${point.direction}) ${point.locationName} from ${point.validFrom}`, 'Designation');
  return { designation: saved };
}

// Spot awards: what AGIG awarded for each Gas Day on a Spot contract, typed in by the ops team once the award is
// received. The checks refuse Spot lines above it (AGIG 528).
export async function listSpotAwards(app, query) {
  const today = awstToday(app.clock());
  const from = isGasDay(query.get('from')) ? query.get('from') : addDays(today, -7);
  const to = isGasDay(query.get('to')) ? query.get('to') : addDays(today, 30);
  return { from, to, awards: await app.store.listSpotAwards({ from, to }) };
}

export async function saveSpotAward(app, user, body = {}) {
  requireOperator(user);
  const gasDay = text(body.gasDay, 10);
  const contractCode = text(body.contractCode, 60);
  const quantity = parseQuantity(body.awardedTJ);
  const contract = (await app.store.listContracts()).find((candidate) => candidate.code === contractCode);
  if (!isGasDay(gasDay)) throw httpError(400, 'The Gas Day is a date, yyyy-mm-dd.');
  if (contract?.type !== 'Spot') throw httpError(400, 'Choose a Spot contract.');
  if (quantity.error) throw httpError(400, `Awarded quantity: ${quantity.error}`);
  const award = await app.store.saveSpotAward({ gasDay, contractCode, awardedTJ: formatMilli(quantity.milli), enteredBy: actorOf(user) });
  await audit(app, user, 'spot-award.save', award.id, `${contractCode} ${gasDay}: ${award.awardedTJ} TJ`, 'SpotAward');
  return { award };
}

export async function deleteSpotAward(app, user, id) {
  requireOperator(user);
  const award = (await app.store.listSpotAwards({})).find((candidate) => candidate.id === id);
  if (!award || !await app.store.deleteSpotAward(id)) throw httpError(404, 'There is no such Spot award.');
  await audit(app, user, 'spot-award.delete', id, `${award.contractCode} ${award.gasDay}: ${award.awardedTJ} TJ`, 'SpotAward');
  return { deleted: true };
}
