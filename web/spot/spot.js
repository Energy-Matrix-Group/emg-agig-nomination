import { act, api, API, button, dayLabel, el, fill, panel, showMessage, startPage, table, when } from '/shared.js';

// Spot awards: the workbook's Spot_Award tab. The ops team types what AGIG awarded on each Spot contract for a Gas
// Day once the award is received; the checks then refuse Spot lines above it (528).

const content = document.querySelector('[data-content]');
const list = el('div');

const page = await startPage('spot');
if (page) await draw();

async function draw() {
  const [reference, awards] = await Promise.all([api(`${API}/reference`), api(`${API}/spot-awards`)]);
  if (!reference.ok || !awards.ok) {
    showMessage((reference.ok ? awards : reference).data.error);
    return;
  }
  const spotContracts = reference.data.contracts.filter((contract) => contract.type === 'Spot' && contract.isActive);
  const gasDay = el('input', { type: 'date', required: true, value: page.session.today });
  const contract = el('select', { required: true }, spotContracts.map((item) => el('option', { value: item.code }, item.code)));
  const awarded = el('input', { type: 'text', inputmode: 'decimal', required: true, placeholder: '0.000' });
  const save = button('Save the award', null, { type: 'submit' });
  const form = el('form', { class: 'form-grid', onsubmit: async (event) => {
    event.preventDefault();
    const result = await act(save, () => api(`${API}/spot-awards`, { method: 'PUT', body: { gasDay: gasDay.value, contractCode: contract.value, awardedTJ: awarded.value } }));
    if (result.ok) {
      showMessage(`Saved: ${result.data.award.awardedTJ} TJ on ${result.data.award.contractCode} for ${result.data.award.gasDay}.`, { ok: true });
      awarded.value = '';
      await draw();
    }
  } }, el('label', {}, 'Gas Day', gasDay), el('label', {}, 'Spot contract', contract), el('label', {}, 'Awarded (TJ)', awarded), save);

  fill(content,
    page.session.canOperate
      ? (spotContracts.length ? panel('Enter an award', form, el('p', { class: 'muted small' }, 'Saving the same Gas Day and contract again changes the award.')) : el('p', { class: 'emg-callout emg-callout--info' }, 'There is no active Spot contract. Add one on the Reference data page.'))
      : el('p', { class: 'emg-callout emg-callout--info' }, 'Only the ops team can enter Spot awards.'),
    panel(`Awards from ${dayLabel(awards.data.from)} to ${dayLabel(awards.data.to)}`, list),
  );
  list.replaceChildren(table(['Gas Day', 'Contract', { label: 'Awarded (TJ)', numeric: true }, 'Entered', ''],
    awards.data.awards.map((award) => el('tr', {},
      el('td', {}, `${dayLabel(award.gasDay)} (${award.gasDay})`),
      el('td', {}, award.contractCode),
      el('td', { class: 'num' }, award.awardedTJ),
      el('td', { class: 'small' }, when(award.enteredAt), el('br'), el('span', { class: 'muted' }, award.enteredBy)),
      el('td', {}, page.session.canOperate ? removeButton(award) : ''),
    )), { empty: 'No Spot awards in this period.' }));
}

function removeButton(award) {
  const remove = button('Delete', async () => {
    if (!window.confirm(`Delete the ${award.awardedTJ} TJ award for ${award.gasDay}?`)) return;
    const result = await act(remove, () => api(`${API}/spot-awards/${award.id}`, { method: 'DELETE' }));
    if (result.ok) await draw();
  }, { quiet: true, small: true });
  return remove;
}
