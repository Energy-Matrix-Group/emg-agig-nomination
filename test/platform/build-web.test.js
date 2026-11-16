import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'build-web.js');

// The script finds web/ next to itself, so each case gets its own copy of it in a scratch repo.
function scratch(webPackage) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'emg-build-web-'));
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(script, path.join(root, 'scripts', 'build-web.js'));
  mkdirSync(path.join(root, 'web'));
  if (webPackage) {
    writeFileSync(path.join(root, 'web', 'package.json'), JSON.stringify(webPackage));
    mkdirSync(path.join(root, 'web', 'node_modules')); // so it does not try to install
  }
  return root;
}

function run(root, ...args) {
  const { NODE_ENV, ...env } = process.env;
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'build-web.js'), ...args], { encoding: 'utf8', env });
}

test('a static UI has nothing to build or test, and that is not an error', () => {
  const root = scratch(null);
  try {
    const built = run(root);
    assert.equal(built.status, 0);
    assert.match(built.stdout, /static UI\. Nothing to build/);
    assert.match(run(root, 'test').stdout, /Nothing to test/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a UI with its own project runs the script asked for, build by default', () => {
  const root = scratch({ scripts: { build: 'node -e "console.log(\'BUILT\')"', test: 'node -e "console.log(\'TESTED\')"' } });
  try {
    assert.match(run(root).stdout, /BUILT/);
    assert.match(run(root, 'build').stdout, /BUILT/);
    assert.match(run(root, 'test').stdout, /TESTED/);
    assert.match(run(root, 'lint').stdout, /no "lint" script/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failing script fails the build, and a bad script name is refused', () => {
  const root = scratch({ scripts: { build: 'node -e "process.exit(3)"' } });
  try {
    const failed = run(root);
    assert.equal(failed.status, 3);
    assert.match(failed.stderr, /failed/);
    assert.equal(run(root, 'build && echo hacked').status, 2);
    assert.equal(run(root, '../x').status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
