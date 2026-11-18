import { api, API, badge, button, el, fill, gasDay, linkRow, modelId, nextCutoff, showMessage, startPage, table, when } from '/shared.js';

// The Gas Day board answers two questions at a glance: is each Gas Day covered, and how long until its next
// cutoff? The open alerts sit across the top, one line each, then one line per Gas Day from today to 31 days
// ahead (Eve, 18 November 2026). Eve, 17 November 2026: "does not need all details, make it clearer".
//
// Eve has more than six workbook models, each sending its own files to AGIG on lines of its own (18 November 2026).
// So with every model on show, a day's line counts its models by state ("6 accepted · 1 with AGIG · 1 needs
// attention") and opens to one line per model; a model with nothing loaded for the day is listed too. The Model
// picker narrows the board to one model, shown as one line per day that opens its latest batch. It asks again every
// minute, and the countdowns move every 30 seconds.

const COLOUR_TONE = { green: 'good', blue: 'info', amber: 'warn', red: 'bad', grey: 'closed', none: 'navy' };
const COUNT_WORDS = { red: ['needs attention', 'need attention'], amber: ['loaded, not sent', 'loaded, not sent'], blue: ['with AGIG', 'with AGIG'], none: ['nothing sent', 'nothing sent'], green: ['accepted', 'accepted'] };
const SEVERITY_TONE = { Critical: 'bad', Warning: 'warn', Info: 'info' };
const SEVERITY_ORDER = { Critical: 0, Warning: 1, Info: 2 };
const DAY_TAG = { 0: 'Today', 1: 'Tomorrow' };
const BANNER_LINES = 3;
const REMEMBERED = 'agig-nomination:board-model';
const content = document.querySelector('[data-content]');
const area = el('div');
const state = { model: firstModel(), open: new Set(), board: null };
let warningMinutes = 60;
const observer = new MutationObserver(() => tick());
observer.observe(content, { childList: true, subtree: true });

const page = await startPage('board');
if (page) {
  await draw();
  setInterval(draw, 60_000);
  setInterval(tick, 30_000);
}

// The model to start on: the address's, else the one this person last chose here (a convenience, so it may be gone).
function firstModel() {
  const fromAddress = new URLSearchParams(window.location.search).get('model');
  if (fromAddress !== null) return fromAddress;
  try {
    return window.localStorage.getItem(REMEMBERED) ?? '';
  } catch {
    return '';
  }
}

function chooseModel(value) {
  state.model = value;
  state.open.clear();
  try {
    if (value) window.localStorage.setItem(REMEMBERED, value);
    else window.localStorage.removeItem(REMEMBERED);
  } catch {
    // Storage may be blocked; the address still carries the choice.
  }
  window.history.replaceState(null, '', `${window.location.pathname}${value ? `?model=${encodeURIComponent(value)}` : ''}`);
  draw();
}

async function draw() {
  const query = state.model ? `?model=${encodeURIComponent(state.model)}` : '';
  const [boardResult, alertsResult] = await Promise.all([api(`${API}/board${query}`), api(`${API}/alerts`)]);
  if (!boardResult.ok) {
    showMessage(boardResult.data.error);
    return;
  }
  state.board = boardResult.data;
  warningMinutes = state.board.cutoffWarningMinutes ?? warningMinutes;
  fill(content,
    alertsBanner(alertsResult.ok ? alertsResult.data.alerts : []),
    toolbar(state.board),
    area,
    el('p', { class: 'muted small' }, `Times are Perth time (AWST). Updated ${when(state.board.now)}. ${state.board.model ? 'Select a day to open its latest batch.' : 'Select a day to see its models; select a model to open its batch.'}`),
  );
  drawDays();
}

// The open alerts, worst first, one line each (the whole message is in its tooltip), or a quiet line saying none.
function alertsBanner(alerts) {
  if (!alerts.length) return el('p', { class: 'emg-callout emg-callout--good alerts-banner' }, 'No open alerts. Nothing needs you.');
  const sorted = [...alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.id - a.id);
  const more = alerts.length - BANNER_LINES;
  return el('section', { class: `alerts-banner alerts-banner--${SEVERITY_TONE[sorted[0].severity]}`, role: 'region', 'aria-label': 'Open alerts' },
    el('div', { class: 'alerts-banner__head' },
      el('strong', {}, `${alerts.length} open alert${alerts.length === 1 ? '' : 's'}`),
      el('a', { href: '/system/' }, more > 0 ? `See all ${alerts.length}` : 'Open System and alerts')),
    el('ul', {}, sorted.slice(0, BANNER_LINES).map((alert) => el('li', {},
      badge(alert.severity, SEVERITY_TONE[alert.severity]),
      el('span', { class: 'alerts-banner__message', title: alert.message }, alert.message),
      alert.entityType === 'Batch' && alert.entityId ? el('a', { href: `/batch/?id=${alert.entityId}` }, `Batch ${alert.entityId}`) : el('span')))),
    more > 0 ? el('p', { class: 'small' }, `And ${more} more.`) : null,
  );
}

