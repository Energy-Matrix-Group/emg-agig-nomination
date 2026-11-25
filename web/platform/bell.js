import { api } from './api.js';
import { BELL, CROSS, el, itemRow, stroke, tipCard } from './bell-draw.js';
import { badgeText, bellLabel, emptyText, groupItems, itemsFor, placement, TABS, tabCounts, tipShows } from './bell-view.js';

// The bell: each person's notifications from the portal (from template 1.8.0). The server adds this script to every page it
// serves, as it adds the wait screen, so neither the portal nor an app does anything to have it. It waits for the sidebar's
// tool row (.app-nav__tools, which mountChrome draws and a built UI draws with the same classes), puts the bell first in it,
// and puts it back if a built UI draws the row again. It calls GET /api/notifications on its own server: the portal answers
// itself, and an app's platform asks the portal for the person signed in (server/platform/notifications.js).
//
// It shows only once the list has loaded, so a page with no session, or an app that cannot reach the portal, has no bell.
// The list is fetched when the bell first appears, when its panel opens, and when the person comes back to the tab after
// five minutes or more: never on a timer, so a page left open does not keep a paused database awake.
// Everything from the API is drawn as text.

const STALE_MS = 5 * 60 * 1000;

let feed = { unread: 0, tip: null, items: [] };
let portalUrl = '';
let tab = 'all';
let loadedAt = 0;
let button = null;
let panel = null;

start();

function start() {
  if (typeof document === 'undefined' || window.__emgBell) return;
  window.__emgBell = true;
  const attach = () => {
    const tools = document.querySelector('.app-nav__tools');
    if (!tools) return;
    if (!button) {
      mount();
      load();
    }
    if (!button.isConnected) tools.prepend(button);
  };
  const watch = () => {
    attach();
    new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) watch();
  else document.addEventListener('DOMContentLoaded', watch, { once: true });
}

function mount() {
  if (!document.querySelector('link[href="/platform/bell.css"]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: '/platform/bell.css' }));
  }
  button = el('button', {
    type: 'button',
    class: 'icon-button notify-bell',
    'data-notify-bell': true,
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    'aria-controls': 'notify-panel',
    'aria-label': bellLabel(0),
    title: 'Notifications',
    hidden: true,
    onClick: () => (panel.hidden ? open() : close()),
  }, stroke(BELL), el('span', { class: 'notify-bell__count', 'aria-hidden': 'true' }));

  panel = el('section', { id: 'notify-panel', class: 'notify-panel', role: 'dialog', 'aria-labelledby': 'notify-title', hidden: true });
  panel.addEventListener('keydown', onKey);
  document.body.append(panel);

  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) close({ focus: false });
  });
  window.addEventListener('resize', () => { if (!panel.hidden) place(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && loadedAt && Date.now() - loadedAt > STALE_MS) load();
  });
}

async function load() {
  const result = await api('/api/notifications');
  if (!result.ok || !Array.isArray(result.data.items)) return false;
  feed = result.data;
  portalUrl = typeof feed.portalUrl === 'string' ? feed.portalUrl : '';
  loadedAt = Date.now();
  button.hidden = false;
  showCount();
  if (!panel.hidden) draw();
  return true;
}

function showCount() {
  button.querySelector('.notify-bell__count').textContent = badgeText(feed.unread);
  button.setAttribute('aria-label', bellLabel(feed.unread));
}

function open() {
  panel.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  draw();
  place();
  panel.querySelector('#notify-title')?.focus();
  load();
}

function close({ focus = true } = {}) {
  if (panel.hidden) return;
  panel.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (focus) button.focus();
}

function place() {
  const nav = document.querySelector('.app-nav');
  const spot = placement({ bell: button.getBoundingClientRect(), nav: nav ? nav.getBoundingClientRect() : { right: 0 }, width: window.innerWidth });
  panel.classList.toggle('notify-panel--narrow', !spot.wide);
  panel.style.setProperty('--notify-top', `${spot.top}px`);
  panel.style.setProperty('--notify-caret', `${spot.caret}px`);
  panel.style.top = `${spot.top}px`;
  panel.style.left = `${spot.left}px`;
}

function onKey(event) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
    return;
  }
  const current = event.target.closest?.('[role="tab"]');
  if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const ids = TABS.map((item) => item.id);
  const at = ids.indexOf(current.dataset.tab);
  const next = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: ids.length - 1 }[event.key];
  choose(ids[(next + ids.length) % ids.length]);
}

