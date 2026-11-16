import { act, api, API, badge, button, dayLabel, el, fill, flash, panel, readFileText, showMessage, startPage, table } from '/shared.js';
import { totalsByContractDay } from '/nominate/totals.js';

// New nomination: the workbook's B2B_Export table, Check column and Publish button in one page. People type lines,
// paste rows copied from the workbook, upload a CSV, or start from a day AGIG accepted. Every change is checked by
// the server a moment later (the same rules publishing uses), and the first problem on each line shows in its
// Check cell. The lines are kept in this browser until they are published, so a refresh loses nothing.

const DRAFT_KEY = 'agig-nomination-draft';
const content = document.querySelector('[data-content]');
let lines = loadDraft();
let reference = { contracts: [], designations: [] };
let checked = null;
let checkTimer = null;
let checkRun = 0;
let confirmWarnings = false;
let source = { kind: 'grid' };
const body = el('tbody');
const summary = el('div', { class: 'summary' });
const issuesBox = el('div');
const totalsBox = el('div');
const publishBox = el('div', { class: 'toolbar' });

const page = await startPage('nominate');
if (page) await start();

async function start() {
  const result = await api(`${API}/reference`);
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  reference = result.data;
  if (!page.session.canOperate) showMessage('You can try lines here, but only the ops team can publish them.');
  if (!reference.contracts.some((contract) => contract.isActive)) {
    fill(content, el('div', { class: 'emg-empty' }, el('strong', {}, 'No contracts yet'), el('p', {}, 'Add the shipper\'s contracts on the Reference data page first.'), el('a', { class: 'emg-btn', href: '/reference/' }, 'Reference data')));
    return;
  }
  if (!lines.length) lines = [blankLine()];
  fill(content,
    toolbar(),
    el('div', { class: 'table-wrap' }, el('table', { class: 'grid-table' },
      el('thead', {}, el('tr', {}, ['#', 'Gas Day', 'Contract', 'Designation', 'TJ', 'Filled in', 'Note', 'Check', ''].map((label) => el('th', { scope: 'col' }, label)))),
      body)),
    el('div', { class: 'toolbar' }, button('Add line', () => addLine(), { quiet: true }), summary),
    issuesBox,
    totalsBox,
    publishBox,
  );
  drawRows();
  scheduleCheck(0);
}

function blankLine(from = null) {
  return { gasDay: from?.gasDay ?? page.session.today, contract: from?.contract ?? activeContracts()[0]?.code ?? '', designation: '', quantity: '', note: '' };
}

// A line someone has started: the starter line already carries a Gas Day and a contract, so those do not count.
function hasContent(line) {
  return Boolean(line.designation || line.quantity || line.note);
}

function activeContracts() {
  return reference.contracts.filter((contract) => contract.isActive);
}

function toolbar() {
  const fileInput = el('input', { type: 'file', accept: '.csv,text/csv,.txt', class: 'sr-only', onchange: async () => {
    const [file] = fileInput.files;
    if (file) await readText(await readFileText(file), { kind: 'file', name: file.name });
    fileInput.value = '';
  } });
  return el('div', { class: 'toolbar' },
    button('Paste from Excel', openPaste),
    button('Upload CSV', () => fileInput.click(), { quiet: true }),
    button('Copy a Gas Day AGIG accepted', openCopy, { quiet: true }),
    fileInput,
    el('span', { class: 'spacer' }),
    button('Clear all', () => {
      lines = [blankLine()];
      source = { kind: 'grid' };
      changed(true);
    }, { quiet: true }));
}

function drawRows() {
  body.replaceChildren(...lines.map((line, index) => rowFor(line, index)));
  paintCheck();
}

