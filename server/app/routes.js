import { actorOf, canOperate, requireOperator } from './access.js';
import { gasDayBoard } from './board.js';
import { batchDetail, listBatches, listResponses, modelParam, systemView } from './detail.js';
import { httpError, readJson, sendFile, sendJson } from '../platform/kit.js';
import { awstToday } from './time.js';

// The handlers. The app watches what the design's worker writes: every route only reads, except acknowledging and
// clearing an alert. docs/API.md is the contract for every one (test/contract.test.js checks the list).

export const PREFIX = '/api/agig-nomination';

function idOf(params, name = 'id') {
  if (!/^\d{1,9}$/.test(params[name] ?? '')) throw httpError(404, 'There is no such record.');
  return Number(params[name]);
}

const ok = (res, body) => sendJson(res, 200, body);
const query = (req) => new URL(req.url, 'http://x').searchParams;


async function session({ res, user, app }) {
  ok(res, {
    user: { id: user.id, displayName: user.displayName, email: user.email, role: user.role ?? null },
    canActOnAlerts: canOperate(user),
    environment: app.settings.environment,
    today: awstToday(app.clock()),
    databaseConnected: app.databaseConnected !== false,
    openAlerts: (await app.store.listAlerts({ open: true, limit: 500 })).length,
  });
}

// Acknowledging ("I am on it") and clearing an alert: the only changes made here, by the ops team.
async function alertAction({ req, res, params, user, app }, change) {
  requireOperator(user);
  await readJson(req);
  if (app.databaseConnected === false) throw httpError(503, 'AGIG Nominations is running without its database, so it is not taking changes. Try again shortly.');
  const alert = await app.store.updateAlert(idOf(params), change(user, app.clock()));
  if (!alert) throw httpError(404, 'There is no such alert.');
  ok(res, { alert });
}

export function createRoutes(prefix = PREFIX) {
  const route = (method, path, handler) => ({ method, path: `${prefix}${path}`, handler, auth: true });
  return [
    route('GET', '/session', session),
    route('GET', '/board', async ({ req, res, app }) => ok(res, await gasDayBoard(app, { model: modelParam(query(req)) }))),
    route('GET', '/models', async ({ res, app }) => ok(res, { models: await app.store.listModels({ environment: app.settings.environment }) })),
    route('GET', '/reference', async ({ res, app }) => {
      const [pipelines, contracts, designations, errorCodes, fileTemplate] = await Promise.all([
        app.store.listPipelines(), app.store.listContracts(), app.store.listDesignations(), app.store.listErrorCodes(), app.store.listFileTemplate(),
      ]);
      ok(res, { pipelines, contracts, designations, errorCodes, fileTemplate });
    }),

    route('GET', '/batches', async ({ req, res, app }) => ok(res, await listBatches(app, query(req)))),
    route('GET', '/batches/:id', async ({ res, params, user, app }) => ok(res, await batchDetail(app, user, idOf(params)))),
    route('GET', '/batches/:id/file', async ({ res, params, app }) => {
      const files = await app.store.listFiles({ batchIds: [idOf(params)] });
      const chosen = files.filter((file) => file.status !== 'FAILED').at(-1) ?? files.at(-1);
      if (!chosen) throw httpError(404, 'This batch has no file.');
      const file = await app.store.getFile(chosen.id, { body: true });
      sendFile(res, { body: file.body, contentType: 'text/csv; charset=utf-8', filename: file.fileName.replace(/[^A-Za-z0-9._ -]/g, '_') });
    }),

    route('GET', '/responses', async ({ res, app }) => ok(res, await listResponses(app))),
    route('GET', '/responses/:id/file', async ({ res, params, app }) => {
      const response = await app.store.getResponse(idOf(params));
      if (!response?.rawCsv) throw httpError(404, 'There is no such response file.');
      const name = (response.attachmentName || `response-${response.id}.csv`).replace(/[^A-Za-z0-9._ -]/g, '_');
      sendFile(res, { body: Buffer.from(response.rawCsv, 'utf8'), contentType: 'text/csv; charset=utf-8', filename: name });
    }),

    route('GET', '/alerts', async ({ req, res, app }) => {
      const open = query(req).get('open');
      ok(res, { alerts: await app.store.listAlerts({ open: open === 'false' ? false : open === 'all' ? null : true, limit: 200 }) });
    }),
    route('POST', '/alerts/:id/acknowledge', (context) => alertAction(context, (user, now) => ({ acknowledgedBy: actorOf(user), acknowledgedAt: now }))),
    route('POST', '/alerts/:id/clear', (context) => alertAction(context, (user, now) => ({ clearedAt: now }))),

    route('GET', '/system', async ({ res, app }) => ok(res, await systemView(app))),
  ];
}
