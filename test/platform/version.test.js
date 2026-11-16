import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writePatchNote } from '../../scripts/patch-note.js';
import { bumpVersion } from '../../scripts/version.js';

test('every push advances the patch unless the commit asks otherwise', () => {
  assert.equal(bumpVersion('1.0.1', 'Fix the search box'), '1.0.2');
  assert.equal(bumpVersion('1.0.2', 'Version: minor\n\nAdd calendars'), '1.1.0');
  assert.equal(bumpVersion('1.1.0', 'Version: major\n\nReplace sign-in'), '2.0.0');
  assert.equal(bumpVersion('2.0.0', 'Version: patch\n\nTypo'), '2.0.1');
});

test('the largest step asked for anywhere in the push wins', () => {
  assert.equal(bumpVersion('1.2.3', 'Version: minor\n\nFirst\nVersion: major\n\nSecond'), '2.0.0');
  assert.equal(bumpVersion('1.2.3', 'Version: major\nVersion: patch'), '2.0.0');
  assert.equal(bumpVersion('1.2.3', 'Add calendars\r\n\r\nVersion: minor\r\n'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'Version:\nmajor refactor of search'), '1.2.4');
  assert.equal(bumpVersion('1.2.3', 'Explain the Version: major rule'), '1.2.4');
});

test('VERSION must be plain semver without leading zeros', () => {
  assert.equal(bumpVersion('0.9.9\r\n'), '0.9.10');
  assert.throws(() => bumpVersion('01.0.0'), /major\.minor\.patch/);
  assert.throws(() => bumpVersion('1.0'), /major\.minor\.patch/);
  assert.throws(() => bumpVersion('v1.0.0'), /major\.minor\.patch/);
});

test('a model that throws still produces the commit-list note', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const note = await writePatchNote({
      repo: 'EMG-Api',
      version: '1.0.4',
      commits: ['Fix sign-in'],
      files: ['src/create-server.js'],
      diff: 'diff',
      complete: async () => { throw new Error('fetch failed'); },
    });
    assert.match(note, /AI summary was not available/);
    assert.match(note, /Fix sign-in/);
  } finally {
    console.error = originalError;
  }
});

test('patch notes use the model text, or the commit list when there is no model', async () => {
  const written = await writePatchNote({
    repo: 'EMG-Api',
    version: '1.0.2',
    commits: ['Fix the search box'],
    files: ['ticketingApp/features/search/search.js'],
    diff: 'diff --git a/search.js',
    complete: async () => 'Search now matches ticket numbers.',
  });
  assert.equal(written, 'Search now matches ticket numbers.');

  const fallback = await writePatchNote({
    repo: 'EMG-Api',
    version: '1.0.3',
    commits: ['Show the version'],
    files: ['VERSION'],
    diff: '',
  });
  assert.match(fallback, /EMG-Api 1\.0\.3/);
  assert.match(fallback, /Show the version/);
  assert.match(fallback, /AI summary was not available/);
});