function rowFor(line, index) {
  const set = (field, value) => {
    lines[index][field] = value;
    changed(false);
  };
  const designation = el('select', { 'aria-label': `Line ${index + 1} designation`, onchange: (event) => set('designation', event.target.value) });
  const fillDesignations = () => designation.replaceChildren(...designationOptions(lines[index]));
  const contract = el('select', { 'aria-label': `Line ${index + 1} contract`, onchange: (event) => { set('contract', event.target.value); fillDesignations(); } },
    el('option', { value: '' }, 'Choose'),
    ...withCurrent(activeContracts().map((item) => item.code), line.contract).map((code) => el('option', { value: code, selected: code === line.contract }, code)));
  fillDesignations();
  return el('tr', { dataset: { line: String(index) } },
    el('td', { class: 'muted' }, String(index + 1)),
    el('td', { class: 'day' }, el('input', { type: 'date', value: line.gasDay, 'aria-label': `Line ${index + 1} Gas Day`, onchange: (event) => { set('gasDay', event.target.value); fillDesignations(); } })),
    el('td', {}, contract),
    el('td', {}, designation),
    el('td', { class: 'qty' }, el('input', { type: 'text', inputmode: 'decimal', value: line.quantity, 'aria-label': `Line ${index + 1} quantity in TJ`, oninput: (event) => set('quantity', event.target.value) })),
    el('td', { class: 'derived', dataset: { field: 'derived' } }),
    el('td', { class: 'note' }, el('input', { type: 'text', value: line.note, maxlength: '400', 'aria-label': `Line ${index + 1} note (never sent)`, oninput: (event) => set('note', event.target.value) })),
    el('td', { class: 'check', dataset: { field: 'check' } }),
    el('td', {}, el('button', { type: 'button', class: 'button-quiet button-small remove', 'aria-label': `Remove line ${index + 1}`, title: 'Remove this line', onclick: () => {
      lines.splice(index, 1);
      if (!lines.length) lines.push(blankLine());
      changed(true);
    } }, '✕')),
  );
}

function withCurrent(options, current) {
  return current && !options.includes(current) ? [...options, current] : options;
}

// The points on the contract's pipeline that are current on the Gas Day, inlets first.
function designationOptions(line) {
  const contract = reference.contracts.find((item) => item.code === line.contract);
  const points = reference.designations
    .filter((point) => !contract || point.pipelineCode === contract.pipelineCode)
    .filter((point) => !line.gasDay || (point.validFrom <= line.gasDay && (!point.validTo || line.gasDay <= point.validTo)))
    .filter((point) => contract?.type !== 'Spot' || point.direction === 'Outlet')
    .sort((a, b) => a.direction.localeCompare(b.direction) || a.code.localeCompare(b.code));
  const options = [el('option', { value: '' }, 'Choose')];
  for (const direction of ['Inlet', 'Outlet']) {
    const group = points.filter((point) => point.direction === direction);
    if (group.length) options.push(el('optgroup', { label: `${direction}s` }, group.map((point) => el('option', { value: point.code, selected: point.code === line.designation }, `${point.code} · ${point.locationName}`))));
  }
  if (line.designation && !points.some((point) => point.code === line.designation)) options.push(el('option', { value: line.designation, selected: true }, `${line.designation} (not on this contract's pipeline)`));
  return options;
}

function addLine() {
  lines.push(blankLine(lines.at(-1)));
  changed(true);
  body.lastElementChild?.querySelector('select, input')?.focus();
}

function changed(redraw) {
  saveDraft();
  confirmWarnings = false;
  if (redraw) drawRows();
  scheduleCheck();
}

function scheduleCheck(delay = 350) {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(runCheck, delay);
}

async function runCheck() {
  const run = ++checkRun;
  const result = await api(`${API}/lines/check`, { method: 'POST', body: { lines } });
  if (run !== checkRun) return; // a newer check has started
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  checked = result.data;
  paintCheck();
}

