import { gasDayBoard } from './board.js';
import { batchDetail } from './detail.js';
import { createRoutes } from './routes.js';
import { readSettings } from './settings.js';
import { openStore } from './store/index.js';

// This is the only file the platform reads from server/app/. docs/SPEC.md says what the app is for and
// docs/API.md is the route contract.
export const catalog = {
  id: 'agig-nomination',
  name: 'AGIG Nominations',
  description: 'Shipper nominations to AGIG\'s TBS: every Gas Day against the cutoffs, every batch and AGIG\'s answers, and the alerts.',
  apiPrefix: '/api/agig-nomination',
  statusLabel: null,
  message: 'Shipper nominations to AGIG\'s TBS: every Gas Day against the cutoffs, every batch and AGIG\'s answers, and the alerts.',
};

// A static UI: one folder per page under web/, no build step. No page opens without a sign-in.
export const ui = { root: 'web', spa: false, publicPaths: [] };

// Runs once at boot. Its result is `app` in every handler: the store, the settings and the clock. It starts no
// background job: the design's worker loads the batches, sends the files, reads AGIG's emails and raises the
// alerts, and this app only watches what it writes. It must not take the service down over its database:
// openStore falls back to memory and says so (databaseConnected: false).
//
// The tests pass a clock, so time is theirs.
export async function setup({ sql = null, env = {}, connect, clock = () => new Date() } = {}) {
  const settings = readSettings(env);
  const opened = await openStore({ sql, env, connect, clock });
  return { ...opened, settings, clock };
}

// auth: true means a signed-in user. The portal has already checked that they may open this app.
export const routes = createRoutes(catalog.apiPrefix);

// What Joules, the EMG helper in the portal, can do here for a person. Each action runs as that person, and they
// only look, as the app does.
export const assistant = {
  about: 'AGIG Nominations shows how EMG\'s shipper transport nominations (SHNOM files) to AGIG\'s TBS are going, for the DBNGP and the other AGIG pipelines: each Gas Day against the cutoffs (14:00 AWST the day before for the initial nomination, 20:00 AWST on the day for renominations), every batch and AGIG\'s answers. The nominations themselves come from the ops team\'s workbook through the nomination worker. Joules can say whether each Gas Day is covered by an accepted nomination, what happened to a batch, and which alerts are open.',
  actions: [
    {
      name: 'gas_day_status',
      kind: 'read',
      title: 'Gas Day status',
      description: 'For today and the next 31 days: whether AGIG has accepted a nomination for each Gas Day, model by model (each workbook model sends its own files), what is waiting, and when the cutoffs fall (times in UTC; AWST is UTC+8). Give a model id to see only that model.',
      input: { type: 'object', properties: { model: { type: 'string', maxLength: 100, description: 'A model id, to see only that model. Leave it out for every model.' } } },
      run: async ({ app, input }) => {
        const board = await gasDayBoard(app, { model: input?.model?.trim() || null });
        return {
          environment: board.environment,
          today: board.today,
          days: board.days.map((day) => ({
            gasDay: day.gasDay, status: day.label, colour: day.colour, initialCutoffUtc: day.initialCutoff, renominationCutoffUtc: day.renominationCutoff,
            latestBatch: day.latest && { id: day.latest.batchId, modelId: day.latest.modelId, status: day.latest.statusLabel, outletTJ: day.latest.outletTJ },
            acceptedOutletTJ: day.held.lines ? day.held.outletTJ : null,
            models: day.models.map((item) => ({ modelId: item.modelId, status: item.label, batchId: item.latest?.batchId ?? null })),
            modelsWithNothingLoaded: day.nothingLoaded,
            linesNominatedByTwoModels: day.overlaps,
          })),
        };
      },
    },
    {
      name: 'batch_status',
      kind: 'read',
      title: 'A batch',
      description: 'One nomination batch by its number: the workbook model it came from, its status, the file sent, when each step happened, and AGIG\'s errors if it was rejected.',
      input: { type: 'object', properties: { batchId: { type: 'integer', minimum: 1, description: 'The batch number, as the Submissions page shows it.' } }, required: ['batchId'] },
      run: async ({ app, user, input }) => {
        const detail = await batchDetail(app, user, input.batchId).catch((error) => {
          if (error.status === 404) return null;
          throw error;
        });
        if (!detail) return { found: false };
        return {
          found: true,
          id: detail.batch.id,
          modelId: detail.batch.modelId ?? null,
          status: detail.batch.statusLabel,
          gasDays: `${detail.batch.gasDayFrom} to ${detail.batch.gasDayTo}`,
          publishedBy: detail.batch.createdBy,
          lines: detail.rows.length,
          file: detail.file?.fileName ?? null,
          timeline: detail.timeline.filter((step) => step.at),
          agigErrors: detail.rows.flatMap((row) => row.agigErrors.map((error) => ({ line: row.csvLineNumber, designation: row.designation, code: error.errorCode, meaning: error.meaning ?? error.errorDescription }))).slice(0, 40),
          path: `/batch/?id=${detail.batch.id}`,
        };
      },
    },
    {
      name: 'open_alerts',
      kind: 'read',
      title: 'Open alerts',
      description: 'The alerts that are still open: rejections, files with no answer, cutoffs close with nothing accepted, key expiry.',
      input: { type: 'object', properties: {} },
      run: async ({ app }) => ({
        alerts: (await app.store.listAlerts({ open: true, limit: 30 })).map(({ id, type, severity, message, raisedAt, acknowledgedBy }) => ({ id, type, severity, message, raisedAt, acknowledged: Boolean(acknowledgedBy) })),
      }),
    },
  ],
};
