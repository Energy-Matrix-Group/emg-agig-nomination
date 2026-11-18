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
import { acceptedDay, addContracts, answer, buildFile, loadBatch, modelRows, raiseAlert } from '../test/worker.js';

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

  // Eight workbook models, each nominating its own contract at its own outlet (Eve's models never share a line).
  const MODELS = [
    ['MODEL-COCKBURN', 'OKW-04', 'Cockburn Power Station incl NewGen', '9.500'],
    ['MODEL-KEMERTON', 'OS5-01', 'Kemerton', '12.500'],
    ['MODEL-KWINANA', 'OKW-01', 'Alcoa Kwinana Station', '6.000'],
    ['MODEL-NEERABUP', 'OP10-01', 'Neerabup PS', '4.250'],
    ['MODEL-NORTH-METRO', 'NGP-NM', 'North Metro', '3.750'],
    ['MODEL-PINJARRA', 'OS2-01', 'Alcoa Pinjarra', '7.250'],
    ['MODEL-ROCKINGHAM', 'NGP-RO', 'Rockingham SN', '2.000'],
    ['MODEL-SOUTH-METRO', 'NGP-SM', 'South Metro', '5.500'],
  ].map(([modelId, outlet, location, outletTJ]) => ({ modelId, outlet, location, outletTJ, contract: `Shipper1_${modelId.slice(6).replaceAll('-', '')}` }));
  const of = (id) => MODELS.find((item) => item.modelId === id);
  for (const item of MODELS) {
    await store.createContract({ code: item.contract, type: 'Transport', pipelineCode: 'DBNGP', startDate: day(-60), endDate: null, capacityTJ: '15', serviceType: 'T1', subServiceType: null, isActive: true });
  }
  const rowsFor = (item, gasDay, outletTJ = item.outletTJ) => modelRows(gasDay, { ...item, outletTJ });
  const accept = (item, gasDay, minutesAgo) => acceptedDay(store, rowsFor(item, gasDay), { at: ago(minutesAgo), modelId: item.modelId });

  // Yesterday and today: every model accepted.
  for (const [index, item] of MODELS.entries()) {
    await accept(item, day(-1), 50 * 60 - index * 7);
    await accept(item, day(0), 26 * 60 - index * 7);
  }

  // Tomorrow: six accepted; Cockburn has newer numbers not sent yet; North Metro's file is with AGIG.
  for (const [index, item] of MODELS.entries()) {
    if (item.modelId !== 'MODEL-NORTH-METRO') await accept(item, day(1), 6 * 60 - index * 9);
  }
  const cockburnAccepted = (await store.listBatches({ modelId: 'MODEL-COCKBURN', from: day(1), to: day(1) }))[0];
  const newer = await loadBatch(store, rowsFor(of('MODEL-COCKBURN'), day(1), '10.250'), { at: ago(20), modelId: 'MODEL-COCKBURN', supersedes: cockburnAccepted.id });
  await buildFile(store, newer, { sent: false, at: ago(19) });
  const northMetro = await loadBatch(store, rowsFor(of('MODEL-NORTH-METRO'), day(1)), { at: ago(14), modelId: 'MODEL-NORTH-METRO' });
  await buildFile(store, northMetro, { at: ago(12) });

  // The day after: Kemerton rejected by AGIG, South Metro failed the worker's checks, Neerabup has loaded nothing.
  for (const [index, item] of MODELS.entries()) {
    if (!['MODEL-KEMERTON', 'MODEL-SOUTH-METRO', 'MODEL-NEERABUP'].includes(item.modelId)) await accept(item, day(2), 5 * 60 - index * 6);
  }
  const rejected = await loadBatch(store, rowsFor(of('MODEL-KEMERTON'), day(2)), {
    at: ago(4 * 60), modelId: 'MODEL-KEMERTON', issues: [{ line: 1, rule: 'RENOM', severity: 'Warning', message: 'Line 3: after 14:00 the day before, so AGIG treats it as a renomination.' }],
  });
  const rejectedFile = await buildFile(store, rejected, { at: ago(4 * 60 - 3) });
  await answer(store, rejected, rejectedFile, { status: 'Failure', errors: [[3, '507', 'Invalid Outlet Point (combination of Contract: Inlet Designation: Pipeline: Customer)']], at: ago(4 * 60 - 9) });
  await raiseAlert(store, 'REJECTED', 'Critical', `AGIG rejected batch ${rejected.id} (MODEL-KEMERTON, ${rejectedFile.fileName}): errors 507. Fix the lines and publish again.`, { entityType: 'Batch', entityId: rejected.id, at: ago(4 * 60 - 9) });
  await loadBatch(store, rowsFor(of('MODEL-SOUTH-METRO'), day(2), '16.000'), {
    status: 'VALIDATION_FAILED', at: ago(90), modelId: 'MODEL-SOUTH-METRO',
    issues: [{ line: null, rule: '522', severity: 'Error', message: `Shipper1_SOUTHMETRO on ${day(2)}: outlets total 16.000 TJ, more than the contracted 15.000 TJ.` }, { line: 1, rule: '522', severity: 'Error', message: 'Line 3: the outlet above capacity.' }],
  });

  // Three days out: three models have started, and Pinjarra's file carries a Kwinana line by mistake.
  await accept(of('MODEL-KWINANA'), day(3), 3 * 60);
  const rockingham = await loadBatch(store, rowsFor(of('MODEL-ROCKINGHAM'), day(3)), { at: ago(11), modelId: 'MODEL-ROCKINGHAM' });
  await buildFile(store, rockingham, { at: ago(9) });
  const pinjarra = await loadBatch(store, [...rowsFor(of('MODEL-PINJARRA'), day(3)), rowsFor(of('MODEL-KWINANA'), day(3))[1]], { at: ago(30), modelId: 'MODEL-PINJARRA' });
  await buildFile(store, pinjarra, { sent: false, at: ago(28) });

  await raiseAlert(store, 'STALE', 'Warning', `Batch ${newer.id} (MODEL-COCKBURN) for Gas Day ${day(1)} is not sent yet. AGIG still holds the earlier numbers.`, { entityType: 'Batch', entityId: newer.id, at: ago(15) });
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
  console.log(`  ${args.has('--empty') ? 'No sample data.' : 'Sample data: eight workbook models over the week: accepted days, one rejected, one waiting for AGIG, newer numbers not sent, one that failed the checks, a model with nothing loaded, a line two models share, and alerts.'}`);
  console.log('  Everything is in memory and goes when you stop it: Ctrl+C.');
  console.log('');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
