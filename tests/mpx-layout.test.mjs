// Layout rule: the spectrum plots in the bottom bar never shrink below 84 px (the stereo MPX readouts scroll instead of squashing the plot).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
test('bottom-bar spectrum plots keep a minimum height of at least 84 px and the panel scrolls', () => {
  const m = css.match(/@media \(min-width: 1100px\) and \(min-height: 560px\) \{ #spectra \.spectrum-panel \{ overflow-y: auto; \} #spectra \.spectrum-panel \.spectrum-canvas \{ min-height: (\d+)px; \} \}/);
  assert.ok(m, 'the rule exists');
  assert.ok(Number(m[1]) >= 84);
  const base = css.match(/\.spectrum-canvas \{ flex: 1 1 0; height: auto; min-height: (\d+)px; \}/);
  assert.ok(base && Number(base[1]) < Number(m[1]), 'the override raises the old 56 px minimum');
});
