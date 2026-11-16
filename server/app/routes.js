import { actorOf, canOperate, requireOperator } from './access.js';
import { gasDayBoard } from './board.js';
import { approve, cancel, checkOnly, publish, sendAnyway } from './batches.js';
import { agentResult, claimNext, filesInFlight, markUploaded, resolve } from './delivery.js';
import { batchDetail, listBatches, listResponses } from './detail.js';
import { readLines } from './intake.js';
import { httpError, readJson, sendFile, sendJson, SERVICE_ACTOR } from '../platform/kit.js';
import { deleteSpotAward, getReference, listSpotAwards, saveContract, saveDesignation, saveSpotAward } from './reference/edit.js';
import { linkResponse, uploadResponse } from './responses.js';
import { awstToday, daysBetween } from './time.js';

// The handlers. Each one is small: it reads the request, calls the step that does the work, and sends the answer.
// docs/API.md is the contract for every one (test/contract.test.js checks the list).

export const PREFIX = '/api/agig-nomination';
const LARGE = { limit: 1_000_000 }; // a pasted batch of 2,000 lines, or an AGIG response

const idOf = (params, name = 'id') => (/^\d{1,9}$/.test(params[name] ?? '') ? Number(params[name]) : NaN);

// A database that could not be used leaves the app on memory: it takes no changes that would be lost on a
// restart, and it never acts on the outside world (docs/ARCHITECTURE.md, 3.1).
function refuseOffline(app) {
  if (app.databaseConnected === false) throw httpError(503, 'AGIG Nominations is running without its database, so it is not taking changes. Try again shortly.');
}

const send = (status) => (res, body) => sendJson(res, status, body);
const ok = send(200);

async function session({ res, user, app }) {
  ok(res, {
    user: { id: user.id, displayName: user.displayName, email: user.email, role: user.role ?? null },
    canOperate: canOperate(user),
    environment: app.settings.environment,
    participant: app.settings.participant,
    autoApprove: app.settings.autoApprove,
    delivery: app.settings.agentEnabled ? 'agent' : 'manual',
    mailbox: app.mailbox.configured,
    today: awstToday(app.clock()),
    databaseConnected: app.databaseConnected !== false,
    openAlerts: (await app.store.listAlerts({ open: true, limit: 500 })).length,
  });
}

async function system({ res, app }) {
  const [alerts, inFlight, waiting, audit] = await Promise.all([
    app.store.listAlerts({ open: true, limit: 200 }),
    filesInFlight(app),
    app.store.listFiles({ status: ['BUILT', 'UPLOAD_UNCERTAIN'] }),
    app.store.listAudit({ limit: 30 }),
  ]);
  const recent = await app.store.listFiles({ status: ['UPLOADED', 'RESPONDED', 'NO_RESPONSE'] });
  const lastSent = recent.filter((file) => file.uploadedAt).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0] ?? null;
  const lastAnswered = recent.filter((file) => file.respondedAt).sort((a, b) => b.respondedAt.localeCompare(a.respondedAt))[0] ?? null;
  const today = awstToday(app.clock());
  ok(res, {
    environment: app.settings.environment,
    participant: app.settings.participant,
    autoApprove: app.settings.autoApprove,
    responseTimeoutMinutes: app.settings.responseTimeoutMinutes,
    cutoffWarningMinutes: app.settings.cutoffWarningMinutes,
    storage: app.databaseConnected === false ? 'memory-fallback' : app.store.kind,
    delivery: {
      mode: app.settings.agentEnabled ? 'agent' : 'manual',
      agentSeenAt: app.runtime.agentSeenAt?.toISOString() ?? null,
      inFlight: inFlight.map(({ id, batchId, fileName, status, uploadedAt }) => ({ id, batchId, fileName, status, uploadedAt })),
      waiting: waiting.map(({ id, batchId, fileName, status, builtAt }) => ({ id, batchId, fileName, status, builtAt })),
      lastSent: lastSent ? { batchId: lastSent.batchId, fileName: lastSent.fileName, at: lastSent.uploadedAt } : null,
      lastAnswered: lastAnswered ? { batchId: lastAnswered.batchId, fileName: lastAnswered.fileName, at: lastAnswered.respondedAt } : null,
    },
    mailbox: app.mailbox.status(),
    keyExpires: app.settings.keyExpires,
    keyDaysLeft: app.settings.keyExpires ? daysBetween(today, app.settings.keyExpires) : null,
    teams: Boolean(app.settings.teamsWebhook),
    jobs: app.runtime.jobs,
    alerts,
    audit,
  });
}

