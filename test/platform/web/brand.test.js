import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { TILES } from '../../../web/platform/mark-tiles.js';

// The look is part of the platform: these pin the pieces every app relies on.
const platform = new URL('../../../web/platform/', import.meta.url);
const read = (file) => readFile(new URL(file, platform), 'utf8');

test('the loader is the 29-tile mark: it blows apart, spins once, and holds still for less motion', async () => {
  for (const file of ['logo/loader.svg', 'logo/loader-on-dark.svg']) {
    const svg = await read(file);
    assert.equal((svg.match(/class="t"/g) ?? []).length, 29, file);
    assert.match(svg, /@keyframes burst/, file);
    assert.match(svg, /@keyframes spin[^}]*\{[^}]*\}\s*88%, 100% \{ transform: rotate\(360deg\); \}/, `${file} spins once`);
    assert.match(svg, /@media \(prefers-reduced-motion: reduce\)/, file);
  }
  assert.doesNotMatch(await read('logo/loader-on-dark.svg'), /#2E3541/, 'the darkest tiles are white on a dark background');
});

test('the inline mark has the same 29 tiles, each with a flight to blow apart along', () => {
  assert.equal(TILES.length, 29);
  for (const tile of TILES) {
    assert.match(tile.d, /^M[\d.\s]+L/);
    for (const key of ['x', 'y', 'r', 's', 'delay', 'enter']) assert.equal(typeof tile[key], 'number', key);
  }
});

test('the dark theme sets only tokens the light theme has, the same in both places, with its own loader', async () => {
  const tokens = await read('tokens.css');
  const [light, systemDark, chosenDark, print] = tokens.split(/(?=@media \(prefers-color-scheme: dark\)|^:root\[data-theme="dark"\]|^\/\* ---- Print)/m);
  const names = (text) => [...text.matchAll(/(--emg-[a-z0-9-]+):/g)].map(([, name]) => name).sort();
  const lightNames = new Set(names(light));
  for (const name of names(systemDark)) assert.ok(lightNames.has(name), `${name} has a light value`);
  assert.deepEqual(names(systemDark), names(chosenDark), 'the system and the chosen dark theme set the same tokens');
  assert.match(light, /--emg-loader: url\("\/platform\/logo\/loader\.svg"\)/);
  assert.match(systemDark, /--emg-loader: url\("\/platform\/logo\/loader-on-dark\.svg"\)/);

  // Paper is never dark: print sets every token the dark theme changes back to its light value.
  assert.match(print, /@media print \{\s*:root:root:root \{/);
  assert.deepEqual(names(print), names(systemDark));
  const value = (text, name) => new RegExp(`${name}:\\s*([^;]+);`).exec(text)?.[1].trim();
  for (const name of names(print)) assert.equal(value(print, name), value(light, name), name);
});

test('app.css gathers every layer, in order, and each exists', async () => {
  const app = await read('app.css');
  const layers = [...app.matchAll(/@import url\("\/platform\/([a-z-]+\.css)"\)/g)].map(([, file]) => file);
  assert.deepEqual(layers, ['tokens.css', 'base.css', 'chrome.css', 'signin.css', 'components.css', 'motion.css', 'soon.css', 'band.css']);
  for (const layer of layers) assert.ok((await read(layer)).trim().length > 0, layer);
});

test('the platform keeps the brand square: no rounded corners', async () => {
  for (const file of ['base.css', 'chrome.css', 'signin.css', 'components.css', 'motion.css', 'soon.css', 'band.css', 'db-wake.css']) {
    for (const [, value] of (await read(file)).matchAll(/border-radius:\s*([^;]+);/g)) {
      assert.match(value.trim(), /^0(px)?$/, `${file} rounds a corner (${value})`);
    }
  }
});

// Charts take their colours from tokens (docs/STYLE-GUIDE.md, 3.4), so every theme must have the whole set.
test('the chart colours are tokens with a light and a dark value', async () => {
  const tokens = await read('tokens.css');
  const [light, systemDark, chosenDark] = tokens.split(/(?=@media \(prefers-color-scheme: dark\)|^:root\[data-theme="dark"\]|^\/\* ---- Print)/m);
  const fuels = ['coal', 'brown-coal', 'gas', 'distillate', 'bioenergy', 'hydro', 'solar-rooftop', 'solar-utility', 'wind', 'battery', 'battery-charging', 'imports', 'exports'];
  const names = [...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--emg-series-${n}`), ...fuels.map((fuel) => `--emg-fuel-${fuel}`), '--emg-chart-price'];
  for (const name of names) {
    for (const [theme, text] of [['light', light], ['system dark', systemDark], ['chosen dark', chosenDark]]) {
      assert.match(text, new RegExp(`${name}:\\s*#[0-9A-F]{6};`), `${name} in the ${theme} theme`);
    }
  }
});
