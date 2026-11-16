// Raising and clearing alerts. An open alert for the same thing is never raised twice (the store checks), so a job
// that runs every minute can call raise() each time it sees a problem. The watchdog (watchdog.js) raises most of
// them; the batch and response steps raise the rest as they happen.

export const ALERT_TYPES = {
  REJECTED: 'AGIG rejected a file',
  NO_RESPONSE: 'No answer from AGIG',
  UPLOAD_UNCERTAIN: 'Upload uncertain',
  UPLOAD_FAILED: 'Upload keeps failing',
  LATE: 'A file missed its cutoff',
  CUTOFF: 'Cutoff close with nothing accepted',
  STALE: 'Newer numbers not sent',
  KEY_EXPIRY: 'SFTP key expiring',
  RESPONSE_REVIEW: 'A response needs a look',
  TEMPLATE: 'AGIG says the file format changed',
  REFERENCE: 'Reference data may be out of date',
  MAILBOX: 'Cannot read the response mailbox',
  AGENT: 'The upload agent is quiet',
};

export const gasDayEntity = (day) => Number(day.replaceAll('-', ''));
export const gasDayOfEntity = (id) => `${String(id).slice(0, 4)}-${String(id).slice(4, 6)}-${String(id).slice(6, 8)}`;

export async function raise(app, type, severity, message, entityType = null, entityId = null) {
  return app.store.raiseAlert({ type, severity, message, entityType, entityId });
}

export async function clear(app, type, entityType = null, entityId = null) {
  return app.store.clearAlerts({ type, entityType, entityId });
}
