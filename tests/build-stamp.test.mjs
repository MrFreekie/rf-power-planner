import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStampText, isNewerBuild, buildTimeFrom, watchForUpdate } from '../js/ui/buildStamp.js';

test('stamp text is empty for a missing or invalid time', () => {
  assert.equal(buildStampText(null), '');
  assert.equal(buildStampText('not a date'), '');
});
test('stamp text names the date and time', () => {
  const t = buildStampText('2026-11-18T14:05:00Z', 'en-GB');
  assert.match(t, /^Release v2026[.]11[.][0-9]{2} . [0-9]{2}:[0-9]{2}$/);
});

test('isNewerBuild and buildTimeFrom', () => {
  assert.equal(isNewerBuild('2026-11-18T10:00:00Z', '2026-11-18T11:00:00Z'), true);
  assert.equal(isNewerBuild('2026-11-18T10:00:00Z', '2026-11-18T10:00:00Z'), false);
  assert.equal(isNewerBuild('2026-11-18T10:00:00Z', null), false);
  assert.equal(isNewerBuild(null, '2026-11-18T10:00:00Z'), false);
  assert.equal(buildTimeFrom("export const BUILD_TIME = '2026-11-18T10:00:00Z';"), '2026-11-18T10:00:00Z');
  assert.equal(buildTimeFrom('export const BUILD_TIME = null;'), null);
});
test('watchForUpdate shows the button only when the published build is later', async () => {
  const mk = () => ({ hidden: true, title: '', clicks: [], addEventListener(t, f) { this.clicks.push(f); } });
  globalThis.document = globalThis.document || { baseURI: 'https://x.test/app/', visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} };
  const reply = (text) => async () => ({ ok: true, text: async () => text });
  const same = mk(); const s1 = watchForUpdate({ button: same, current: '2026-11-18T10:00:00Z', fetchFn: reply("export const BUILD_TIME = '2026-11-18T10:00:00Z';"), everyMs: 1e9 });
  await new Promise((r) => setTimeout(r, 10)); assert.equal(same.hidden, true); s1();
  const newer = mk(); let reloaded = 0; const s2 = watchForUpdate({ button: newer, current: '2026-11-18T10:00:00Z', fetchFn: reply("export const BUILD_TIME = '2026-11-18T12:00:00Z';"), reload: () => { reloaded++; }, everyMs: 1e9 });
  await new Promise((r) => setTimeout(r, 10)); assert.equal(newer.hidden, false); newer.clicks[0](); assert.equal(reloaded, 1); s2();
  const local = mk(); watchForUpdate({ button: local, current: null, fetchFn: reply('x') })(); assert.equal(local.hidden, true);
});
