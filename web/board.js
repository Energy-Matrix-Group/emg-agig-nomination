import { api, API, badge, el, fill, gasDay, linkRow, nextCutoff, showMessage, startPage, table, when } from '/shared.js';

// The Gas Day board answers two questions at a glance: is each Gas Day covered, and how long until its next
// cutoff? The open alerts sit across the top, one line each, then one line per Gas Day from yesterday to a week
// ahead: the day, its status in the design's colours, the next cutoff with a countdown, and what AGIG holds.
// Everything else (both cutoffs, the batch's numbers, its file) is a click away on the batch. It asks again every
// minute, and the countdowns move every 30 seconds. Eve, 17 November 2026: "does not need all details, make it
// clearer".

const COLOUR_TONE = { green: 'good', blue: 'info', amber: 'warn', red: 'bad', grey: 'closed', none: 'navy' };
const SEVERITY_TONE = { Critical: 'bad', Warning: 'warn', Info: 'info' };
const SEVERITY_ORDER = { Critical: 0, Warning: 1, Info: 2 };
const DAY_TAG = { '-1': 'Yesterday', 0: 'Today', 1: 'Tomorrow' };
const BANNER_LINES = 3;
const content = document.querySelector('[data-content]');
let warningMinutes = 60;
const observer = new MutationObserver(() => tick());
observer.observe(content, { childList: true, subtree: true });

const page = await startPage('board');
if (page) {
  await draw();
  setInterval(draw, 60_000);
  setInterval(tick, 30_000);
}

async function draw() {
  const [boardResult, alertsResult] = await Promise.all([api(`${API}/board`), api(`${API}/alerts`)]);
  if (!boardResult.ok) {
    showMessage(boardResult.data.error);
    return;
  }
  const board = boardResult.data;
  warningMinutes = board.cutoffWarningMinutes ?? warningMinutes;
  fill(content,
    alertsBanner(alertsResult.ok ? alertsResult.data.alerts : []),
    table(['Gas Day', 'Status', 'Next cutoff', { label: 'AGIG holds (TJ)', numeric: true }], board.days.map(row), { className: 'board-rows' }),
    el('p', { class: 'muted small' }, `Times are Perth time (AWST). Updated ${when(board.now)}. Select a day to open its latest batch.`),
  );
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

// One line per Gas Day. A day with a batch opens it (it is what the status is about); a day with none opens nothing.
function row(day) {
  const href = day.latest ? `/batch/?id=${day.latest.batchId}` : null;
  const date = gasDay(day.gasDay);
  const cells = [
    el('td', {},
      href ? el('a', { href, class: 'day-link', 'aria-label': `Gas Day ${date}: open batch ${day.latest.batchId}` }, date) : el('span', { class: 'day-link' }, date),
      DAY_TAG[day.offset] ? el('span', { class: 'day-tag' }, DAY_TAG[day.offset]) : null),
    el('td', { title: day.latest ? `Latest: batch ${day.latest.batchId}${day.latest.modelId ? `, model ${day.latest.modelId}` : ''}` : '' }, badge(day.label, COLOUR_TONE[day.colour])),
    el('td', { class: 'cutoff', dataset: { initial: day.initialCutoff, renomination: day.renominationCutoff, settled: String(['green', 'grey'].includes(day.colour)) } }),
    el('td', { class: 'num' }, day.held.lines ? day.held.outletTJ : '—'),
  ];
  const props = { class: `day-row day-row--${day.colour}` };
  return href ? linkRow(href, cells, props) : el('tr', props, cells);
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
