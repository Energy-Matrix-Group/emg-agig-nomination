import { api, API, badge, el, fill, gasDay, linkRow, relative, showMessage, startPage, table, when } from '/shared.js';

// The Gas Day board: the open alerts across the top, then one row per Gas Day from yesterday to a week ahead,
// coloured as the design set out, with a countdown to each cutoff. It asks again every minute, and the countdowns
// move every 30 seconds. A row opens that day's submissions.

const COLOUR_TONE = { green: 'good', blue: 'info', amber: 'warn', red: 'bad', grey: 'closed', none: 'navy' };
const SEVERITY_TONE = { Critical: 'bad', Warning: 'warn', Info: 'info' };
const content = document.querySelector('[data-content]');
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
  fill(content,
    alertsBanner(alertsResult.ok ? alertsResult.data.alerts : []),
    table(
      ['Gas Day', 'Status', 'Initial cutoff', 'Renomination', { label: 'AGIG holds', numeric: true }, { label: 'Latest', numeric: true }, 'Batch'],
      board.days.map(row),
      { className: 'board-rows' },
    ),
    el('p', { class: 'muted small' }, `TJ out: what AGIG holds for the day, and the latest batch loaded for it. Times are Perth time (AWST). Updated ${when(board.now)}. Select a day to see its submissions.`),
  );
}

// The open alerts, worst first, in one banner: or a quiet line saying there are none.
function alertsBanner(alerts) {
  if (!alerts.length) return el('p', { class: 'emg-callout emg-callout--good alerts-banner' }, 'No open alerts. Nothing needs you.');
  const order = { Critical: 0, Warning: 1, Info: 2 };
  const sorted = [...alerts].sort((a, b) => order[a.severity] - order[b.severity] || b.id - a.id);
  const worst = sorted[0].severity;
  return el('section', { class: `alerts-banner alerts-banner--${SEVERITY_TONE[worst]}`, role: 'region', 'aria-label': 'Open alerts' },
    el('div', { class: 'alerts-banner__head' },
      el('strong', {}, `${alerts.length} open alert${alerts.length === 1 ? '' : 's'}`),
      el('a', { href: '/system/' }, 'See them all')),
    el('ul', {}, sorted.slice(0, 4).map((alert) => el('li', {},
      badge(alert.severity, SEVERITY_TONE[alert.severity]), ' ', alert.message,
      alert.entityType === 'Batch' && alert.entityId ? [' ', el('a', { href: `/batch/?id=${alert.entityId}` }, `Batch ${alert.entityId}`)] : ''))),
    alerts.length > 4 ? el('p', { class: 'small' }, `And ${alerts.length - 4} more.`) : null,
  );
}

function row(day) {
  const href = `/batches/?gasDay=${day.gasDay}`;
  const tag = { '-1': 'Yesterday', 0: 'Today', 1: 'Tomorrow' }[day.offset] ?? `D+${day.offset}`;
  return linkRow(href, [
    el('td', { class: 'nowrap' }, el('a', { href, class: 'day-link' }, gasDay(day.gasDay)), el('br'), el('span', { class: 'day-tag' }, tag)),
    el('td', {}, badge(day.label, COLOUR_TONE[day.colour])),
    cutoffCell(day.initialCutoff),
    cutoffCell(day.renominationCutoff),
    el('td', { class: 'num' }, day.held.lines ? day.held.outletTJ : '—'),
    el('td', { class: 'num' }, day.latest ? day.latest.outletTJ : '—'),
    el('td', { class: 'nowrap' }, day.latest ? el('a', { href: `/batch/?id=${day.latest.batchId}`, title: day.latest.statusLabel }, `Batch ${day.latest.batchId}`) : el('span', { class: 'muted' }, '—')),
  ], { class: `day-row day-row--${day.colour}` });
}

function cutoffCell(iso) {
  return el('td', { class: 'nowrap' }, el('span', {}, when(iso)), el('br'), el('span', { class: 'countdown small', dataset: { countdown: iso } }));
}

function tick() {
  const now = Date.now();
  for (const cell of document.querySelectorAll('[data-countdown]')) {
    const at = new Date(cell.dataset.countdown).getTime();
    const text = at > now ? relative(cell.dataset.countdown, now) : 'passed';
    if (cell.textContent !== text) cell.textContent = text;
    cell.classList.toggle('passed', at <= now);
  }
}
