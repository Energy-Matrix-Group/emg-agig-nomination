import { api } from './api.js';

const status = await api('/api/status');
if (status.ok && status.data.databaseConnected === false) {
  const banner = document.createElement('p');
  banner.className = 'dev-banner';
  banner.setAttribute('role', 'status');
  banner.textContent = 'Dev only. No database connection. All content and tickets are for demonstration only.';
  document.body.prepend(banner);
  // The sticky sidebar starts below the banner, so it needs the banner's height, which grows when it wraps.
  const measure = () => document.body.style.setProperty('--emg-banner-height', `${banner.offsetHeight}px`);
  measure();
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(banner);
}
