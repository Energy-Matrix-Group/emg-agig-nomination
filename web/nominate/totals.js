// Totals of checked rows for each contract and Gas Day, in whole thousandths of a TJ so nothing drifts, for the
// totals table on the New nomination page. Pure, so test/web/totals.test.js runs it without a browser.

const milli = (text) => {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(text ?? ''));
  return match ? Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0')) : null;
};

const text = (value) => `${Math.floor(value / 1000)}.${String(value % 1000).padStart(3, '0')}`;

export function totalsByContractDay(rows, contracts) {
  const groups = new Map();
  for (const row of rows) {
    const quantity = milli(row.quantityTJ);
    if (!row.contract || !row.gasDay || !row.nomType || quantity === null) continue;
    const key = `${row.gasDay}|${row.contract}`;
    const group = groups.get(key) ?? { gasDay: row.gasDay, contract: row.contract, inlet: 0, outlet: 0 };
    if (row.nomType === 'Inlet') group.inlet += quantity;
    else group.outlet += quantity;
    groups.set(key, group);
  }
  const capacity = new Map(contracts.map((contract) => [contract.code, contract.capacityTJ]));
  return [...groups.values()]
    .sort((a, b) => a.gasDay.localeCompare(b.gasDay) || a.contract.localeCompare(b.contract))
    .map((group) => ({ gasDay: group.gasDay, contract: group.contract, inletTJ: text(group.inlet), outletTJ: text(group.outlet), capacityTJ: capacity.get(group.contract) ?? null }));
}