// The Model picker: every model, the active ones (loaded in the last two weeks) first. With every model on show,
// "Open all" and "Close all" open or close every day's models at once.
function toolbar(board) {
  const active = board.models.filter((item) => item.active);
  const quiet = board.models.filter((item) => !item.active);
  const known = board.models.some((item) => item.modelId === state.model);
  const select = el('select', { onchange: (event) => chooseModel(event.target.value) },
    el('option', { value: '', selected: !state.model }, `All models (${active.length} active)`),
    active.map((item) => el('option', { value: item.modelId, selected: item.modelId === state.model }, item.modelId)),
    quiet.length ? el('optgroup', { label: 'Nothing loaded in two weeks' }, quiet.map((item) => el('option', { value: item.modelId, selected: item.modelId === state.model }, item.modelId))) : null,
    state.model && !known ? el('option', { value: state.model, selected: true }, `${state.model} (no batches)`) : null);
  const openable = board.model ? [] : board.days.filter(hasModels).map((day) => day.gasDay);
  return el('div', { class: 'filters board-tools' },
    el('label', {}, 'Model', select),
    openable.length ? button(openable.every((day) => state.open.has(day)) ? 'Close all' : 'Open all', () => {
      if (openable.every((day) => state.open.has(day))) state.open.clear();
      else openable.forEach((day) => state.open.add(day));
      draw();
    }, { quiet: true, small: true }) : null);
}

// A day opens to its models when it has something to tell model by model: more than one model, a model beside
// models with nothing loaded, or a shared line. A day no model has loaded anything for just says so.
function hasModels(day) {
  return day.models.length > 1 || (day.models.length > 0 && day.nothingLoaded.length > 0) || day.overlaps.length > 0;
}

// Draws the days again (after a day is opened or closed, and every minute). The table is made anew, so a day's
// button that had the focus would be gone: the focus goes back to the same day's new button.
function drawDays() {
  const board = state.board;
  const focused = document.activeElement?.closest?.('button.day-toggle')?.dataset.day ?? null;
  const rows = board.model ? board.days.map(oneModelRow) : board.days.flatMap(allModelsRows);
  fill(area, table(['Gas Day', board.model ? 'Status' : 'Models', 'Next cutoff', { label: 'AGIG holds (TJ)', numeric: true }], rows, { className: 'board-rows' }));
  if (focused) area.querySelector(`button.day-toggle[data-day="${focused}"]`)?.focus();
}

function dayCell(day, inner) {
  return el('td', {}, inner, DAY_TAG[day.offset] ? el('span', { class: 'day-tag' }, DAY_TAG[day.offset]) : null);
}

function cutoffCell(day) {
  return el('td', { class: 'cutoff', dataset: { initial: day.initialCutoff, renomination: day.renominationCutoff, settled: String(['green', 'grey'].includes(day.colour)) } });
}

function heldCell(held) {
  return el('td', { class: 'num' }, held.lines ? held.outletTJ : '—');
}

// One model: a day is that model's, and opens its latest batch.
function oneModelRow(day) {
  const href = day.latest ? `/batch/?id=${day.latest.batchId}` : null;
  const date = gasDay(day.gasDay);
  const cells = [
    dayCell(day, href ? el('a', { href, class: 'day-link', 'aria-label': `Gas Day ${date}: open batch ${day.latest.batchId}` }, date) : el('span', { class: 'day-link' }, date)),
    el('td', {}, badge(day.label, COLOUR_TONE[day.colour])),
    cutoffCell(day),
    heldCell(day.held),
  ];
  const props = { class: `day-row day-row--${day.colour}` };
  return href ? linkRow(href, cells, props) : el('tr', props, cells);
}

// Every model: the day's line counts its models, and opens to one line for each.
function allModelsRows(day) {
  const date = gasDay(day.gasDay);
  const openable = hasModels(day);
  const open = openable && state.open.has(day.gasDay);
  const toggle = () => {
    if (state.open.has(day.gasDay)) state.open.delete(day.gasDay);
    else state.open.add(day.gasDay);
    drawDays();
  };
  const name = openable
    ? el('button', { type: 'button', class: 'day-toggle day-link', dataset: { day: day.gasDay }, 'aria-expanded': String(open), 'aria-label': `Gas Day ${date}: ${open ? 'hide' : 'show'} its ${day.models.length + day.nothingLoaded.length} models`, onclick: toggle }, el('span', { class: 'chevron', 'aria-hidden': 'true' }), date)
    : day.latest ? el('a', { href: `/batch/?id=${day.latest.batchId}`, class: 'day-link' }, date) : el('span', { class: 'day-link' }, date);
  const props = { class: `day-row day-row--${day.colour}${open ? ' is-open' : ''}` };
  const cells = [dayCell(day, name), el('td', {}, summary(day)), cutoffCell(day), heldCell(day.held)];
  const line = openable
    ? el('tr', { ...props, class: `${props.class} link-row`, onclick: (event) => { if (!(event.target instanceof Element && event.target.closest('a, button'))) toggle(); } }, cells)
    : day.latest ? linkRow(`/batch/?id=${day.latest.batchId}`, cells, props) : el('tr', props, cells);
  return open ? [line, ...modelRows(day)] : [line];
}

