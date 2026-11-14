import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const css = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

test('desktop layout fits the viewport: height media queries, no page scroll, panels flex', () => {
  assert.match(css, /@media \(min-width: 1100px\) and \(min-height: 560px\) \{[^@]*body \{[^}]*overflow: hidden/);
  assert.match(css, /@media \(min-width: 1100px\) and \(min-height: 560px\) and \(max-height: 1000px\)/);
  assert.match(css, /@media \(min-width: 1100px\) and \(min-height: 560px\) and \(max-height: 760px\)/);
  assert.match(css, /100dvh/);
  assert.match(css, /#bottombar \{ flex: none; height: clamp\(/);
});
test('phone and tablet keep the scrolling single-column layout', () => {
  assert.match(css, /@media \(max-width: 800px\) \{\s*body \{ height: auto; min-height: 100dvh; \}/);
});
test('compact toolbar keeps at least 24 px targets', () => {
  const m = css.match(/\(max-height: 1000px\) \{[\s\S]*?#toolbar button, #toolbar select, #toolbar input \{ min-height: (\d+)px/);
  assert.ok(m && +m[1] >= 24);
});