function paintCheck() {
  if (!checked || checked.rows.length !== lines.length) return;
  const groupLines = new Set(checked.issues.filter((issue) => issue.line === null && issue.severity === 'Error').flatMap((issue) => issue.lines ?? []));
  [...body.children].forEach((tr, index) => {
    const row = checked.rows[index];
    const mine = checked.issues.filter((issue) => issue.line === index);
    const first = mine.find((issue) => issue.severity === 'Error') ?? mine[0];
    tr.querySelector('[data-field="derived"]').replaceChildren(
      el('span', {}, [row.nomType, row.serviceType].filter(Boolean).join(' · ')),
      row.designationLocation ? el('span', { class: 'location' }, row.designationLocation) : '');
    const check = tr.querySelector('[data-field="check"]');
    const blank = !hasContent(lines[index]);
    check.replaceChildren(blank ? '' : first
      ? el('span', { class: first.severity === 'Error' ? 'check-error' : 'check-warning' }, `${first.severity === 'Warning' ? 'Warning: ' : ''}${first.message.replace(/^Line \d+: /, '')}${mine.length > 1 ? ` (+${mine.length - 1} more)` : ''}`)
      : el('span', { class: 'check-ok' }, 'OK'));
    tr.classList.toggle('has-error', Boolean(first && first.severity === 'Error'));
    tr.classList.toggle('has-warning', Boolean(first && first.severity === 'Warning'));
    tr.classList.toggle('in-total', groupLines.has(index));
  });
  const { errors, warnings } = checked.summary;
  summary.replaceChildren(
    badge(`${lines.length} line${lines.length === 1 ? '' : 's'}`, 'navy'),
    badge(`${errors} error${errors === 1 ? '' : 's'}`, errors ? 'bad' : 'good'),
    badge(`${warnings} warning${warnings === 1 ? '' : 's'}`, warnings ? 'warn' : 'good'),
  );
  const totals = checked.issues.filter((issue) => issue.line === null);
  issuesBox.replaceChildren(totals.length ? panel('Totals and the batch', el('ul', { class: 'issues' }, totals.map((issue) => el('li', { class: issue.severity === 'Error' ? 'check-error' : 'check-warning' }, `${issue.rule}: ${issue.message}`)))) : '');
  totalsBox.replaceChildren(totalsPanel());
  drawPublish();
}

function totalsPanel() {
  const groups = totalsByContractDay(checked.rows, reference.contracts);
  if (!groups.length) return '';
  return panel('Totals by contract and Gas Day', table(
    ['Gas Day', 'Contract', { label: 'Inlets (TJ)', numeric: true }, { label: 'Outlets (TJ)', numeric: true }, { label: 'Capacity (TJ)', numeric: true }],
    groups.map((group) => el('tr', {},
      el('td', {}, dayLabel(group.gasDay)), el('td', {}, group.contract),
      el('td', { class: 'num' }, group.inletTJ), el('td', { class: 'num' }, group.outletTJ), el('td', { class: 'num' }, group.capacityTJ ?? '—'))),
  ));
}

function drawPublish() {
  const { errors, warnings } = checked.summary;
  const canPublish = page.session.canOperate && !errors && lines.length > 0;
  const publish = button(`Publish ${lines.length} line${lines.length === 1 ? '' : 's'}`, () => doPublish(publish), { disabled: !canPublish || (warnings > 0 && !confirmWarnings) });
  const parts = [publish];
  if (warnings && !errors) {
    parts.unshift(el('label', { class: 'inline-check' }, el('input', { type: 'checkbox', checked: confirmWarnings, onchange: (event) => {
      confirmWarnings = event.target.checked;
      drawPublish();
    } }), 'I have read the warnings and want to publish anyway'));
  }
  if (errors) parts.unshift(el('span', { class: 'check-error' }, 'Fix the errors to publish.'));
  if (!page.session.autoApprove) parts.push(el('span', { class: 'muted small' }, 'An operator approves it on its page before it is sent.'));
  publishBox.replaceChildren(el('span', { class: 'spacer' }), ...parts);
}

