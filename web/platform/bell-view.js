// What the bell's panel shows, worked out from GET /api/notifications without a browser, so it is tested in
// test/platform/web/. bell.js draws it.

// The tabs, in order. "Your apps" is news for an application the person can open, "Platform" news for everyone, "Account" what
// the portal said about their own account.
export const TABS = [
  { id: 'all', label: 'All' },
  { id: 'app', label: 'Your apps' },
  { id: 'everyone', label: 'Platform' },
  { id: 'account', label: 'Account' },
];

const EMPTY = {
  all: 'Nothing new. News about the applications you can open, and the platform, shows up here.',
  app: 'Nothing new in your applications yet.',
  everyone: 'No news for everyone yet.',
  account: 'Nothing about your account yet. You will see here when you can open another application.',
};

export const emptyText = (tab) => EMPTY[tab] ?? EMPTY.all;

export function itemsFor(items, tab) {
  return tab === 'all' ? items : items.filter((item) => item.scope === tab);
}

// Whether the tip shows on this tab: on All, and on the tab its audience belongs to.
export function tipShows(tip, tab) {
  if (!tip) return false;
  return tab === 'all' || tab === (tip.app ? 'app' : 'everyone');
}

// The unread count on each tab, the tip included where it shows.
export function tabCounts(feed) {
  const counts = {};
  for (const tab of TABS) {
    counts[tab.id] = itemsFor(feed.items, tab.id).filter((item) => item.unread).length + (tipShows(feed.tip, tab.id) && feed.tip.unread ? 1 : 0);
  }
  return counts;
}

// The badge on the bell: nothing at none, and 9+ past nine, so it stays small.
export const badgeText = (unread) => (unread > 9 ? '9+' : unread > 0 ? String(unread) : '');

export const bellLabel = (unread) => (unread > 0 ? `Notifications, ${unread} unread` : 'Notifications');

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Today and Earlier, in the person's own time, each newest first. A group with nothing in it is left out.
export function groupItems(items, now = new Date()) {
  const today = items.filter((item) => sameDay(new Date(item.at), now));
  const earlier = items.filter((item) => !sameDay(new Date(item.at), now));
  return [{ name: 'Today', items: today }, { name: 'Earlier', items: earlier }].filter((group) => group.items.length > 0);
}

// When, in few characters: a time today, Yesterday, a weekday this week, and a date before that.
export function whenText(at, now = new Date()) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  if (sameDay(date, now)) return date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  if (now - date < 6 * 24 * 60 * 60 * 1000) return date.toLocaleDateString('en-AU', { weekday: 'short' });
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// The small label above an item's title, and the colour it takes.
export function tagOf(item) {
  if (item.scope === 'app') return { text: item.app?.name ?? 'Your apps', tone: 'navy' };
  if (item.scope === 'everyone') return { text: 'Everyone', tone: 'coral' };
  if (item.kind === 'role') return { text: 'Your role', tone: 'ink' };
  return { text: 'Your access', tone: 'green' };
}

// Why the person sees a notice for an application.
export const becauseText = (item) => (item.scope === 'app' && item.app ? `Because you can open ${item.app.name}` : '');

// Where the panel goes: beside the sidebar on a wide screen, with its point at the bell; under the top bar on a small one.
//   bell, nav   the bell's and the sidebar's rectangles; width the window's
export function placement({ bell, nav, width }) {
  if (width > 900) {
    const top = Math.max(12, Math.round(bell.top - 10));
    return { wide: true, top, left: Math.round(nav.right + 12), caret: Math.round(bell.top + bell.height / 2 - top - 6) };
  }
  return { wide: false, top: Math.round(bell.bottom + 8), left: 8, caret: 0 };
}

// A link from the portal: a page of the portal (starting with one /) is made an address on the portal, so it works from any
// application; an https address is kept, and so is plain http on this computer (an application's address in development).
// Anything else is not a link.
export function linkHref(href, portalUrl = '') {
  if (typeof href !== 'string') return null;
  if (href.startsWith('/') && !href.startsWith('//')) return `${portalUrl}${href}`;
  if (/^https:\/\//i.test(href)) return href;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(href) ? href : null;
}
