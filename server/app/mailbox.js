import { clear, raise } from './alerts.js';
import { recordResponse } from './responses.js';

// AGIG's response emails, read from a shared mailbox with Microsoft Graph (the design's step 10). It uses an app
// registration with Mail.ReadWrite on that one mailbox (an Exchange application access policy keeps it there), and
// plain fetch: no SDK. It runs as a background job, never inside a request, and only on a real database, so an
// email is never moved to Processed while its response is kept only in memory.
//
// Each unread email from AGIG (NOM_MAIL_AGIG_SENDER, when set) is recorded once (its Graph message id is unique),
// marked read, and moved to a Processed folder, or to Review when it could not be read or matched to a file.

const GRAPH = 'https://graph.microsoft.com/v1.0';
const FAILURES_BEFORE_ALERT = 3;

export function createMailbox({ mail, fetch, clock }) {
  const state = { lastRunAt: null, lastOkAt: null, lastError: null, failures: 0, recorded: 0 };
  let token = null;
  const folders = new Map();

  async function graphToken() {
    if (token && token.until > clock().getTime()) return token.value;
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(mail.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: mail.clientId, client_secret: mail.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Microsoft sign-in answered ${response.status}`);
    const data = await response.json();
    token = { value: data.access_token, until: clock().getTime() + (Number(data.expires_in) - 120) * 1000 };
    return token.value;
  }

  async function graph(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${GRAPH}/users/${encodeURIComponent(mail.mailbox)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await graphToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Graph answered ${response.status} for ${method} ${path.split('?')[0].replace(/messages\/[^/]+/, 'messages/…')}`);
    return response.status === 204 ? null : response.json();
  }

  async function folderId(name) {
    if (folders.has(name)) return folders.get(name);
    const found = await graph(`/mailFolders?$filter=${encodeURIComponent(`displayName eq '${name}'`)}`);
    const id = found.value?.[0]?.id ?? (await graph('/mailFolders', { method: 'POST', body: { displayName: name } })).id;
    folders.set(name, id);
    return id;
  }

  async function file(messageId, folder) {
    await graph(`/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: { isRead: true } });
    await graph(`/messages/${encodeURIComponent(messageId)}/move`, { method: 'POST', body: { destinationId: await folderId(folder) } });
  }

  async function poll(app) {
    state.lastRunAt = clock().toISOString();
    try {
      const sender = mail.agigSender ? ` and from/emailAddress/address eq '${mail.agigSender.replaceAll("'", "''")}'` : '';
      const list = await graph(`/mailFolders/inbox/messages?$filter=${encodeURIComponent(`isRead eq false${sender}`)}&$top=25&$select=id,subject,receivedDateTime,from,hasAttachments`);
      const messages = (list.value ?? []).sort((a, b) => String(a.receivedDateTime).localeCompare(String(b.receivedDateTime)));
      for (const message of messages) {
        const known = await app.store.findResponseByMessageId(message.id);
        if (known) {
          await file(message.id, known.matchState === 'MATCHED' ? 'Processed' : 'Review');
          continue;
        }
        const attachments = message.hasAttachments ? (await graph(`/messages/${encodeURIComponent(message.id)}/attachments`)).value ?? [] : [];
        const csv = attachments.find((item) => item['@odata.type'] === '#microsoft.graph.fileAttachment' && /\.csv$/i.test(item.name ?? ''));
        const outcome = await recordResponse(app, {
          messageId: message.id,
          receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : clock(),
          sender: message.from?.emailAddress?.address ?? null,
          subject: message.subject ?? '',
          attachmentName: csv?.name ?? null,
          text: csv?.contentBytes ? Buffer.from(csv.contentBytes, 'base64').toString('utf8') : '',
        });
        state.recorded += 1;
        await file(message.id, outcome.response.matchState === 'MATCHED' ? 'Processed' : 'Review');
      }
      state.lastOkAt = clock().toISOString();
      state.lastError = null;
      state.failures = 0;
      await clear(app, 'MAILBOX');
    } catch (error) {
      state.failures += 1;
      state.lastError = error.message;
      if (state.failures >= FAILURES_BEFORE_ALERT) {
        await raise(app, 'MAILBOX', 'Critical', `The response mailbox could not be read ${state.failures} times in a row (${error.message}). AGIG's answers are not being recorded: upload them on the Responses page meanwhile.`);
      }
      throw error;
    }
  }

  return {
    configured: true,
    mailbox: mail.mailbox,
    pollSeconds: mail.pollSeconds,
    poll,
    status: () => ({ configured: true, mailbox: mail.mailbox, ...state }),
  };
}

export const NO_MAILBOX = Object.freeze({
  configured: false,
  poll: async () => {},
  status: () => ({ configured: false }),
});
