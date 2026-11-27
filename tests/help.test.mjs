import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT_TIPS, HELP_TOPICS, HELP_SIDEBAR_IDS, tipFor } from '../js/ui/help.js';

test('tipFor matches exact text and "start*" keys, and ignores unknown or empty text', () => {
  assert.match(tipFor('Add platform'), /riser/);
  assert.match(tipFor('Radio items (4 mics)'), /signal order/);
  assert.match(tipFor('  Pack   list '), /printable/);
  assert.equal(tipFor('Nothing like this'), '');
  assert.equal(tipFor(''), '');
});

test('every text tip is a plain sentence without developer jargon, and every sidebar help id has a topic', () => {
  for (const [k, v] of Object.entries(TEXT_TIPS)) {
    assert.ok(v.length > 15 && /[.]$/.test(v), k);
    assert.ok(!/flag [SIU]\b|\.js\b|undefined/.test(v), k);
  }
  for (const id of HELP_SIDEBAR_IDS) assert.ok(HELP_TOPICS[id] && HELP_TOPICS[id].text.length > 40, id);
});
