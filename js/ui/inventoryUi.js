// Inventory view data (pure): rows, totals and the selected link's card. The panel itself is the Radio items list (rackUi.js).
// Clicking a row selects that link's transmitter, so the plan highlights it, the side view follows it and the inspector opens its fields.
import { inventoryRows, inventoryTotals, linkCard } from '../model/inventory.js';
import { activeLink, solveCached } from '../view/util.js';

const STATUS_WORD = { pass: 'Pass', marginal: 'Marginal', fail: 'Fail' };

/** inventoryView(scene, selection, results?) -> { rows (with .active), totals, card, summary } for the panel. */
export function inventoryView(scene, selection, results) {
  const rows = inventoryRows(scene, results), act = activeLink(scene, selection), activeId = act ? act.id : null;
  const totals = inventoryTotals(rows, scene);
  const card = activeId ? linkCard(scene, activeId, results) : null;
  const parts = [];
  if (totals.mics) parts.push(`${totals.mics} mic${totals.mics === 1 ? '' : 's'}`);
  if (totals.iems) parts.push(`${totals.iems} IEM${totals.iems === 1 ? '' : 's'}`);
  if (totals.extraReceivers) parts.push(`${totals.extraReceivers} extra receiver${totals.extraReceivers === 1 ? '' : 's'}`);
  const p2p = rows.filter((r) => r.kind === 'p2p').length;
  if (p2p) parts.push(`${p2p} P2P`);
  if (totals.other - p2p > 0) parts.push(`${totals.other - p2p} other`);
  return { rows: rows.map((r) => ({ ...r, active: r.id === activeId, statusWord: STATUS_WORD[r.status] || '-' })), totals, card, summary: parts.join(', ') || 'no links' };
}
