import { formatMilli, toMilli } from '../quantity.js';
import { ADVANCE_DAYS, awstToday, daysBetween, initialCutoff, isGasDay, renominationCutoff } from '../time.js';
import { enrichLine, indexReference, isValidOn, MAX_LINES } from './lines.js';

// Every rule a nomination is checked against before anything is sent. It is the workbook's Check column and the
// design's nom.usp_ValidateBatch in one place, and it runs twice: live while people enter lines (POST .../check)
// and again when they publish, so a batch with an error is never made. Each rule carries the AGIG error code it
// mirrors where there is one, so the problem found here is the one AGIG would have returned.
//
// Left to AGIG, as the design decided: whether a point is on the contract (505, 507: the ops team pairs contracts
// with points from the contract schedule), point minimums and limits (516, 518, 521), and whether every
// contracted point is present (527). AGIG's response reports those.
//
// Answers { rows, issues }: rows are the lines with every SHNOM field filled in; each issue is
// { line, lines, rule, severity, message }, where `line` is the 0-based line it belongs to (or null for a total)
// and `lines` lists the lines a total was made from.

export function checkLines(lines, { contracts, designations, spotAwards = [], now }) {
  const index = indexReference({ contracts, designations });
  const rows = lines.map((line) => enrichLine(line, index));
  const issues = [];
  const add = (line, rule, severity, message, group = null) => issues.push({ line, lines: group, rule, severity, message });

  if (rows.length === 0) add(null, 'EMPTY', 'Error', 'There are no lines to publish.');
  if (rows.length > MAX_LINES) add(null, 'SIZE', 'Error', `A batch can hold at most ${MAX_LINES} lines; this one has ${rows.length}.`);

  const today = awstToday(now);
  const seen = new Map();
  rows.forEach((row, line) => {
    const label = `Line ${line + 1}`;
    const { contract, designation, quantityError } = row.found;
    const day = row.gasDay;
    const dayOk = isGasDay(day);
    if (!day) add(line, '510', 'Error', `${label}: the Gas Day is missing.`);
    else if (!dayOk) add(line, '510', 'Error', `${label}: "${day}" is not a Gas Day (yyyy-mm-dd).`);

    if (!row.contract) add(line, '512', 'Error', `${label}: the contract is missing.`);
    else if (!contract) add(line, '512', 'Error', `${label}: ${row.contract} is not a known contract.`);
    else if (!contract.isActive) add(line, '512', 'Error', `${label}: ${row.contract} is not active.`);
    else if (dayOk && !isValidOn(contract, day, 'startDate', 'endDate')) {
      add(line, '512', 'Error', `${label}: ${row.contract} runs ${contract.startDate} to ${contract.endDate ?? 'open'}, so it does not cover ${day}.`);
    }

    if (!row.designation) add(line, '504/506', 'Error', `${label}: the designation is missing.`);
    else if (!designation) add(line, '504/506', 'Error', `${label}: ${row.designation} is not an AGIG point.`);
    else if (contract) {
      const pointRule = designation.direction === 'Inlet' ? '505' : '507';
      if (designation.pipelineCode !== contract.pipelineCode) {
        add(line, pointRule, 'Error', `${label}: ${row.designation} is on ${designation.pipelineCode}, not on ${contract.pipelineCode}, the pipeline of ${row.contract}.`);
      } else if (dayOk && !isValidOn(designation, day)) {
        add(line, pointRule, 'Error', `${label}: ${row.designation} is not a current point on ${day}.`);
      } else if (contract.type === 'Spot' && designation.direction === 'Inlet') {
        add(line, '505', 'Error', `${label}: ${row.contract} is a Spot contract, which takes outlet points only.`);
      }
      if (designation.direction === 'Outlet' && !contract.serviceType) {
        add(line, '519', 'Error', `${label}: ${row.contract} has no outlet Service Type. Add it on the Reference data page.`);
      }
    }

    if (quantityError) add(line, '503', 'Error', `${label}: ${quantityError}`);
    if (row.marketer) add(line, '515', 'Error', `${label}: Marketer must be blank.`);

    if (dayOk) {
      if (now > renominationCutoff(day)) add(line, '502', 'Error', `${label}: past the 20:00 cutoff for Gas Day ${day}.`);
      else if (daysBetween(today, day) > ADVANCE_DAYS) add(line, '508', 'Error', `${label}: ${day} is more than ${ADVANCE_DAYS} days ahead.`);
      else if (now > initialCutoff(day)) add(line, 'RENOM', 'Warning', `${label}: after 14:00 the day before ${day}, so AGIG treats it as a renomination.`);
    }

    if (dayOk && row.contract && row.designation) {
      const key = [day, row.contract, row.nomType, row.designation].join('|');
      if (seen.has(key)) add(line, 'DUP', 'Error', `${label}: the same Gas Day, contract and designation as line ${seen.get(key) + 1}.`);
      else seen.set(key, line);
    }
  });

  // Totals for each contract and Gas Day, over the lines whose contract, point and quantity are known.
  const groups = new Map();
  rows.forEach((row, line) => {
    if (!row.found.contract || !row.nomType || row.quantityMilli === null || !isGasDay(row.gasDay)) return;
    const key = `${row.contract}|${row.gasDay}`;
    const group = groups.get(key) ?? { contract: row.found.contract, day: row.gasDay, inlet: 0, outlet: 0, inletLines: [], outletLines: [] };
    if (row.nomType === 'Inlet') {
      group.inlet += row.quantityMilli;
      group.inletLines.push(line);
    } else {
      group.outlet += row.quantityMilli;
      group.outletLines.push(line);
    }
    groups.set(key, group);
  });
  const awards = new Map(spotAwards.map((award) => [`${award.contractCode}|${award.gasDay}`, award]));
  for (const group of groups.values()) {
    const { contract, day } = group;
    const where = `${contract.code} on ${day}`;
    if (contract.type === 'Spot') {
      const award = awards.get(`${contract.code}|${day}`);
      const awarded = award ? toMilli(award.awardedTJ) ?? 0 : 0;
      if (group.outlet > awarded) {
        const message = award
          ? `${where}: Spot lines total ${formatMilli(group.outlet)} TJ, more than the ${formatMilli(awarded)} TJ awarded.`
          : `${where}: Spot lines total ${formatMilli(group.outlet)} TJ, but no Spot award is entered for that day.`;
        add(null, '528', 'Error', message, group.outletLines);
      }
      continue;
    }
    const capacity = toMilli(contract.capacityTJ);
    if (capacity !== null && group.outlet > capacity) {
      add(null, '522', 'Error', `${where}: outlets total ${formatMilli(group.outlet)} TJ, more than the contracted ${formatMilli(capacity)} TJ.`, group.outletLines);
    }
    if (group.outlet > group.inlet) {
      add(null, '524', 'Warning', `${where}: outlets total ${formatMilli(group.outlet)} TJ, more than the inlets' ${formatMilli(group.inlet)} TJ.`, [...group.inletLines, ...group.outletLines]);
    }
  }

  return { rows, issues };
}

export function countIssues(issues) {
  return {
    errors: issues.filter((issue) => issue.severity === 'Error').length,
    warnings: issues.filter((issue) => issue.severity === 'Warning').length,
  };
}
