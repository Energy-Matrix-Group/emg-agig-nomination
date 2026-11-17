import { api, API, badge, el, fill, panel, showMessage, startPage, table } from '/shared.js';

// Reference data, read-only: the shipper's contracts, AGIG's points, the error codes and the SHNOM header, as the
// worker checks against them. The database administrator keeps them (the design's SQL scripts).

const content = document.querySelector('[data-content]');
const pointFilter = { pipeline: 'DBNGP', direction: '', text: '' };

const page = await startPage('reference');
if (page) await draw();

async function draw() {
  const result = await api(`${API}/reference`);
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  const data = result.data;
  fill(content,
    panel('Contracts', table(['Code', 'Type', 'Pipeline', 'From', 'To', { label: 'Capacity (TJ)', numeric: true }, 'Service type', 'Status'],
      data.contracts.map((contract) => el('tr', {},
        el('td', { class: 'mono' }, contract.code), el('td', {}, contract.type), el('td', {}, contract.pipelineCode),
        el('td', { class: 'nowrap' }, contract.startDate), el('td', { class: 'nowrap' }, contract.endDate ?? 'Open'),
        el('td', { class: 'num' }, contract.capacityTJ ?? '—'),
        el('td', {}, contract.serviceType ?? '', contract.subServiceType ? ` / ${contract.subServiceType}` : ''),
        el('td', {}, contract.isActive ? badge('Active', 'good') : badge('Inactive', 'closed')))),
      { empty: 'No contracts in ref.Contract yet. The database administrator adds them.' })),
    panel('Points (designations, spec Appendix A)', pointsSection(data)),
    panel('Pipelines', table(['Code', 'Name'], data.pipelines.map((pipeline) => el('tr', {}, el('td', { class: 'mono' }, pipeline.code), el('td', {}, pipeline.name))))),
    panel('AGIG error codes (Appendix J.5)', table(['Code', 'Meaning'], data.errorCodes.map((code) => el('tr', {}, el('td', { class: 'mono' }, code.code), el('td', {}, code.message))))),
    panel('SHNOM file header (Appendix B)', el('p', { class: 'mono small' }, data.fileTemplate.map((column) => column.name).join(',')),
      el('p', { class: 'muted small' }, 'Every file starts with exactly this line, from ref.FileTemplate.')),
  );
}

function pointsSection(data) {
  const list = el('div');
  const paint = () => {
    const text = pointFilter.text.trim().toLowerCase();
    const points = data.designations
      .filter((point) => !pointFilter.pipeline || point.pipelineCode === pointFilter.pipeline)
      .filter((point) => !pointFilter.direction || point.direction === pointFilter.direction)
      .filter((point) => !text || `${point.code} ${point.locationName} ${point.notes ?? ''}`.toLowerCase().includes(text));
    list.replaceChildren(
      el('p', { class: 'muted small' }, `${points.length} of ${data.designations.length} points.`),
      table(['Code', 'Pipeline', 'Direction', 'Location', 'Notes', 'Valid'],
        points.map((point) => el('tr', {},
          el('td', { class: 'mono' }, point.code), el('td', {}, point.pipelineCode), el('td', {}, point.direction),
          el('td', {}, point.locationName), el('td', { class: 'small muted' }, point.notes ?? ''),
          el('td', { class: 'small nowrap' }, `${point.validFrom} to ${point.validTo ?? 'open'}`))),
        { empty: 'No points match.' }),
    );
  };
  const pipeline = el('select', { onchange: (event) => { pointFilter.pipeline = event.target.value; paint(); } },
    el('option', { value: '' }, 'All pipelines'), data.pipelines.map((item) => el('option', { value: item.code, selected: item.code === pointFilter.pipeline }, item.code)));
  const direction = el('select', { onchange: (event) => { pointFilter.direction = event.target.value; paint(); } },
    ['', 'Inlet', 'Outlet'].map((value) => el('option', { value, selected: value === pointFilter.direction }, value || 'Inlets and outlets')));
  const search = el('input', { type: 'search', value: pointFilter.text, placeholder: 'Code or name', oninput: (event) => { pointFilter.text = event.target.value; paint(); } });
  paint();
  return el('div', { class: 'emg-stack' }, el('div', { class: 'filters' }, el('label', {}, 'Pipeline', pipeline), el('label', {}, 'Direction', direction), el('label', {}, 'Search', search)), list);
}