async function alertAction({ res, params, user, app }, change) {
  requireOperator(user);
  refuseOffline(app);
  const id = idOf(params);
  const alert = Number.isInteger(id) ? await app.store.updateAlert(id, change(user, app.clock())) : null;
  if (!alert) throw httpError(404, 'There is no such alert.');
  ok(res, { alert });
}

// The upload agent alone may use these: a person's session is refused, even an administrator's.
function requireAgent(user, app) {
  if (user?.id !== SERVICE_ACTOR.id) throw httpError(403, 'Only the upload agent may use this.');
  refuseOffline(app);
}

export function createRoutes(prefix = PREFIX) {
  const route = (method, path, handler, extra = {}) => ({ method, path: `${prefix}${path}`, handler, auth: true, ...extra });
  return [
    route('GET', '/session', session),
    route('GET', '/board', async ({ res, app }) => ok(res, await gasDayBoard(app))),

    route('GET', '/reference', async ({ res, app }) => ok(res, await getReference(app))),
    route('POST', '/contracts', async ({ req, res, user, app }) => { refuseOffline(app); send(201)(res, await saveContract(app, user, null, await readJson(req))); }),
    route('PUT', '/contracts/:id', async ({ req, res, params, user, app }) => { refuseOffline(app); ok(res, await saveContract(app, user, idOf(params), await readJson(req))); }),
    route('POST', '/designations', async ({ req, res, user, app }) => { refuseOffline(app); send(201)(res, await saveDesignation(app, user, null, await readJson(req))); }),
    route('PUT', '/designations/:id', async ({ req, res, params, user, app }) => { refuseOffline(app); ok(res, await saveDesignation(app, user, idOf(params), await readJson(req))); }),

    route('GET', '/spot-awards', async ({ req, res, app }) => ok(res, await listSpotAwards(app, new URL(req.url, 'http://x').searchParams))),
    route('PUT', '/spot-awards', async ({ req, res, user, app }) => { refuseOffline(app); ok(res, await saveSpotAward(app, user, await readJson(req))); }),
    route('DELETE', '/spot-awards/:id', async ({ res, params, user, app }) => { refuseOffline(app); ok(res, await deleteSpotAward(app, user, idOf(params))); }),

    route('POST', '/lines/read', async ({ req, res }) => {
      const body = await readJson(req, LARGE);
      if (typeof body.text !== 'string') throw httpError(400, 'Send the pasted text as text.');
      ok(res, readLines(body.text));
    }),
    route('POST', '/lines/check', async ({ req, res, app }) => ok(res, await checkOnly(app, await readJson(req, LARGE)))),

    route('GET', '/batches', async ({ req, res, app }) => ok(res, await listBatches(app, new URL(req.url, 'http://x').searchParams))),
    route('POST', '/batches', async ({ req, res, user, app }) => {
      refuseOffline(app);
      const outcome = await publish(app, user, await readJson(req, LARGE));
      sendJson(res, outcome.status, outcome.body);
    }),
    route('GET', '/batches/:id', async ({ res, params, user, app }) => ok(res, await batchDetail(app, user, idOf(params)))),
    route('GET', '/batches/:id/file', async ({ res, params, app }) => {
      const id = idOf(params);
      const files = Number.isInteger(id) ? await app.store.listFiles({ batchIds: [id] }) : [];
      const chosen = files.filter((file) => file.status !== 'FAILED').at(-1) ?? files.at(-1);
      if (!chosen) throw httpError(404, 'This batch has no file.');
      const file = await app.store.getFile(chosen.id, { body: true });
      sendFile(res, { body: file.body, contentType: 'text/csv; charset=utf-8', filename: file.fileName });
    }),
    route('POST', '/batches/:id/approve', async ({ res, params, user, app }) => { refuseOffline(app); ok(res, await approve(app, user, idOf(params))); }),
    route('POST', '/batches/:id/cancel', async ({ res, params, user, app }) => { refuseOffline(app); ok(res, await cancel(app, user, idOf(params))); }),
    route('POST', '/batches/:id/send-anyway', async ({ res, params, user, app }) => { refuseOffline(app); ok(res, await sendAnyway(app, user, idOf(params))); }),
    route('POST', '/batches/:id/uploaded', async ({ res, params, user, app }) => { refuseOffline(app); ok(res, await markUploaded(app, user, idOf(params))); }),
    route('POST', '/batches/:id/resolve', async ({ req, res, params, user, app }) => { refuseOffline(app); ok(res, await resolve(app, user, idOf(params), await readJson(req))); }),

    route('GET', '/responses', async ({ res, app }) => ok(res, await listResponses(app))),
    route('POST', '/responses', async ({ req, res, user, app }) => { refuseOffline(app); send(201)(res, await uploadResponse(app, user, await readJson(req, LARGE))); }),
    route('GET', '/responses/:id/file', async ({ res, params, app }) => {
      const id = idOf(params);
      const response = Number.isInteger(id) ? await app.store.getResponse(id) : null;
      if (!response?.rawCsv) throw httpError(404, 'There is no such response file.');
      const name = (response.attachmentName || `response-${id}.csv`).replace(/[^A-Za-z0-9._ -]/g, '_');
      sendFile(res, { body: Buffer.from(response.rawCsv, 'utf8'), contentType: 'text/csv; charset=utf-8', filename: name });
    }),
    route('POST', '/responses/:id/link', async ({ req, res, params, user, app }) => { refuseOffline(app); ok(res, await linkResponse(app, user, idOf(params), await readJson(req))); }),

    route('GET', '/alerts', async ({ req, res, app }) => {
      const open = new URL(req.url, 'http://x').searchParams.get('open');
      ok(res, { alerts: await app.store.listAlerts({ open: open === 'false' ? false : open === 'all' ? null : true, limit: 200 }) });
    }),
    route('POST', '/alerts/:id/acknowledge', (context) => alertAction(context, (user, now) => ({ acknowledgedBy: actorOf(user), acknowledgedAt: now }))),
    route('POST', '/alerts/:id/clear', (context) => alertAction(context, (user, now) => ({ clearedAt: now }))),

    route('GET', '/system', system),
    route('POST', '/mailbox/check', async ({ res, user, app }) => {
      requireOperator(user);
      if (!app.mailbox.configured) throw httpError(409, 'The response mailbox is not set up (NOM_MAIL_* settings).');
      if (app.store.kind !== 'sql' || app.databaseConnected === false) throw httpError(503, 'The mailbox is read only when the app has its database.');
      // Reading the mailbox reaches outside the app, so it runs in the background; the page looks again shortly.
      app.mailbox.poll(app).catch((error) => console.error(`The mailbox check failed: ${error.message}`));
      send(202)(res, { started: true });
    }),

    route('POST', '/agent/claim', async ({ res, user, app }) => { requireAgent(user, app); ok(res, await claimNext(app)); }, { service: 'NOM_AGENT_TOKEN' }),
    route('POST', '/agent/files/:id', async ({ req, res, params, user, app }) => {
      requireAgent(user, app);
      ok(res, await agentResult(app, idOf(params), await readJson(req)));
    }, { service: 'NOM_AGENT_TOKEN' }),
  ];
}
