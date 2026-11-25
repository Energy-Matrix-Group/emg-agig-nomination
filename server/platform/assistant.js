import { readCheck, shapeOutcome, readInput } from './assistant-schema.js';
import { assistantChannel, assistantUser, verifyAssistantToken } from './assistant-token.js';
import { tooManyAttempts } from './dispatch.js';
import { httpError, readJson, sendJson } from './http.js';
import { clientKey, createRateLimiter } from './rate-limit.js';
import { TOKEN_LIMITS } from './service-token.js';
import { TokenError } from './token.js';

// Every app's door for Joules, the EMG helper in the portal (assistant-schema.js says what an app puts behind it). Only the
// portal can come through it: each call carries a token the portal signed for one person, one app and one thing to do
// (assistant-token.js), and the app treats the call as that person's own. A browser's session is never enough.
//
//   GET  /api/assistant           what Joules can do here: { app, about, actions }. An app with no `assistant` export still
//                                 answers, with its catalogue description and no actions, so Joules knows it is there.
//   POST /api/assistant/:action   { mode, input, check? }, where mode is 'run', or 'preview' for a write action. Answers
//                                 { result }, { preview } or { done } (assistant-schema.js, shapeOutcome). `check` is what
//                                 the preview answered, sent back with the run (from 1.7.0).
//
// From 1.7.0 a token may say the person is on a phone call ('voice') or texting ('sms'). The door then offers and runs only
// the app's set for that way (`assistant.channels`), and hands the action `context.via` and `context.session`, the portal's
// id for the call or thread. A chat token works exactly as before.
//
// A wrong token is a 401, and wrong tokens are limited as service tokens are (then 429, even with a right one). A write while
// the app is on its memory fallback is a 503: a change a restart would lose must not be made for anyone. What the app's own
// handler throws (403, 404, 409...) is answered as any route's error is.

export const ASSISTANT_PATH = '/api/assistant';
export const ASSISTANT_MESSAGES = Object.freeze({
  refused: 'Joules could not be checked.',
  noAction: 'This app has no such action.',
  mode: 'That is not a way this action can be asked for.',
  noDatabase: 'This app is running without its database, so it is not taking changes from Joules.',
});

export function createAssistantRoutes({ config, catalog, assistant, replay, now = Date.now, limits = {} }) {
  const settings = { ...TOKEN_LIMITS, ...limits };
  const make = (limit) => createRateLimiter({ limit, windowMs: settings.windowMs, now: settings.now });
  const perClient = make(settings.tokenPerClient);
  const total = make(settings.tokenTotal);
  const sets = {
    chat: assistant?.actions ?? [],
    voice: assistant?.channels?.voice ?? [],
    sms: assistant?.channels?.sms ?? [],
  };
  const actions = Object.fromEntries(Object.entries(sets).map(([via, list]) => [via, new Map(list.map((action) => [action.name, action]))]));

  // The person the token speaks for and how they are talking to Joules, or null with an answer already sent (401 or 429).
  function check(req, res, act) {
    const client = clientKey(req);
    const retryAfter = Math.max(perClient.retryAfter(client), total.retryAfter('all'));
    if (retryAfter) {
      tooManyAttempts(res, retryAfter);
      return null;
    }
    const match = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? '').trim());
    try {
      const claims = verifyAssistantToken(match?.[1] ?? '', { publicKey: config.portalPublicKey, appId: config.appId, act, now: now(), replay });
      return { user: assistantUser(claims), ...assistantChannel(claims) };
    } catch (error) {
      if (!(error instanceof TokenError)) throw error;
      perClient.fail(client);
      total.fail('all');
      console.warn(`Joules refused (${error.code}): ${error.message}`);
      sendJson(res, 401, { error: ASSISTANT_MESSAGES.refused });
      return null;
    }
  }

  const manifests = Object.fromEntries(Object.entries(actions).map(([via, map]) => [via, Object.freeze({
    app: { id: catalog.id, name: catalog.name, description: catalog.description },
    about: assistant?.about ?? catalog.description,
    actions: [...map.values()].map(({ name, kind, title, description, input }) => ({ name, kind, title, description, input })),
  })]));

  return [
    {
      method: 'GET',
      path: ASSISTANT_PATH,
      handler: ({ req, res }) => {
        const caller = check(req, res, 'manifest');
        if (caller) sendJson(res, 200, manifests[caller.via]);
      },
    },
    {
      method: 'POST',
      path: `${ASSISTANT_PATH}/:action`,
      handler: async ({ req, res, params, directory, app }) => {
        const body = await readJson(req);
        const mode = body.mode;
        if (!['run', 'preview'].includes(mode)) throw httpError(400, ASSISTANT_MESSAGES.mode);
        // The token is checked before anything about the action is said, so nobody can learn what an app offers without one.
        const caller = check(req, res, `${mode}:${params.action}`);
        if (!caller) return;
        const action = actions[caller.via].get(params.action);
        if (!action) throw httpError(404, ASSISTANT_MESSAGES.noAction);
        if (action.kind === 'read' && mode !== 'run') throw httpError(400, ASSISTANT_MESSAGES.mode);
        if (action.kind === 'write' && app?.databaseConnected === false) throw httpError(503, ASSISTANT_MESSAGES.noDatabase);
        const input = readInput(action.input, body.input);
        if (input.error) throw httpError(400, input.error);
        const sent = mode === 'run' ? readCheck(body.check) : { value: null };
        if (sent.error) throw httpError(400, sent.error);
        const context = { req, user: caller.user, input: input.value, app, directory, assistant: true, via: caller.via, session: caller.session, check: sent.value };
        const outcome = mode === 'preview' ? await action.preview(context) : await action.run(context);
        sendJson(res, 200, shapeOutcome(action.kind, mode, outcome));
      },
    },
  ];
}
