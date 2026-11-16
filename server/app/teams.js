import { ALERT_TYPES } from './alerts.js';

// New alerts, posted to a Teams channel through a Workflows webhook (NOM_TEAMS_WEBHOOK_URL), from the background
// job only: never inside a person's request. Info alerts stay on the System page. The app remembers the last
// alert it posted while it runs, and starts after the newest one at boot, so a restart never posts old alerts again.

export async function startTeams(app) {
  const [newest] = await app.store.listAlerts({ limit: 1 });
  app.runtime.postedThrough = newest?.id ?? 0;
}

export async function postNewAlerts(app) {
  if (!app.settings.teamsWebhook) return 0;
  const fresh = await app.store.listAlerts({ afterId: app.runtime.postedThrough, limit: 20, oldestFirst: true });
  let posted = 0;
  for (const alert of fresh) {
    if (alert.severity !== 'Info') {
      const response = await app.fetch(app.settings.teamsWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card(alert, app)),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Teams answered ${response.status}`);
      posted += 1;
    }
    app.runtime.postedThrough = alert.id;
  }
  return posted;
}

function card(alert, app) {
  const title = `${app.settings.environment === 'PROD' ? '' : `[${app.settings.environment}] `}${ALERT_TYPES[alert.type] ?? alert.type}`;
  const content = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true, color: alert.severity === 'Critical' ? 'Attention' : 'Warning' },
      { type: 'TextBlock', text: alert.message, wrap: true },
    ],
    actions: app.appUrl ? [{ type: 'Action.OpenUrl', title: 'Open AGIG Nominations', url: `${app.appUrl}/system/` }] : [],
  };
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content }] };
}
