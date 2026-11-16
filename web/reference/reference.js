import { act, api, API, badge, button, el, fill, panel, showMessage, startPage, table } from '/shared.js';

// Reference data: the shipper's contracts (added and changed here), AGIG's points (a new point, or a new version
// of one AGIG renamed, and an end date for the old one), the error codes and the SHNOM template. Every change is
// in the audit trail on the System page. In the design this was SSMS.

const content = document.querySelector('[data-content]');
const pointFilter = { pipeline: 'DBNGP', direction: '', text: '' };
let data = null;

const page = await startPage('reference');
if (page) await draw();

async function draw() {
  const result = await api(`${API}/reference`);
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  data = result.data;
  fill(content,
    panel('Contracts', contractsTable(), page.session.canOperate ? contractForm() : null),
    panel('Points (designations, spec Appendix A)', pointsSection()),
    panel('AGIG error codes (Appendix J.5)', table(['Code', 'Meaning'], data.errorCodes.map((code) => el('tr', {}, el('td', { class: 'mono' }, code.code), el('td', {}, code.message))))),
    panel('SHNOM file header (Appendix B)', el('p', { class: 'mono small' }, data.fileTemplate.map((column) => column.name).join(',')),
      el('p', { class: 'muted small' }, 'Every file starts with exactly this line. It is kept in ref.FileTemplate, so if AGIG changes its template the database administrator changes that table.')),
  );
}

function contractsTable() {
  return table(['Code', 'Type', 'Pipeline', 'From', 'To', { label: 'Capacity (TJ)', numeric: true }, 'Service type', 'Status', ''],
    data.contracts.map((contract) => el('tr', {},
      el('td', { class: 'mono' }, contract.code), el('td', {}, contract.type), el('td', {}, contract.pipelineCode),
      el('td', { class: 'nowrap' }, contract.startDate), el('td', { class: 'nowrap' }, contract.endDate ?? 'Open'),
      el('td', { class: 'num' }, contract.capacityTJ ?? '—'),
      el('td', {}, contract.serviceType ?? '', contract.subServiceType ? ` / ${contract.subServiceType}` : ''),
      el('td', {}, contract.isActive ? badge('Active', 'good') : badge('Inactive', 'closed')),
      el('td', {}, page.session.canOperate ? button('Edit', () => {
        const form = contractForm(contract);
        content.querySelector('[data-contract-form]').replaceWith(form);
        form.scrollIntoView({ block: 'center' });
        form.querySelector('input')?.focus();
      }, { quiet: true, small: true }) : ''),
    )), { empty: 'No contracts yet. Add the shipper\'s contracts below: the checks need them.' });
}

function contractForm(contract = null) {
  const field = (label, input, hint) => el('label', {}, label, input, hint ? el('span', { class: 'muted small' }, hint) : null);
  const code = el('input', { required: true, value: contract?.code ?? '', placeholder: 'Shipper1_FH01', maxlength: '60' });
  const type = el('select', {}, ['Transport', 'Spot'].map((value) => el('option', { value, selected: contract?.type === value }, value)));
  const pipeline = el('select', {}, data.pipelines.map((item) => el('option', { value: item.code, selected: (contract?.pipelineCode ?? 'DBNGP') === item.code }, `${item.code} · ${item.name}`)));
  const start = el('input', { type: 'date', required: true, value: contract?.startDate ?? '' });
  const end = el('input', { type: 'date', value: contract?.endDate ?? '' });
  const capacity = el('input', { inputmode: 'decimal', value: contract?.capacityTJ ?? '', placeholder: 'Blank for Spot' });
  const service = el('input', { value: contract?.serviceType ?? '', placeholder: 'T1, P1 or SPOT', maxlength: '10' });
  const subService = el('input', { value: contract?.subServiceType ?? '', placeholder: 'Blank: same as Service', maxlength: '10' });
  const active = el('input', { type: 'checkbox', checked: contract ? contract.isActive : true });
  const save = button(contract ? `Save ${contract.code}` : 'Add the contract', null, { type: 'submit' });
  return el('form', { class: 'form-grid', dataset: { contractForm: '' }, onsubmit: async (event) => {
    event.preventDefault();
    const body = { code: code.value, type: type.value, pipelineCode: pipeline.value, startDate: start.value, endDate: end.value || null, capacityTJ: capacity.value || null, serviceType: service.value, subServiceType: subService.value || null, isActive: active.checked };
    const result = await act(save, () => api(contract ? `${API}/contracts/${contract.id}` : `${API}/contracts`, { method: contract ? 'PUT' : 'POST', body }));
    if (result.ok) {
      await draw();
      showMessage(`Saved ${result.data.contract.code}.`, { ok: true });
    }
  } },
  el('h3', { class: 'wide' }, contract ? `Edit ${contract.code}` : 'Add a contract'),
  field('Contract code', code, 'The shipper name, an underscore, the reference'), field('Type', type), field('Pipeline', pipeline),
  field('Starts', start), field('Ends', end, 'Blank if open'), field('Contracted capacity (TJ)', capacity, 'Outlet total limit (522)'),
  field('Outlet Service Type', service), field('Sub Service Type', subService),
  el('label', { class: 'inline-check' }, active, 'Active'),
  el('div', { class: 'toolbar wide' }, save, contract ? button('Cancel', () => draw(), { quiet: true }) : null));
}

