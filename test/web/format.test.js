import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gasDay, nextCutoff, relative, took, when } from '../../web/format.js';

// Every date the pages show is yyyy-mm-dd hh:mm:ss in Perth time, and a Gas Day yyyy-mm-dd.

test('a time is yyyy-mm-dd hh:mm:ss in Perth time (UTC+8, no daylight saving)', () => {
  assert.equal(when('2026-11-16T06:00:00.000Z'), '2026-11-16 14:00:00');
  assert.equal(when('2026-11-16T17:59:07Z'), '2026-11-17 01:59:07', 'after 16:00 UTC it is the next day in Perth');
  assert.equal(when('2026-06-30T23:00:00Z'), '2026-07-01 07:00:00', 'the same offset in winter');
  assert.equal(when(null), '');
  assert.equal(when('not a time'), '');
  assert.equal(gasDay('2026-11-17'), '2026-11-17');
});

test('countdowns and durations', () => {
  const now = Date.parse('2026-11-16T02:00:00Z');
  assert.equal(relative('2026-11-16T06:00:00Z', now), 'in 4 h 0 min');
  assert.equal(relative('2026-11-16T01:48:00Z', now), '12 min ago');
  assert.equal(relative('2026-11-19T02:00:00Z', now), 'in 3 days');
  assert.equal(took('2026-11-16T01:00:00Z', '2026-11-16T01:06:00Z'), '6 min');
  assert.equal(took('2026-11-16T01:00:00Z', '2026-11-16T02:12:00Z'), '1 h 12 min');
  assert.equal(took('2026-11-16T01:00:00Z', null), '');
});

test('the next cutoff is the initial one, then renominations, then none', () => {
  const initial = '2026-11-16T06:00:00.000Z';
  const renomination = '2026-11-17T12:00:00.000Z';
  assert.deepEqual(nextCutoff(initial, renomination, Date.parse('2026-11-16T02:00:00Z')), { kind: 'Initial', at: initial, text: 'in 4 h 0 min' });
  assert.deepEqual(nextCutoff(initial, renomination, Date.parse('2026-11-16T06:00:00Z')), { kind: 'Renomination', at: renomination, text: 'in 30 h 0 min' }, 'at 14:00 itself the initial cutoff has gone');
  assert.deepEqual(nextCutoff(initial, renomination, Date.parse('2026-11-17T12:00:00Z')), { kind: null, at: null, text: 'Closed' });
});
