// Inventory panel: every mic and IEM link in the show as a list you can click, a card for the selected link, and the gear to pack.
// Clicking a row selects that link's transmitter, so the plan highlights it, the side view follows it and the inspector opens its fields.
// Pure helpers (inventoryView) are tested without a DOM; mountInventory() builds the panel.
import { inventoryRows, inventoryTotals, linkCard, gearOptions, powerChoices } from '../model/inventory.js';
import { setTxFmPreset, setRxFmPreset, setTxPowerOption, setModulation, addLink, shareRxAntenna, unshareRxAntenna } from '../actions.js';
import { DIGITAL_PRESETS } from '../model/digital-params.js';
import { activeLink, solveCached } from '../view/util.js';
import { getLinkFocus, setLinkFocus, subscribeLinkFocus } from '../view/linkFocus.js';

const STATUS_WORD = { pass: 'Pass', marginal: 'Marginal', fail: 'Fail' };

/** inventoryView(scene, selection, results?) -> { rows (with .active), totals, card, summary } for the panel. */
export function inventoryView(scene, selection, results) {
  const rows = inventoryRows(scene, results), act = activeLink(scene, selection), activeId = act ? act.id : null;
  const totals = inventoryTotals(rows, scene);
  const card = activeId ? linkCard(scene, activeId, results) : null;
  const parts = [];
  if (totals.mics) parts.push(`${totals.mics} mic${totals.mics === 1 ? '' : 's'}`);
  if (totals.iems) parts.push(`${totals.iems} IEM${totals.iems === 1 ? '' : 's'}`);
  const p2p = rows.filter((r) => r.kind === 'p2p').length;
  if (p2p) parts.push(`${p2p} P2P`);
  if (totals.other - p2p > 0) parts.push(`${totals.other - p2p} other`);
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
  const bar = el('div', 'inv-add'), msg = el('p', 'hint inv-msg'); msg.setAttribute('role', 'status');
  for (const [kind, word] of [['mic', 'microphone'], ['iem', 'in-ear monitor']]) {
    const b = el('button', '', `Add ${kind === 'mic' ? 'mic' : 'IEM'}`); b.type = 'button';
    b.title = `Add another ${word} link at the next free frequency, beside the last one`;
    b.addEventListener('click', () => {
      const id = addLink(store, kind);
      if (!id) { msg.textContent = 'The link limit has been reached.'; return; }
      const l = store.getScene().links.find((q) => q.id === id);
      msg.textContent = `Added ${l.name} at ${l.freqMHz} MHz. Check it against the others in the Coordination panel.`;
      store.select(l.tx.id);
    });
    bar.append(b);
  }
  body.append(intro, bar, msg, out);

  /** Transmitter model, power and receiver model selects for one link. Each change is one undoable step through the same actions the inspector uses. */
  function gearPickers(link) {
    const opts = gearOptions(link), wrap = el('div', 'inv-gear');
    const mod = link.modulation || { type: 'analog-fm', digital: {} };
    const pick = (label, items, current, onPick) => {
      const lab = el('label', 'inv-field'); lab.append(el('span', '', label));
      const sel = el('select'); sel.setAttribute('aria-label', `${label} for ${link.name}`);
      for (const [v, t] of items) sel.append(Object.assign(el('option', '', t), { value: v }));
      sel.value = current; sel.addEventListener('change', () => onPick(sel.value)); lab.append(sel); return lab;
    };
    wrap.append(pick('Modulation', [['analog-fm', 'Analog FM'], ['digital', 'Digital']], mod.type, (v) => setModulation(store, link.id, { type: v })));
    if (mod.type === 'digital') {
      wrap.append(pick('Digital preset', Object.entries(DIGITAL_PRESETS).map(([id, p]) => [id, p.label || id]), (mod.digital && mod.digital.preset) || '', (v) => setModulation(store, link.id, { preset: v, fixedOrder: null })));
      wrap.append(pick('Digital order', [['', 'Adaptive'], ['2', 'BPSK'], ['4', 'QPSK'], ['16', '16-QAM'], ['64', '64-QAM'], ['256', '256-QAM']], mod.digital && mod.digital.fixedOrder ? String(mod.digital.fixedOrder) : '', (v) => setModulation(store, link.id, { fixedOrder: v ? Number(v) : null })));
    }
    if (link.kind === 'mic') {
      const all = store.getScene().links, hasFollowers = all.some((q) => q.rx.sharedAntennaOf === link.id);
      const sources = all.filter((q) => q.kind === 'mic' && q.id !== link.id && q.rx.sharedAntennaOf === undefined);
      const f = pick('Receive antenna', [['', 'Its own antenna'], ...sources.map((q) => [q.id, `Shared with ${q.name} (splitter)`])], link.rx.sharedAntennaOf || '', (v) => { if (v) shareRxAntenna(store, link.id, v); else unshareRxAntenna(store, link.id); });
      if (hasFollowers) { f.querySelector('select').disabled = true; f.append(el('small', 'hint', 'Other links share this antenna. Move this receiver to move all of them.')); }
      else if (link.rx.sharedAntennaOf) f.append(el('small', 'hint', 'Position and antenna follow the other link; a splitter at the antenna end costs each receiver its share of the signal.'));
      wrap.append(f);
    }
    if (!opts.tx.length && !opts.rx.length) return wrap;
    const field = (label, current, list, generic, onPick) => {
      const lab = el('label', 'inv-field'); lab.append(el('span', '', label));
      const sel = el('select'); sel.setAttribute('aria-label', `${label} for ${link.name}`);
      if (generic) sel.append(Object.assign(el('option', '', generic), { value: '' }));
      const groups = [[`Tunes at ${link.freqMHz} MHz`, list.filter((o) => o.tunes)], ['Does not tune at this frequency', list.filter((o) => !o.tunes)]];
      for (const [title, items] of groups) {
        if (!items.length) continue;
        const og = el('optgroup'); og.label = title;
        for (const o of items) og.append(Object.assign(el('option', '', o.label + (o.assumed ? ' *' : '')), { value: o.id }));
        sel.append(og);
      }
      sel.value = current || '';
      sel.addEventListener('change', () => onPick(sel.value));
      lab.append(sel); return lab;
    };
    wrap.append(field('Transmitter model', link.tx.fmPreset, opts.tx, 'Generic (no model)', (id) => setTxFmPreset(store, link.id, id)));
    const pc = powerChoices(link);
    if (pc.options.length) {
      const lab = el('label', 'inv-field'); lab.append(el('span', '', 'Transmit power'));
      const sel = el('select'); sel.setAttribute('aria-label', `Transmit power for ${link.name}`);
      for (const o of pc.options) sel.append(Object.assign(el('option', '', o.label), { value: o.id }));
      if (pc.current) sel.value = pc.current;
      sel.addEventListener('change', () => setTxPowerOption(store, link.id, sel.value));
      lab.append(sel); wrap.append(lab);
    }
    wrap.append(field('Receiver model', link.rx.rxPreset && opts.rx.some((o) => o.id === link.rx.rxPreset) ? link.rx.rxPreset : '', opts.rx, 'Generic (typical)', (id) => { if (id) setRxFmPreset(store, link.id, id); }));
    wrap.append(el('p', 'hint', 'Class figures from published specifications; * marks a model with some assumed figures. Models are grouped by whether they tune at this link’s frequency.'));
    return wrap;
  }

  function render() {
    const scene = store.getScene();
    const results = scene.links.map((l) => solveCached(scene, l));
    const v = inventoryView(scene, store.getSelection(), results);
    summary.textContent = `Inventory and links (${v.summary})`;
    out.textContent = '';
    if (!v.rows.length) { out.append(el('p', 'hint', 'No links yet. Use Add mic or Add IEM above.')); return; }

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
      tr.dataset.link = r.id; if (getLinkFocus() === r.id) tr.dataset.focus = 'true';
      for (const ev of ['pointerenter', 'focus']) b.addEventListener(ev, () => setLinkFocus(r.id));
      for (const ev of ['pointerleave', 'blur']) b.addEventListener(ev, () => setLinkFocus(null));
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
      const link = scene.links.find((q) => q.id === v.card.row.id);
      if (link) card.append(gearPickers(link));
      out.append(card);
    }

    const pack = el('details', 'inv-pack'); pack.append(el('summary', '', 'What to pack'));
    const list = (title, items, fmt) => { if (!items.length) return; pack.append(el('h5', '', title)); const ul = el('ul'); for (const it of items) ul.append(el('li', '', fmt(it))); pack.append(ul); };
    list('Transmitters', v.totals.transmitters, (x) => `${x.count} x ${x.label}`);
    list('Receivers and bodypacks', v.totals.receivers, (x) => `${x.count} x ${x.label}`);
    list('Antennas (body-worn excluded)', v.totals.antennas, (x) => `${x.count} x ${x.label}`);
    if (v.totals.loads && v.totals.loads.total) list('Terminations', [v.totals.loads], (x) => `${x.total} x 50 ohm load, 1 W or more (${x.dummyLoads} dummy load${x.dummyLoads === 1 ? '' : 's'} for transmitters, ${x.freePorts} for unused splitter or combiner ports)`);
    list('Cables', v.totals.cables, (x) => `${x.count} x ${x.label}, ${x.lengthM} m in total`);
    out.append(pack);
  }

  let queued = false;
  const unsub = store.subscribe(() => { if (queued) return; queued = true; const run = () => { queued = false; try { render(); } catch (err) { console.error('inventory', err); } }; setTimeout(run, 30); }); // a timer, not requestAnimationFrame: a hidden pane pauses animation frames and the list would go stale
  // the plan sets the focus when the pointer is on a transmitter or receiver: mark that link's row without rebuilding the table
  const markFocus = (id) => { for (const tr of out.querySelectorAll('tr[data-link]')) { if (tr.dataset.link === id) tr.dataset.focus = 'true'; else delete tr.dataset.focus; } };
  const unsubFocus = subscribeLinkFocus(markFocus);
  render();
  return { render, destroy() { unsub(); unsubFocus(); } };
}
