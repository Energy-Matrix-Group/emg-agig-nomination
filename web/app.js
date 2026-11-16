import { api } from '/platform/api.js';
import { appIcon } from '/platform/icons.js';
import { mountChrome, requireUser } from '/platform/shell.js';

const ID = document.body.dataset.app; // set in index.html: the one place this page names the app
const message = document.querySelector('[data-message]');
const screen = document.querySelector('[data-screen]');

function showMessage(text) {
  message.hidden = false;
  message.textContent = text;
}

// requireUser() checks the session. If it has ended, the platform has already sent the page to the portal.
const session = await requireUser();
if (session?.error) {
  showMessage(session.error);
} else if (session?.user) {
  const appResult = await api(`/api/apps/${ID}`);
  if (!appResult.ok) {
    await mountChrome(session.user);
    showMessage(appResult.data.error || 'Cannot load this app.');
  } else {
    const app = appResult.data.app;
    await mountChrome(session.user, { app, links: [{ label: 'Hello', href: '/', icon: app.id, current: true }] });
    document.title = `${app.name} — EMG`;
    document.querySelector('[data-page-icon]').append(appIcon(app.id));
    document.querySelector('[data-title]').textContent = app.name;
    document.querySelector('[data-description]').textContent = app.description;
    screen.hidden = false;

    const hello = await api(`/api/${ID}/hello`);
    if (hello.ok) document.querySelector('[data-hello]').textContent = hello.data.message;
    else showMessage(hello.data.error || 'Could not load the greeting.');
  }
}
