// A look at AGIG Nominations on your own machine, with no portal, database or settings to set up.
//
//   npm run demo             signed in as an Ops Trader, with sample nominations for the next few Gas Days
//   npm run demo -- --empty  the same with no sample data (the spec's points and codes are always there)
//   npm run demo -- --viewer signed in as someone with no company role, who may look but not change anything
//
// Then open http://localhost:4001. Everything is kept in memory and is gone when you stop it (Ctrl+C).
//
// The app has no sign-in page of its own: people sign in at the portal, which hands them to the app with a signed
// token. This starts a stand-in for the portal on port 4000 (the one the platform's own tests use), which signs
// you in at once, and the app on port 4001 exactly as it runs on DigitalOcean, on its memory store. Nothing is
// sent anywhere: there is no mailbox, no Teams and no upload agent, and files are "uploaded" with the button.
import http from 'node:http';
import * as appModule from '../server/app/index.js';
import { addDays, awstToday, renominationCutoff } from '../server/app/time.js';
import { createAppServer } from '../server/platform/create-server.js';
import { createFakePortal } from '../test/platform/support/fake-portal.js';

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

const env = portal.env({
  NOM_PARTICIPANT: 'EMG Shipper',
  NOM_SFTP_KEY_EXPIRES: addDays(awstToday(new Date()), 40),
});
const server = createAppServer({ app: appModule, env, directory: portal.directory });

async function listen(target, port, name) {
  await new Promise((resolve, reject) => {
    target.once('error', (error) => reject(error.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use, so the ${name} cannot start. Stop whatever uses it (another npm start?) and try again.`) : error));
    target.listen(port, '127.0.0.1', resolve);
  });
}

// Sample data, through the app's own API, as the ops team would make it.
async function seed() {
  const signIn = await fetch(`${APP}/auth/callback`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: portal.token(person), return: '/' }),
  });
  const cookie = signIn.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
  const call = async (path, body, method = 'POST') => {
    const response = await fetch(`${APP}/api/agig-nomination${path}`, {
      method, headers: { cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`${method} ${path}: ${data.error}`);
    return data;
  };
  // After 20:00 in Perth today's Gas Day is closed to AGIG, so the sample starts tomorrow.
  const today = awstToday(new Date());
  const first = new Date() > renominationCutoff(today) ? 1 : 0;
  const day = (n) => addDays(today, n + first);
  const lines = (gasDay, kemerton = '12.5') => [
    { gasDay, contract: 'Shipper1_FH01', designation: 'I1-01', quantity: '20' },
    { gasDay, contract: 'Shipper1_FH01', designation: 'OS5-01', quantity: kemerton, note: 'From the daily model' },
    { gasDay, contract: 'Shipper1_FH01', designation: 'OS2-01', quantity: '7.25' },
  ];
  const answer = (fileName, status, errors = []) => [
    `Filename,${fileName}`, 'File Timestamp,20260101000000', 'Participant_Name,EMG Shipper', 'File Type,SHNOM', `Status,${status}`,
    ...(errors.length ? ['Line Number,Error Code,Error Description', ...errors] : []), 'End',
  ].join('\r\n');
  const send = async (batchLines, response) => {
    const { batch } = await call('/batches', { lines: batchLines, confirmWarnings: true });
    if (response === 'unsent') return batch.id;
    await call(`/batches/${batch.id}/uploaded`);
    if (response) {
      const { file } = await call(`/batches/${batch.id}`, undefined, 'GET');
      await call('/responses', { fileName: 'response.csv', text: answer(file.fileName, ...response) });
    }
    return batch.id;
  };

  await call('/contracts', { code: 'Shipper1_FH01', type: 'Transport', pipelineCode: 'DBNGP', startDate: day(-60), capacityTJ: '25', serviceType: 'T1' });
  await call('/contracts', { code: 'Shipper1_SPOT', type: 'Spot', pipelineCode: 'DBNGP', startDate: day(-60) });
  await call('/spot-awards', { gasDay: day(1), contractCode: 'Shipper1_SPOT', awardedTJ: '2.5' }, 'PUT');
  await send(lines(day(0)), ['Success']);
  await send([...lines(day(1)), { gasDay: day(1), contract: 'Shipper1_SPOT', designation: 'OS5-01', quantity: '2.5' }], ['Success']);
  await send(lines(day(2), '12'), ['Failure', ['3,507,Invalid Outlet Point (combination of Contract: Inlet Designation: Pipeline: Customer)']]);
  await send(lines(day(3)), null);
  await send(lines(day(1), '11.75'), 'unsent');
}

try {
  await listen(stand, PORTAL_PORT, 'stand-in portal');
  await server.ready;
  await listen(server, APP_PORT, 'app');
  if (!args.has('--empty')) await seed();
  console.log('');
  console.log(`  AGIG Nominations is running: open ${APP}`);
  console.log(`  You are ${person.displayName}${person.role ? ', an Ops Trader' : ', with no company role (look, but not change)'}.`);
  console.log(`  ${args.has('--empty') ? 'No sample data.' : 'Sample data: an accepted day, a rejected one, one waiting for AGIG, and newer numbers not sent.'}`);
  console.log('  Everything is in memory and goes when you stop it: Ctrl+C.');
  console.log('');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