function choose(id) {
  tab = id;
  draw();
  panel.querySelector(`[data-tab="${id}"]`)?.focus();
}

function draw() {
  const counts = tabCounts(feed);
  const head = el('div', { class: 'notify-panel__head' },
    el('h2', { id: 'notify-title', tabindex: '-1' }, 'Notifications'),
    el('div', { class: 'notify-panel__actions' },
      el('button', { type: 'button', class: 'notify-quiet', disabled: feed.unread === 0, onClick: markAll }, 'Mark all as read'),
      el('button', { type: 'button', class: 'notify-quiet notify-close', 'aria-label': 'Close notifications', onClick: () => close() }, stroke(CROSS))));

  const tabs = el('div', { class: 'notify-tabs', role: 'tablist', 'aria-label': 'Show' },
    ...TABS.map((item) => el('button', {
      type: 'button',
      role: 'tab',
      class: 'notify-tab',
      id: `notify-tab-${item.id}`,
      'data-tab': item.id,
      'aria-selected': String(item.id === tab),
      'aria-controls': 'notify-list',
      tabindex: item.id === tab ? '0' : '-1',
      onClick: () => choose(item.id),
    }, item.label, counts[item.id] ? el('span', { class: 'notify-tab__count' }, el('span', { class: 'sr-only' }, ', '), `${counts[item.id]}`, el('span', { class: 'sr-only' }, ' unread')) : null)));

  const shown = itemsFor(feed.items, tab);
  const scroll = el('div', { class: 'notify-scroll', id: 'notify-list', role: 'tabpanel', 'aria-labelledby': `notify-tab-${tab}` });
  const handlers = { portalUrl, onFollow: follow, onRead: (id) => markItems([id]), onPutAway: putAway };
  if (tipShows(feed.tip, tab)) scroll.append(tipCard(feed.tip, handlers));
  for (const group of groupItems(shown)) {
    scroll.append(el('p', { class: 'notify-group' }, group.name), el('ul', { class: 'notify-list' }, ...group.items.map((item) => el('li', {}, itemRow(item, handlers)))));
  }
  if (shown.length === 0 && !tipShows(feed.tip, tab)) scroll.append(el('p', { class: 'notify-empty' }, el('strong', {}, 'You are up to date'), emptyText(tab)));

  const foot = el('div', { class: 'notify-panel__foot' },
    el('span', {}, 'Showing the last 90 days'),
    feed.canWrite ? el('a', { class: 'notify-quiet', href: `${portalUrl}/admin/notices/` }, 'Write a notice') : null);

  panel.replaceChildren(el('span', { class: 'notify-panel__caret', 'aria-hidden': 'true' }), head, tabs, scroll, foot);
}

// Opening something marks it read first, then goes there. A click that opens a new tab leaves this page as it is.
async function follow(event, id, unread) {
  if (!unread) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) {
    markItems([id]);
    return;
  }
  const link = event.currentTarget;
  event.preventDefault();
  await markItems([id]);
  window.location.assign(link.href);
}

async function markItems(ids) {
  const result = await api('/api/notifications/read', { method: 'POST', body: { ids } });
  if (!result.ok) return;
  for (const item of feed.items) if (ids.includes(item.id)) item.unread = false;
  if (feed.tip && ids.includes(`notice:${feed.tip.id}`)) feed.tip.unread = false;
  feed.unread = result.data.unread;
  showCount();
  if (!panel.hidden) draw();
}

async function markAll() {
  const result = await api('/api/notifications/read', { method: 'POST', body: { all: true } });
  if (!result.ok) return;
  for (const item of feed.items) item.unread = false;
  if (feed.tip) feed.tip.unread = false;
  feed.unread = result.data.unread;
  showCount();
  draw();
  panel.querySelector('#notify-title')?.focus();
}

async function putAway(tip) {
  const result = await api(`/api/notifications/tips/${encodeURIComponent(tip.id)}/dismiss`, { method: 'POST' });
  if (result.ok) {
    feed.tip = result.data.tip;
    feed.unread = result.data.unread;
  } else {
    feed.tip = null;
  }
  showCount();
  draw();
  panel.querySelector('#notify-title')?.focus();
}