async function doPublish(trigger) {
  const result = await act(trigger, () => api(`${API}/batches`, { method: 'POST', body: { lines, source, confirmWarnings } }));
  if (result.status === 201) {
    clearDraft();
    flash([`Published batch ${result.data.batch.id}.`, ...result.data.warnings].join(' '));
    window.location.assign(`/batch/?id=${result.data.batch.id}`);
  } else if (result.data.issues) {
    checked = { ...checked, issues: result.data.issues, summary: result.data.summary };
    paintCheck();
  }
}

async function readText(text, from) {
  const result = await api(`${API}/lines/read`, { method: 'POST', body: { text } });
  if (!result.ok) {
    showMessage(result.data.error);
    return false;
  }
  const { lines: read, skipped, problems } = result.data;
  if (!read.length) {
    showMessage(problems[0] ?? 'No lines with a contract were found.');
    return false;
  }
  const keep = lines.filter(hasContent);
  lines = [...keep, ...read.map((line) => ({ gasDay: line.gasDay, contract: line.contract, designation: line.designation, quantity: line.quantity, note: line.note }))];
  source = from;
  showMessage([`${read.length} line${read.length === 1 ? '' : 's'} added${skipped ? `, ${skipped} row${skipped === 1 ? '' : 's'} without a contract skipped` : ''}.`, ...problems].join(' '), { ok: !problems.length });
  changed(true);
  return true;
}

function openPaste() {
  const area = el('textarea', { 'aria-label': 'Rows copied from Excel', placeholder: 'Select the rows in the workbook (with the header row), copy, and paste here.' });
  const dialog = el('dialog', {},
    el('h2', {}, 'Paste from Excel'),
    el('p', { class: 'muted' }, 'Copy the rows from the B2B_Export table, header row included, and paste them here. The Gas Day, Contract, Designation and Nominated Quantity columns are used; the rest is filled from the reference data.'),
    area,
    el('div', { class: 'toolbar' }, el('span', { class: 'spacer' }),
      button('Cancel', () => dialog.close(), { quiet: true }),
      button('Add these lines', async () => {
        if (await readText(area.value, { kind: 'paste' })) dialog.close();
      })));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  area.focus();
}

function openCopy() {
  const fromDay = el('input', { type: 'date', value: page.session.today });
  const toDay = el('input', { type: 'date', value: page.session.today });
  const dialog = el('dialog', {},
    el('h2', {}, 'Copy a Gas Day AGIG accepted'),
    el('p', { class: 'muted' }, 'Starts from the lines of the latest accepted batch for a Gas Day, moved to the Gas Day you choose. Change the quantities, then publish.'),
    el('div', { class: 'form-grid' }, el('label', {}, 'Copy from', fromDay), el('label', {}, 'To Gas Day', toDay)),
    el('div', { class: 'toolbar' }, el('span', { class: 'spacer' }),
      button('Cancel', () => dialog.close(), { quiet: true }),
      button('Copy', async () => {
        const list = await api(`${API}/batches?status=ACCEPTED&gasDay=${encodeURIComponent(fromDay.value)}&limit=1`);
        const latest = list.ok ? list.data.batches[0] : null;
        if (!latest) {
          showMessage(`Nothing is accepted for ${fromDay.value}.`);
          dialog.close();
          return;
        }
        const detail = await api(`${API}/batches/${latest.id}`);
        const copied = detail.data.rows.filter((row) => row.gasDay === fromDay.value)
          .map((row) => ({ gasDay: toDay.value, contract: row.contract, designation: row.designation, quantity: row.quantityTJ, note: '' }));
        lines = [...lines.filter(hasContent), ...copied];
        showMessage(`${copied.length} lines copied from batch ${latest.id}.`, { ok: true });
        dialog.close();
        changed(true);
      })));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((line) => line && typeof line === 'object').slice(0, 2000) : [];
  } catch {
    return [];
  }
}

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(lines)); } catch { /* storage may be off: the page still works */ }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* as above */ }
}