// What a day's line says: its one status, when it has one model and nothing else to tell; else a count of its models
// in each state, the models with nothing loaded, and lines two models both nominate.
function summary(day) {
  if (day.colour === 'grey' || !hasModels(day)) return badge(day.label, COLOUR_TONE[day.colour]);
  const parts = ['red', 'amber', 'blue', 'none', 'green'].filter((tone) => day.counts[tone])
    .map((tone) => badge(`${day.counts[tone]} ${COUNT_WORDS[tone][day.counts[tone] === 1 ? 0 : 1]}`, COLOUR_TONE[tone]));
  if (day.overlaps.length) parts.unshift(badge(`${day.overlaps.length} shared line${day.overlaps.length === 1 ? '' : 's'}`, 'warn'));
  if (day.nothingLoaded.length) parts.push(badge(`${day.nothingLoaded.length} nothing loaded`, 'closed'));
  return el('span', { class: 'model-counts', title: day.label }, parts);
}

// One line per model under an open day, worst first, then the models with nothing loaded, then any shared line.
function modelRows(day) {
  const rank = { red: 0, amber: 1, blue: 2, none: 3, green: 4 };
  const models = [...day.models].sort((a, b) => rank[a.colour] - rank[b.colour] || String(a.modelId).localeCompare(String(b.modelId)));
  return [
    ...models.map((item) => {
      const href = item.latest ? `/batch/?id=${item.latest.batchId}` : null;
      const cells = [
        el('td', {}, item.modelId ? modelId(item.modelId) : el('span', { class: 'muted' }, 'No model ID')),
        el('td', {}, badge(item.label, COLOUR_TONE[item.colour])),
        el('td', {}, href ? el('a', { href, title: item.latest.statusLabel }, `Batch ${item.latest.batchId}`) : el('span', { class: 'muted' }, '—')),
        heldCell(item.held),
      ];
      const props = { class: `model-row day-row--${item.colour}` };
      return href ? linkRow(href, cells, props) : el('tr', props, cells);
    }),
    ...day.nothingLoaded.map((id) => el('tr', { class: 'model-row model-row--quiet' },
      el('td', {}, modelId(id)), el('td', {}, badge('Nothing loaded', 'closed')), el('td', {}, el('span', { class: 'muted' }, '—')), el('td', { class: 'num' }, '—'))),
    ...day.overlaps.map((overlap) => el('tr', { class: 'model-row model-row--overlap' },
      el('td', { colspan: '4' }, `${overlap.designation} (${overlap.contract}, ${overlap.nomType}) is nominated by ${overlap.models.map((id) => id ?? 'a batch with no model ID').join(' and ')}. AGIG keeps whichever file arrives later, so one model's number replaces the other's.`))),
  ];
}

// Fills each "Next cutoff" cell from the clock, so it moves from the initial cutoff to renominations to Closed by
// itself. A cutoff closer than NOM_CUTOFF_WARNING_MINUTES on a day that is not settled (accepted, or no contract)
// is marked. Only changes what differs, so the observer that calls it does not call it again for nothing.
function tick() {
  const now = Date.now();
  for (const cell of content.querySelectorAll('td.cutoff')) {
    const next = nextCutoff(cell.dataset.initial, cell.dataset.renomination, now);
    const close = Boolean(next.kind) && cell.dataset.settled !== 'true' && new Date(next.at).getTime() - now < warningMinutes * 60_000;
    const shown = `${next.kind}|${next.text}|${close}`;
    if (cell.dataset.shown === shown) continue;
    cell.dataset.shown = shown;
    cell.title = next.kind ? `${next.kind} cutoff ${when(next.at)} AWST` : `Closed: renominations ended ${when(cell.dataset.renomination)} AWST`;
    cell.classList.toggle('is-close', close);
    cell.classList.toggle('is-closed', !next.kind);
    cell.replaceChildren(...(next.kind ? [el('span', { class: 'cutoff-kind' }, next.kind), ' ', el('span', { class: 'countdown' }, next.text)] : [next.text]));
  }
}
