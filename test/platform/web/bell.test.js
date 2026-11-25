import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  badgeText, becauseText, bellLabel, groupItems, itemsFor, linkHref, placement, tabCounts, tagOf, tipShows, whenText,
} from '../../../web/platform/bell-view.js';

// The bell's panel (web/platform/bell.js, template 1.8.0), worked out without a browser.

const at = (iso) => iso;
const ITEMS = [
  { id: 'notice:1', scope: 'app', kind: 'news', app: { id: 'ticketing', name: 'Ticketing' }, at: at('2026-11-25T01:00:00Z'), unread: true },
  { id: 'notice:2', scope: 'everyone', kind: 'news', app: null, at: at('2026-11-24T01:00:00Z'), unread: true },
  { id: 'account:3', scope: 'account', kind: 'access', app: { id: 'devboard', name: 'DevBoard' }, at: at('2026-11-20T01:00:00Z'), unread: false },
  { id: 'account:4', scope: 'account', kind: 'role', app: null, at: at('2026-11-02T01:00:00Z'), unread: true },
];

test('each tab shows its own items, and the tip shows on All and on its audience\'s tab', () => {
  assert.deepEqual(itemsFor(ITEMS, 'all').map((item) => item.id), ['notice:1', 'notice:2', 'account:3', 'account:4']);
  assert.deepEqual(itemsFor(ITEMS, 'app').map((item) => item.id), ['notice:1']);
  assert.deepEqual(itemsFor(ITEMS, 'everyone').map((item) => item.id), ['notice:2']);
  assert.deepEqual(itemsFor(ITEMS, 'account').map((item) => item.id), ['account:3', 'account:4']);

  const everyone = { id: 't', app: null, unread: true };
  assert.deepEqual(['all', 'app', 'everyone', 'account'].map((tab) => tipShows(everyone, tab)), [true, false, true, false]);
  assert.deepEqual(['all', 'app', 'everyone', 'account'].map((tab) => tipShows({ ...everyone, app: { id: 'crm' } }, tab)), [true, true, false, false]);
  assert.equal(tipShows(null, 'all'), false);
  assert.deepEqual(tabCounts({ items: ITEMS, tip: everyone }), { all: 4, app: 1, everyone: 2, account: 1 });
});

test('the badge stays small, and the bell says how many are unread', () => {
  assert.deepEqual([0, 1, 9, 10, 57].map(badgeText), ['', '1', '9', '9+', '9+']);
  assert.equal(bellLabel(0), 'Notifications');
  assert.equal(bellLabel(3), 'Notifications, 3 unread');
});

test('the list is grouped into Today and Earlier, and each time is short', () => {
  const now = new Date(2026, 10, 25, 15, 0);
  const local = (day, hour) => new Date(2026, 10, day, hour, 14).toISOString();
  const items = [{ at: local(25, 9) }, { at: local(24, 9) }, { at: local(12, 9) }];
  assert.deepEqual(groupItems(items, now).map((group) => [group.name, group.items.length]), [['Today', 1], ['Earlier', 2]]);
  assert.deepEqual(groupItems([{ at: local(1, 9) }], now).map((group) => group.name), ['Earlier'], 'an empty group is left out');
  assert.match(whenText(local(25, 9), now), /^9:14\s?am$/i);
  assert.equal(whenText(local(24, 9), now), 'Yesterday');
  assert.equal(whenText(local(22, 9), now), 'Sun');
  assert.equal(whenText(local(12, 9), now), '12 Nov');
  assert.equal(whenText('not a date', now), '');
});

test('each item says who it is for, and a notice for an application says why the person sees it', () => {
  assert.deepEqual(ITEMS.map(tagOf), [{ text: 'Ticketing', tone: 'navy' }, { text: 'Everyone', tone: 'coral' }, { text: 'Your access', tone: 'green' }, { text: 'Your role', tone: 'ink' }]);
  assert.deepEqual(ITEMS.map(becauseText), ['Because you can open Ticketing', '', '', '']);
});

test('the panel opens beside the sidebar, pointing at the bell, and under the top bar on a small screen', () => {
  const bell = { top: 22, bottom: 58, height: 36 };
  assert.deepEqual(placement({ bell, nav: { right: 264 }, width: 1440 }), { wide: true, top: 12, left: 276, caret: 22 });
  assert.deepEqual(placement({ bell, nav: { right: 390 }, width: 390 }), { wide: false, top: 66, left: 8, caret: 0 });
});

test('a link to a page of the portal goes to the portal from an application, and only https leaves it', () => {
  assert.equal(linkHref('/apps/', 'https://portal-test.apps.energymatrix.com.au'), 'https://portal-test.apps.energymatrix.com.au/apps/');
  assert.equal(linkHref('/apps/', ''), '/apps/', 'on the portal itself it stays a path');
  assert.equal(linkHref('https://ticketing.example.com/', 'https://portal'), 'https://ticketing.example.com/');
  assert.equal(linkHref('http://localhost:4001/', 'https://portal'), 'http://localhost:4001/', 'an application in development');
  for (const bad of ['//evil.example.com/', 'javascript:alert(1)', 'http://example.com/', 'http://localhost.example.com/', 'apps/', null, undefined, 42]) {
    assert.equal(linkHref(bad, 'https://portal'), null, String(bad));
  }
});

test('the bell draws nothing from markup, and its styles use only the tokens', async () => {
  const web = new URL('../../../web/platform/', import.meta.url);
  for (const file of ['bell.js', 'bell-draw.js', 'bell-view.js']) {
    assert.doesNotMatch(await readFile(new URL(file, web), 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser/, file);
  }
  assert.doesNotMatch(await readFile(new URL('bell.css', web), 'utf8'), /#[0-9a-f]{3,8}\b/i);
});
