import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createFakePortal } from './support/fake-portal.js';

// The portal has no server/app/index.js (it boots differently, and tests its own start-up), so these tests step aside there.
const entry = fileURLToPath(new URL('../../server/index.js', import.meta.url));
const appModule = await import('../../server/app/index.js').catch(() => null);
const catalog = appModule?.catalog ?? { id: 'none' };
const skip = !appModule && 'this repo has no server/app/index.js';
// An app whose UI has a build step (Ticketing's Vite project) answers pages with a 503 hint until it is built,
// so what a page request gets depends on whether the build has been run.
const uiBuilt = existsSync(fileURLToPath(new URL(`../../${appModule?.ui?.root ?? 'web'}/index.html`, import.meta.url)));
const portal = createFakePortal({ appId: catalog.id });

// Starts server/index.js with only the settings given, so nothing leaks in from a developer's own .env.
function start(env) {
  const output = [];
  const child = spawn(process.execPath, [entry], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  const exited = new Promise((resolve) => (child.exitCode === null ? child.once('exit', resolve) : resolve(child.exitCode)));
  return { child, output, exited };
}

async function running(env, run) {
  const port = await freePort();
  const started = start({ ...env, PORT: String(port) });
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && started.child.exitCode === null) {
      try {
        if ((await fetch(`${base}/health`)).ok) return await run(base, started.output);
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`The app did not come up (exit code ${started.child.exitCode}).\n${started.output.join('')}`);
  } finally {
    started.child.kill();
    await started.exited;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test('the app starts with good settings, answers /health, and sends a signed-out API call to the portal', { skip }, async () => {
  await running(portal.env(), async (base) => {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
    const me = await fetch(`${base}/api/me`);
    assert.equal(me.status, 401);
    assert.ok((await me.json()).signIn.startsWith(`http://localhost:4000/handoff?app=${catalog.id}&return=`));
    assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), { databaseConnected: true });
    const page = await fetch(`${base}/`, { redirect: 'manual' });
    if (uiBuilt) assert.equal(page.status, 302, 'a page request without a session goes to the portal');
    else assert.equal(page.status, 503, 'a UI that has not been built says so');
  });
});

test('a missing session secret is made up for local work, with a warning', { skip }, async () => {
  await running(portal.env({ APP_SESSION_SECRET: '' }), async (base, output) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.match(output.join(''), /APP_SESSION_SECRET is not set/);
  });
});

test('a missing directory token is flagged in the log', { skip }, async () => {
  await running(portal.env(), async (base, output) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.match(output.join(''), /PORTAL_DIRECTORY_TOKEN is not set/);
  });
});

test('a bad setting stops the app with a message that names every problem', { skip }, async () => {
  const started = start({ APP_ID: 'Bad Id', PORT: '0' });
  const code = await started.exited;
  const text = started.output.join('');
  assert.equal(code, 1);
  assert.match(text, /The app cannot start/);
  for (const part of ['APP_ID "Bad Id"', 'PORTAL_URL is missing', 'PORTAL_SIGNING_PUBLIC_KEY is missing']) assert.ok(text.includes(part), part);
});

test('an app whose id differs from APP_ID does not start', { skip }, async () => {
  const started = start(portal.env({ APP_ID: 'someone-else', PORT: '0' }));
  const code = await started.exited;
  assert.notEqual(code, 0);
  assert.ok(started.output.join('').includes(`APP_ID is "someone-else" but the app's catalogue id is "${catalog.id}"`));
});
