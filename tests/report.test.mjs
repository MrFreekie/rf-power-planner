import test from 'node:test';
import assert from 'node:assert/strict';
import { sortWarnings, reportFileName, statusWord } from '../js/view/report.js';

test('sortWarnings puts critical first and keeps order within a severity', () => {
  const w = [{ severity: 'info', text: 'a' }, { severity: 'warning', text: 'b' }, { severity: 'critical', text: 'c' }, { severity: 'warning', text: 'd' }];
  assert.deepEqual(sortWarnings(w).map((x) => x.text), ['c', 'b', 'd', 'a']);
  assert.deepEqual(sortWarnings(undefined), []);
});

test('reportFileName is filesystem safe', () => {
  assert.equal(reportFileName('Link budget: Mic 1', '2026-11-13'), 'link-budget-mic-1-2026-11-13.png');
  assert.equal(reportFileName('', ''), 'report.png');
  assert.equal(reportFileName('A/B?*', '2026-01-02', 'pdf'), 'a-b-2026-01-02.pdf');
});

test('statusWord', () => {
  assert.equal(statusWord('pass'), 'PASS');
  assert.equal(statusWord('marginal'), 'MARGINAL');
  assert.equal(statusWord('x'), 'UNKNOWN');
});