function pointsSection() {
  const list = el('div');
  const paint = () => {
    const text = pointFilter.text.trim().toLowerCase();
    const points = data.designations
      .filter((point) => !pointFilter.pipeline || point.pipelineCode === pointFilter.pipeline)
      .filter((point) => !pointFilter.direction || point.direction === pointFilter.direction)
      .filter((point) => !text || `${point.code} ${point.locationName} ${point.notes ?? ''}`.toLowerCase().includes(text));
    list.replaceChildren(table(['Code', 'Pipeline', 'Direction', 'Location', 'Notes', 'Valid', ''],
      points.map((point) => el('tr', {},
        el('td', { class: 'mono' }, point.code), el('td', {}, point.pipelineCode), el('td', {}, point.direction),
        el('td', {}, point.locationName), el('td', { class: 'small muted' }, point.notes ?? ''),
        el('td', { class: 'small nowrap' }, `${point.validFrom} to ${point.validTo ?? 'open'}`),
        el('td', {}, page.session.canOperate ? button('Edit', () => editPoint(point), { quiet: true, small: true }) : ''),
      )), { empty: 'No points match.' }));
  };
  const pipeline = el('select', { onchange: (event) => { pointFilter.pipeline = event.target.value; paint(); } },
    el('option', { value: '' }, 'All pipelines'), data.pipelines.map((item) => el('option', { value: item.code, selected: item.code === pointFilter.pipeline }, item.code)));
  const direction = el('select', { onchange: (event) => { pointFilter.direction = event.target.value; paint(); } },
    ['', 'Inlet', 'Outlet'].map((value) => el('option', { value, selected: value === pointFilter.direction }, value || 'Inlets and outlets')));
  const search = el('input', { type: 'search', value: pointFilter.text, placeholder: 'Code or name', oninput: (event) => { pointFilter.text = event.target.value; paint(); } });
  paint();
  return el('div', { class: 'emg-stack' },
    el('div', { class: 'filters' }, el('label', {}, 'Pipeline', pipeline), el('label', {}, 'Direction', direction), el('label', {}, 'Search', search),
      page.session.canOperate ? button('Add a point', () => addPoint(), { quiet: true }) : null),
    list);
}

function editPoint(point) {
  const name = window.prompt(`Location name for ${point.code}:`, point.locationName);
  if (name === null) return;
  const validTo = window.prompt(`Last Gas Day ${point.code} is valid (yyyy-mm-dd), or blank if it stays open. When AGIG renames a point, end the old one here and add the new name as a new point from the next day.`, point.validTo ?? '');
  if (validTo === null) return;
  save(`${API}/designations/${point.id}`, 'PUT', { locationName: name, notes: point.notes, validTo: validTo.trim() || null });
}

function addPoint() {
  const code = window.prompt('Designation code, exactly as AGIG writes it (for example OS5-01):');
  if (!code) return;
  const pipelineCode = window.prompt('Pipeline (DBNGP, AOGP, FRGP, TNP or WAWP):', pointFilter.pipeline || 'DBNGP');
  const direction = window.prompt('Inlet or Outlet:', 'Outlet');
  const locationName = window.prompt('Location name:');
  const validFrom = window.prompt('First Gas Day it is valid (yyyy-mm-dd):', page.session.today);
  if (!pipelineCode || !direction || !locationName || !validFrom) return;
  save(`${API}/designations`, 'POST', { code, pipelineCode, direction, locationName, validFrom });
}

async function save(path, method, body) {
  const result = await api(path, { method, body });
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  await draw();
  showMessage(`Saved ${result.data.designation.code}.`, { ok: true });
}
