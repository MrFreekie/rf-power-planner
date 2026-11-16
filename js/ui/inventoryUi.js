// Inventory panel: every mic and IEM link in the show as a list you can click, a card for the selected link, and the gear to pack.
// Clicking a row selects that link's transmitter, so the plan highlights it, the side view follows it and the inspector opens its fields.
// Pure helpers (inventoryView) are tested without a DOM; mountInventory() builds the panel.
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
  if (totals.other) parts.push(`${totals.other} other`);
  return { rows: rows.map((r) => ({ ...r, active: r.id === activeId, statusWord: STATUS_WORD[r.status] || '-' })), totals, card, summary: parts.join(', ') || 'no links' };
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export function mountInventory({ container, store }) {
  container.textContent = '';
  const summary = el('summary', container.tagName === 'DETAILS' ? '' : 'ob-summary', 'Inventory and links');
  const body = el('div', 'ob-body');
  container.append(summary, body);
  if (container.tagName === 'DETAILS') container.open = true;
  const intro = el('p', 'hint', 'Every link in the show. Pick one to see it highlighted in the plan, followed in the side view and opened in the inspector.');
  const out = el('div', 'inv-out');
  out.setAttribute('aria-live', 'polite');
  body.append(intro, out);

  function render() {
    const scene = store.getScene();
    const results = scene.links.map((l) => solveCached(scene, l));
    const v = inventoryView(scene, store.getSelection(), results);
    summary.textContent = `Inventory and links (${v.summary})`;
    out.textContent = '';
    if (!v.rows.length) { out.append(el('p', 'hint', 'No links yet. Use the Mic or IEM button in the toolbar to start.')); return; }

    const table = el('table', 'ob-table inv-table');
    table.append(Object.assign(el('caption', 'sr-only'), { textContent: 'Every link: name, frequency, transmitter and receiver, and margin. The row for the selected link is marked current.' }));
    const head = el('thead'); head.innerHTML = '<tr><th scope="col">Link</th><th scope="col" class="num">MHz</th><th scope="col">Equipment</th><th scope="col" class="num">Margin</th></tr>';
    const tb = el('tbody');
    for (const r of v.rows) {
      const tr = el('tr'); if (r.active) tr.dataset.active = 'true';
      const th = el('th'); th.scope = 'row';
      const b = el('button', 'inv-pick', r.name || r.id); b.type = 'button';
      b.dataset.kind = r.kind; if (r.active) b.setAttribute('aria-current', 'true');
      b.title = `Select ${r.name || 'this link'}: highlight it in the plan and follow it in the side view`;
      b.addEventListener('click', () => { const l = store.getScene().links.find((q) => q.id === r.id); if (l) store.select(l.tx.id); });
      th.append(b);
      const short = (t) => t.replace(/^Generic /, '').replace(/ \((illustrative|assumed figures)\)$/, '').replace(/, typical$/, '');
      const eq = el('td', 'inv-eq', `${short(r.txItem)} / ${short(r.rxItem)}`); eq.title = `Transmitter: ${r.txItem}. Receiver: ${r.rxItem}.`;
      const mar = el('td', 'num', r.status ? `${r.marginDb} dB` : '-'); if (r.status) mar.dataset.status = r.status;
      tr.append(th, el('td', 'num', String(r.freqMHz)), eq, mar);
      tb.append(tr);
    }
    table.append(head, tb);
    out.append(table);

    if (v.card) {
      const card = el('div', 'inv-card'); card.setAttribute('role', 'group'); card.setAttribute('aria-label', `Selected link: ${v.card.row.name}`);
      card.append(el('h4', '', v.card.row.name));
      for (const line of v.card.lines) card.append(el('p', 'hint', line));
      out.append(card);
    }

    const pack = el('details', 'inv-pack'); pack.append(el('summary', '', 'What to pack'));
    const list = (title, items, fmt) => { if (!items.length) return; pack.append(el('h5', '', title)); const ul = el('ul'); for (const it of items) ul.append(el('li', '', fmt(it))); pack.append(ul); };
    list('Transmitters', v.totals.transmitters, (x) => `${x.count} x ${x.label}`);
    list('Receivers and bodypacks', v.totals.receivers, (x) => `${x.count} x ${x.label}`);
    list('Antennas (body-worn excluded)', v.totals.antennas, (x) => `${x.count} x ${x.label}`);
    list('Cables', v.totals.cables, (x) => `${x.count} x ${x.label}, ${x.lengthM} m in total`);
    out.append(pack);
  }

  let queued = false;
  const unsub = store.subscribe(() => { if (queued) return; queued = true; const run = () => { queued = false; try { render(); } catch (err) { console.error('inventory', err); } }; setTimeout(run, 30); }); // a timer, not requestAnimationFrame: a hidden pane pauses animation frames and the list would go stale
  render();
  return { render, destroy: unsub };
}
