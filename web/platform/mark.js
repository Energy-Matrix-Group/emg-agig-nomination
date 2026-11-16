import { TILES } from './mark-tiles.js';

// The Energy Matrix mark drawn inline, so a page can animate it with its own CSS (motion.css):
//
//   logoMark({ mode: 'assemble' })  the tiles fly in and lock together, then a light sweeps across now and then
//   logoMark({ mode: 'loader' })    the loader's cycle, inline: blow apart, snap back, spin once, again and again
//   logoMark()                      the finished mark
//
// Pointing at the mark, or pressing it, makes it blow apart and spin once. It is decoration: hidden from
// screen readers unless a label is given.
const SVG_NS = 'http://www.w3.org/2000/svg';
let made = 0;

export function logoMark({ mode = 'static', label = '', playful = true } = {}) {
  made += 1;
  const id = `emg-mark-${made}`;
  const svg = node('svg', { viewBox: '-20 -20 340 340', class: `emg-mark emg-mark--${mode}`, fill: 'none' });
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }

  const defs = node('defs');
  const clip = node('clipPath', { id: `${id}-clip` });
  clip.append(node('path', { d: 'M150 0 300 150 150 300 0 150Z' }));
  const sweep = node('linearGradient', { id: `${id}-sweep`, x1: '0', x2: '1', y1: '0', y2: '0' });
  for (const [offset, opacity] of [['0', '0'], ['.5', '.5'], ['1', '0']]) {
    sweep.append(node('stop', { offset, 'stop-color': '#fff', 'stop-opacity': opacity }));
  }
  defs.append(clip, sweep);

  const wave = node('path', { class: 'emg-wave', d: 'M150 96 204 150 150 204 96 150Z', 'stroke-width': '3', 'vector-effect': 'non-scaling-stroke' });
  wave.style.stroke = 'var(--emg-accent)';

  const spin = node('g', { class: 'emg-mark__spin' });
  const gather = node('g', { class: 'emg-mark__gather' });
  for (const tile of TILES) {
    const path = node('path', { class: 'emg-tile', d: tile.d });
    if (tile.fill === 'dark') path.style.fill = 'var(--emg-logo-dark, #2E3541)';
    else path.setAttribute('fill', tile.fill);
    path.style.setProperty('--x', `${tile.x}px`);
    path.style.setProperty('--y', `${tile.y}px`);
    path.style.setProperty('--r', `${tile.r}deg`);
    path.style.setProperty('--s', String(tile.s));
    path.style.setProperty('--delay', `${tile.delay}ms`);
    path.style.setProperty('--enter', `${tile.enter}ms`);
    gather.append(path);
  }
  const shineClip = node('g', { 'clip-path': `url(#${id}-clip)` });
  const tilt = node('g', { transform: 'rotate(24 150 150)' });
  tilt.append(node('rect', { class: 'emg-shine', x: '-230', y: '-80', width: '90', height: '460', fill: `url(#${id}-sweep)` }));
  shineClip.append(tilt);
  gather.append(shineClip);
  spin.append(gather);
  svg.append(defs, wave, spin);

  if (playful && mode !== 'loader') {
    const burst = () => {
      if (svg.classList.contains('is-bursting')) return;
      svg.classList.remove('emg-mark--assemble');
      svg.classList.add('is-bursting');
    };
    spin.addEventListener('animationend', (event) => {
      if (event.target === spin && event.animationName === 'emg-spin') svg.classList.remove('is-bursting');
    });
    svg.addEventListener('pointerenter', burst);
    svg.addEventListener('click', burst);
  }
  return svg;
}

function node(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
