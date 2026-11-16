import { clear, gasDayEntity, raise } from './alerts.js';
import { gasDayBoard } from './board.js';
import { filesInFlight } from './delivery.js';
import { addDays, awstMinutes, daysBetween, initialCutoff, minutesOfDay, renominationCutoff } from './time.js';

// The watchdog, every minute: nobody needs to watch the screen. It raises an alert when
//   - AGIG has not answered a file within NOM_RESPONSE_TIMEOUT_MINUTES (it is never assumed accepted);
//   - the upload agent took a file and has not said what happened for 10 minutes;
//   - it is NOM_INITIAL_ALERT_TIME (13:00) on D-1 and nothing is accepted for D, or today's 20:00 cutoff is
//     within the warning and nothing is accepted for today;
//   - newer numbers than AGIG accepted are not sent, within NOM_CUTOFF_WARNING_MINUTES of a cutoff;
//   - the SFTP key expires within 45, 14 or 3 days;
//   - the upload agent is on but has not asked for work for 10 minutes while a file waits.
// Each alert is raised once while it is open; the Teams job (teams.js) sends the new ones.

const STUCK_UPLOAD_MS = 10 * 60_000;
const AGENT_QUIET_MS = 10 * 60_000;
const KEY_WARNINGS = [[3, 'Critical'], [14, 'Warning'], [45, 'Info']];

export async function watchdog(app) {
  const now = app.clock();
  const { settings } = app;

  for (const file of await filesInFlight(app)) {
    if (file.status === 'UPLOADED' && file.uploadedAt) {
      const minutes = Math.floor((now - new Date(file.uploadedAt)) / 60_000);
      if (minutes >= settings.responseTimeoutMinutes && await app.store.updateFile(file.id, { status: 'NO_RESPONSE' }, { from: ['UPLOADED'] })) {
        await app.store.updateBatch(file.batchId, { status: 'NO_RESPONSE' }, { from: ['UPLOADED'] });
        await raise(app, 'NO_RESPONSE', 'Critical', `No answer from AGIG for ${file.fileName}, sent ${minutes} minutes ago. It is not assumed accepted: check the TBS portal, then settle batch ${file.batchId}.`, 'Batch', file.batchId);
      }
    }
    if (file.status === 'UPLOADING') {
      const seen = app.runtime.uploadingSince.get(file.id) ?? now;
      app.runtime.uploadingSince.set(file.id, seen);
      if (now - seen >= STUCK_UPLOAD_MS && await app.store.updateFile(file.id, { status: 'UPLOAD_UNCERTAIN', lastError: 'The upload agent did not report back.' }, { from: ['UPLOADING'] })) {
        await app.store.updateBatch(file.batchId, { status: 'UPLOAD_UNCERTAIN' }, { from: ['UPLOADING'] });
        await raise(app, 'UPLOAD_UNCERTAIN', 'Critical', `The upload agent took ${file.fileName} and never said whether it arrived. Check, then settle batch ${file.batchId}.`, 'Batch', file.batchId);
        app.runtime.uploadingSince.delete(file.id);
      }
    }
  }

  const board = await gasDayBoard(app);
  const minuteNow = awstMinutes(now);
  for (const card of board.days.filter((day) => day.offset === 0 || day.offset === 1)) {
    if (card.colour === 'grey') continue;
    const tomorrow = card.offset === 1;
    const deadline = tomorrow ? initialCutoff(card.gasDay) : renominationCutoff(card.gasDay);
    const beforeDeadline = now < deadline;
    const within = deadline.getTime() - now.getTime() <= settings.cutoffWarningMinutes * 60_000;
    const nothingHeld = card.held.lines === 0 && card.colour !== 'blue';
    const cutoffTime = tomorrow ? '14:00 today' : '20:00 today';
    const alertTime = tomorrow ? minuteNow >= minutesOfDay(settings.initialAlertTime) : within;
    if (nothingHeld && beforeDeadline && alertTime) {
      await raise(app, 'CUTOFF', 'Critical', `Nothing is accepted for Gas Day ${card.gasDay} and the cutoff is ${cutoffTime}.`, 'GasDay', gasDayEntity(card.gasDay));
    }
    if (card.held.lines && card.latest && ['VALIDATED', 'APPROVED', 'BUILT'].includes(card.latest.status) && beforeDeadline && within) {
      await raise(app, 'STALE', 'Warning', `Batch ${card.latest.batchId} for Gas Day ${card.gasDay} is not sent yet, and the cutoff is ${cutoffTime}. AGIG still holds the earlier numbers.`, 'GasDay', gasDayEntity(card.gasDay));
    }
  }

  // Cutoff and stale alerts for Gas Days that are over go by themselves.
  const over = Number(addDays(board.today, -1).replaceAll('-', ''));
  for (const alert of await app.store.listAlerts({ open: true, limit: 500 })) {
    if (['CUTOFF', 'STALE'].includes(alert.type) && alert.entityType === 'GasDay' && alert.entityId < over) {
      await app.store.updateAlert(alert.id, { clearedAt: now });
    }
  }

  if (settings.keyExpires) {
    const left = daysBetween(board.today, settings.keyExpires);
    const [threshold, severity] = left <= 0 ? [0, 'Critical'] : KEY_WARNINGS.find(([days]) => left <= days) ?? [];
    if (threshold !== undefined) {
      const message = left <= 0
        ? `AGIG's SFTP key expired on ${settings.keyExpires}. Uploads will fail until AGIG issues a new one.`
        : `AGIG's SFTP key expires on ${settings.keyExpires}, in ${left} days. Ask AGIG for a new one and update NOM_SFTP_KEY_EXPIRES.`;
      await raise(app, 'KEY_EXPIRY', severity, message, 'KeyDays', threshold);
    }
  }

  if (settings.agentEnabled) {
    const waiting = (await app.store.listFiles({ status: 'BUILT' })).filter((file) => now - new Date(file.builtAt) > 5 * 60_000);
    const quiet = !app.runtime.agentSeenAt || now - app.runtime.agentSeenAt > AGENT_QUIET_MS;
    if (waiting.length && quiet) {
      await raise(app, 'AGENT', 'Warning', `${waiting.length} file(s) are waiting and the upload agent on the office VM has not asked for work in 10 minutes. Check its scheduled task, or upload by hand.`);
    } else if (!quiet) {
      await clear(app, 'AGENT');
    }
  }
}

