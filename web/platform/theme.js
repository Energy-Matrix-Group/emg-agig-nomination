import { uiIcon } from './icons.js';

// The light and dark themes. A person's choice is kept in this browser as localStorage "emg-theme" ("light" or
// "dark"). With nothing kept, the page follows the system setting. The platform layer the server adds to every
// page applies a kept choice before the first paint, so a page never flashes the wrong theme.
const KEY = 'emg-theme';

export function storedTheme() {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function currentTheme() {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // Private windows may refuse storage; the theme still changes for this page.
  }
  document.dispatchEvent(new CustomEvent('emg-theme', { detail: { theme } }));
}

// A square button that switches between light and dark. It shows the theme it will switch to.
export function themeToggle() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button theme-toggle';
  const draw = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    button.replaceChildren(uiIcon(next === 'dark' ? 'moon' : 'sun'));
    button.setAttribute('aria-label', `Switch to the ${next} theme`);
    button.title = `Switch to the ${next} theme`;
  };
  button.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  document.addEventListener('emg-theme', draw);
  if (typeof window.matchMedia === 'function') window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', draw);
  draw();
  return button;
}
