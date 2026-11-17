// A look at AGIG Nominations on your own machine, with no portal, database or settings to set up.
//
//   npm run demo             signed in as an Ops Trader, with sample batches for the next few Gas Days
//   npm run demo -- --empty  the same with no sample data (the spec's points and codes are always there)
//   npm run demo -- --viewer signed in as someone with no company role, who may look but not settle alerts
//
// Then open http://localhost:4001. Everything is kept in memory and is gone when you stop it (Ctrl+C).
//
// The app has no sign-in page of its own: people sign in at the portal, which hands them to the app with a signed
// token. This starts a stand-in for the portal on port 4000 (the one the platform's own tests use), which signs
// you in at once, and the app on port 4001 exactly as it runs on DigitalOcean, on its memory store. The app only
// watches what the nomination worker writes, so the sample is written as the worker would write it.
import http from 'node:http';
import * as appModule from '../server/app/index.js';
import { addDays, awstToday, renominationCutoff } from '../server/app/time.js';
import { createAppServer } from '../server/platform/create-server.js';
import { createFakePortal } from '../test/platform/support/fake-portal.js';
import { acceptedDay, addContracts, answer, buildFile, dayRows, loadBatch, raiseAlert } from '../test/worker.js';

const PORTAL_PORT = 4000;
const APP_PORT = 4001;
const APP = `http://localhost:${APP_PORT}`;
const args = new Set(process.argv.slice(2));

const portal = createFakePortal({ appId: appModule.catalog.id });
const person = args.has('--viewer')
  ? portal.createUser({ email: 'viewer@example.com', displayName: 'Vic Viewer', role: null })
  : portal.createUser({ email: 'ops@example.com', displayName: 'Olive Ops', role: 'ops-trader' });

const escape = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const page = (title, body) => `<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5}a{color:#415A7E}</style></head>
<body>${body}</body></html>`;

// The stand-in portal: the handoff (sign-in), the "All applications" page and sign-out.
const stand = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTAL_PORT}`);
  const send = (status, html) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  };
  if (url.pathname === '/handoff') {
    // What the real portal does after checking who you are: post a signed token to the app's callback.
    const token = portal.token(person);
    const back = url.searchParams.get('return') || '/';
    return send(200, page('Signing in', `<p>Signing you in to AGIG Nominations as ${escape(person.displayName)}…</p>
<form method="post" action="${APP}/auth/callback"><input type="hidden" name="token" value="${escape(token)}">
<input type="hidden" name="return" value="${escape(back)}"><noscript><button>Continue</button></noscript></form>
<script>document.forms[0].submit()</script>`));
  }
  if (url.pathname === '/apps' || url.pathname === '/') {
    return send(200, page('Portal (demo stand-in)', `<h1>The portal</h1><p>This is only a stand-in for the EMG portal, for the local demo.</p><p><a href="${APP}/">Open AGIG Nominations</a></p>`));
  }
  if (url.pathname === '/logout') {
    return send(200, page('Signed out', `<h1>Signed out</h1><p><a href="${APP}/">Open AGIG Nominations again</a></p>`));
  }
  send(404, page('Not found', '<p>Not part of the demo.</p>'));
});

const env = portal.env({});
const server = createAppServer({ app: appModule, env, directory: portal.directory });

async function listen(target, port, name) {
  await new Promise((resolve, reject) => {
    target.once('error', (error) => reject(error.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use, so the ${name} cannot start. Stop whatever uses it (another npm start?) and try again.`) : error));
    target.listen(port, '127.0.0.1', resolve);
  });
}

// Sample data, written into the app's store as the design's worker would write it (test/worker.js stands in
// for the worker): batches loaded from the workbook, their files, AGIG's answers and a few alerts.
async function seed() {
  const store = (await server.appContext()).store;
  // After 20:00 in Perth today's Gas Day is closed to AGIG, so the sample starts tomorrow.
  const today = awstToday(new Date());
  const first = new Date() > renominationCutoff(today) ? 1 : 0;
  const day = (n) => addDays(today, n + first);
  const ago = (minutes) => new Date(Date.now() - minutes * 60_000);

  await addContracts(store, { from: day(-60) });
  await acceptedDay(store, dayRows(day(0)), { at: ago(26 * 60) });
  const tomorrow = await acceptedDay(store, dayRows(day(1), { spot: '2.500' }), { at: ago(5 * 60) });
  const newer = await loadBatch(store, dayRows(day(1), { kemerton: '11.750' }), { at: ago(20), supersedes: tomorrow.id });
  await buildFile(store, newer, { sent: false, at: ago(19) });

  const rejected = await loadBatch(store, dayRows(day(2), { kemerton: '12.000' }), {
    at: ago(4 * 60), issues: [{ line: 1, rule: 'RENOM', severity: 'Warning', message: 'Line 2: after 14:00 the day before, so AGIG treats it as a renomination.' }],
  });
  const rejectedFile = await buildFile(store, rejected, { at: ago(4 * 60 - 3) });
  await answer(store, rejected, rejectedFile, { status: 'Failure', errors: [[3, '507', 'Invalid Outlet Point (combination of Contract: Inlet Designation: Pipeline: Customer)']], at: ago(4 * 60 - 9) });
  await raiseAlert(store, 'REJECTED', 'Critical', `AGIG rejected batch ${rejected.id} (${rejectedFile.fileName}): errors 507. Fix the lines and publish again.`, { entityType: 'Batch', entityId: rejected.id, at: ago(4 * 60 - 9) });

  const waiting = await loadBatch(store, dayRows(day(3)), { at: ago(12) });
  await buildFile(store, waiting, { at: ago(10) });

  await loadBatch(store, dayRows(day(4), { kemerton: '19.000' }), {
    status: 'VALIDATION_FAILED', at: ago(90),
    issues: [{ line: null, rule: '522', severity: 'Error', message: `Shipper1_FH01 on ${day(4)}: outlets total 26.250 TJ, more than the contracted 25.000 TJ.` }, { line: 1, rule: '522', severity: 'Error', message: 'Line 2: part of the outlets above capacity.' }],
  });
  await raiseAlert(store, 'STALE', 'Warning', `Batch ${newer.id} for Gas Day ${day(1)} is not sent yet. AGIG still holds the earlier numbers.`, { entityType: 'Batch', entityId: newer.id, at: ago(15) });
  await raiseAlert(store, 'KEY_EXPIRY', 'Info', 'AGIG\'s SFTP key expires in 40 days. Ask AGIG for a new one.', { at: ago(60) });
}

try {
  await listen(stand, PORTAL_PORT, 'stand-in portal');
  await server.ready;
  await listen(server, APP_PORT, 'app');
  if (!args.has('--empty')) await seed();
  console.log('');
  console.log(`  AGIG Nominations is running: open ${APP}`);
  console.log(`  You are ${person.displayName}${person.role ? ', an Ops Trader' : ', with no company role (look, but not settle alerts)'}.`);
  console.log(`  ${args.has('--empty') ? 'No sample data.' : 'Sample data: accepted days, a rejected one, one waiting for AGIG, newer numbers not sent, one that failed the checks, and alerts.'}`);
  console.log('  Everything is in memory and goes when you stop it: Ctrl+C.');
  console.log('');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
