import test from 'node:test';
import assert from 'node:assert/strict';
import { getLinkFocus, setLinkFocus, subscribeLinkFocus, linkIdOfItem } from '../js/view/linkFocus.js';
import { buildExample } from '../js/examples.js';

test('focus notifies only on change and can be cleared', () => {
  const seen = [], off = subscribeLinkFocus((id) => seen.push(id));
  setLinkFocus('a'); setLinkFocus('a'); setLinkFocus(null); setLinkFocus(undefined);
  off(); setLinkFocus('b');
  assert.deepEqual(seen, ['a', null]);
  assert.equal(getLinkFocus(), 'b');
  setLinkFocus(null);
});

test('an item id maps to the link that owns that transmitter or receiver', () => {
  const sc = buildExample('band-four-piece-people').scene, l = sc.links[3];
  assert.equal(linkIdOfItem(sc, l.tx.id), l.id);
  assert.equal(linkIdOfItem(sc, l.rx.id), l.id);
  assert.equal(linkIdOfItem(sc, 'nope'), null);
  assert.equal(linkIdOfItem(sc, null), null);
});
