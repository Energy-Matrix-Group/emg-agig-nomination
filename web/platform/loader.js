// The Energy Matrix loader: the logo blows apart, snaps back together and spins once, over and over.
// The drawing and its motion are in logo/loader.svg; tokens.css picks the light or dark copy as --emg-loader.
//
//   loader({ label })   a loading state to put in a page while something loads
//   bootDone()          lifts the start-up splash (<div class="emg-boot" data-boot>) once the page can be used.
//                       shell.js calls it when the sidebar is drawn, so most pages never need to.

const FIRST_VISIT_MS = 950; // the first page in a tab keeps the splash long enough to see the mark blow apart
const SEEN = 'emg-booted';
const started = typeof performance !== 'undefined' ? performance.now() : 0;

export function loader({ label = 'Loading', inline = false } = {}) {
  const box = document.createElement('div');
  box.className = inline ? 'emg-loading emg-loading--inline' : 'emg-loading';
  box.setAttribute('role', 'status');
  const mark = document.createElement('span');
  mark.className = 'emg-loader';
  mark.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = label;
  box.append(mark, text);
  return box;
}

let lifting = false;

export function bootDone() {
  const boot = document.querySelector('[data-boot]');
  if (!boot || lifting) return;
  lifting = true;
  const firstVisit = !seenBefore();
  const wait = firstVisit ? Math.max(0, FIRST_VISIT_MS - (performance.now() - started)) : 0;
  window.setTimeout(() => {
    boot.classList.add('is-done');
    boot.setAttribute('aria-hidden', 'true');
    const remove = () => boot.remove();
    boot.addEventListener('transitionend', remove, { once: true });
    window.setTimeout(remove, 600);
  }, wait);
}

function seenBefore() {
  try {
    if (window.sessionStorage.getItem(SEEN)) return true;
    window.sessionStorage.setItem(SEEN, '1');
  } catch {
    return true;
  }
  return false;
}
