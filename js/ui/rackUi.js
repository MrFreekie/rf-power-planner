// Radio items panel: every mic, receive antenna, splitter, receiver, IEM transmitter, combiner, transmit antenna and bodypack, in signal order.
// Each item's summary shows its status and key numbers; opening it shows the signal flow (links), the essentials, and an Advanced section with the rest
// (the selected link's own inspector sections dock there). Edits go through js/actionsRack.js and js/actionsRadio.js (one undo step each).
import { rackSections, deriveRack, rackWarnings, rackLoads, channelRoute, splitterLoad, loopHops } from '../model/rack.js';
import { signalFlow, statusOf, radioChecks } from '../model/radio-items.js';
import { solveCached, activeLink } from '../view/util.js';
import { ANTENNAS } from '../model/library.js';
import { FM_PRESETS } from '../model/fm-presets.js';
import { txFormFactor, txDeviceName, inventoryRows, inventoryTotals, packListText } from '../model/inventory.js';
import { inventoryView } from './inventoryUi.js';
import { poweringBudget, poweringLine } from '../model/powering.js';
import { erpCheck } from '../model/erp.js';
import { formatPower, formatDb } from '../model/units.js';
import { getCoordRegion } from './region.js';
import { setLinkFocus } from '../view/linkFocus.js';
import { getLinkDock, subscribeLinkDock } from './linkDock.js';
import { peopleLinkOwners, addReceiverFor, removeLink } from '../actions.js';
import { removeRackItem, removeCombiner, removeReceiverChannel, removeTxChannel } from '../actionsRack.js';
import { duplicateRadioLink, moveRadioItem } from '../actionsRadio.js';
import { makeEditors, runLossDb } from './rackEditors.js';
import { addBar } from './rackAddBar.js';
import { el, btn, chip, statusDot, flowStrip } from './rackWidgets.js';

// Live panels built once at start-up (view/diversity.js, view/telemetry.js); they are moved into the open item of the active link.
const LIVE_FOR = { mic: ['telemetry'], receiver: ['diversity'] };
// The selected link's inspector sections shown in each item's Advanced part (name, frequency, band and power rows are borrowed into the essentials).
const DOCK_FOR = { mic: ['tx'], transmitter: ['tx', 'chain'], receiver: ['rx'], bodypack: ['rx', 'rxchain'] };
const LINK_KINDS = ['mic', 'bodypack', 'receiver', 'transmitter'];
const short = (s) => String(s || '').split(' (')[0];

export function mountRack({ container, store }) {
  container.textContent = '';
  const summary = el('summary', container.tagName === 'DETAILS' ? '' : 'ob-summary', 'Radio items');
  const body = el('div', 'ob-body'), out = el('div', 'rack-out');
  container.append(summary, body);
  if (container.tagName === 'DETAILS') container.open = true;
  const open = new Set(), advOpen = new Set(); // expanded item keys (and their Advanced parts) survive a redraw
  const msg = el('p', 'hint inv-msg'); msg.setAttribute('role', 'status');
  const say = (t) => { msg.textContent = t; };
  const status = el('p', 'hint rack-status'); status.setAttribute('role', 'status');

  // Inspector rows shown in an item's essentials: moved out of their section with a marker left behind, and put back before every redraw.
  const borrowed = [];
  let taken = new Set();
  const restore = () => { for (const { row, marker } of borrowed.splice(0)) if (marker.parentNode) marker.replaceWith(row); taken = new Set(); };
  const borrow = (keys) => {
    const dock = getLinkDock(); if (!dock) return null;
    const box = el('div', 'rack-docked rf-borrowed');
    for (const k of keys) {
      if (taken.has(k)) continue;
      let ctl = null;
      for (const n of ['link', 'tx', 'rx']) { if (dock[n]) { ctl = dock[n].querySelector(`[data-fkey="${k}"]`); if (ctl) break; } }
      const row = ctl && ctl.closest('.f'); if (!row) continue;
      const marker = document.createComment(`borrowed ${k}`); row.replaceWith(marker); box.append(row);
      borrowed.push({ row, marker }); taken.add(k);
    }
    return box.childNodes.length ? box : null;
  };

  let reveal = () => {};
  const bar = addBar({ store, say, reveal: (keys, sel) => reveal(keys, sel) });
  const pack = el('details', 'rf-pack'), packSum = el('summary', '', 'Pack list'), packPre = el('pre', 'rf-pack-text'), packCopy = btn('Copy pack list', async () => {
    try { await navigator.clipboard.writeText(packPre.textContent); say('Pack list copied.'); } catch { const r = document.createRange(); r.selectNodeContents(packPre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); say('Pack list selected: press Ctrl+C (Cmd+C) to copy.'); }
  }, 'Copies the list as plain text');
  pack.append(packSum, packCopy, packPre);

  let lastSel = Symbol('none');
  function render() {
    const selNow = store.getSelection();
    if (selNow !== lastSel) { // picking a transmitter or receiver on the plan opens its items here
      lastSel = selNow;
      const sc0 = store.getScene(), l0 = sc0.links.find((q) => q.tx.id === selNow || q.rx.id === selNow);
      if (l0) for (const k of (l0.tx.id === selNow ? ['mic', 'transmitter'] : ['receiver', 'bodypack'])) open.add(`${k}:${l0.id}`);
    }
    const focusInfo = (() => { // the control with focus comes back after the redraw (same item, same label)
      const a = document.activeElement, it = a && out.contains(a) && a.closest('.rack-item');
      return it ? { key: it.dataset.key, summary: a.tagName === 'SUMMARY', label: a.getAttribute('aria-label') || a.textContent } : null;
    })();
    restore();
    { const hold = document.getElementById('live-holder'); if (hold) for (const id of ['diversity', 'telemetry']) { const n = document.getElementById(id); if (n && out.contains(n)) hold.append(n); } } // park the live panels before the list is rebuilt
    out.textContent = '';
    const scene = store.getScene(), rack = scene.rack || deriveRack(scene), sections = rackSections(scene, txFormFactor);
    const pu = (scene.units && scene.units.power) || 'dBm';
    const linkOf = (id) => scene.links.find((q) => q.id === id);
    const linkName = (id) => { const l = linkOf(id); return l ? l.name : id; };
    const results = new Map();
    const resOf = (id) => { if (!results.has(id)) { const l = linkOf(id); let r = null; try { r = l ? solveCached(scene, l) : null; } catch { r = null; } results.set(id, r); } return results.get(id); };
    const bwOf = (l) => { const p = l.tx && l.tx.fmPreset && FM_PRESETS[l.tx.fmPreset]; return p && p.params ? p.params.occupiedBwKhz : 200; };
    const warns = [...rackWarnings(scene, bwOf, { erpOf: (l) => erpCheck(l, getCoordRegion()) }), ...radioChecks(scene)], warnBy = new Map();
    const dcOf = new Map(); // bias warnings from the link maths, shown on the receiver and on the antennas that feed it
    for (const l of scene.links) if (l.kind === 'mic') { const r = resOf(l.id); const ws = ((r && r.warnings) || []).filter((t) => /bias|DC/i.test(t)); if (ws.length) dcOf.set(l.id, ws); }
    const chanFind = (id) => { for (const r of rack.receivers || []) { const c = r.channels.find((x) => x.linkId === id || x.id === id); if (c) return { r, c }; } return null; };
    const chanOf = (lid) => { for (const r of rack.receivers || []) { const c = r.channels.find((x) => x.linkId === lid); if (c) return { r, c }; } return null; };
    for (const [lid, ws] of dcOf) {
      const m = chanOf(lid); if (!m) continue;
      const route = channelRoute(rack, m.c, m.r), keys = [`receiver:${lid}`, ...[route.antA, route.antB].filter(Boolean).map((a) => `antenna:${a.id}`)];
      for (const k of new Set(keys)) for (const t of new Set(ws)) warns.push({ key: k, level: 'warn', text: `${linkName(lid)}: ${t}` });
    }
    for (const l of scene.links) { // powering budget: current drawn by powered gear against each DC source
      if (l.kind !== 'mic') continue;
      const m = chanOf(l.id); if (!m) continue;
      const route = channelRoute(rack, m.c), keys = [`receiver:${l.id}`, ...[route.antA, route.antB].filter(Boolean).map((a) => `antenna:${a.id}`)];
      for (const e of poweringBudget(l)) {
        warns.push({ key: keys[0], level: e.ok ? 'info' : 'warn', text: `${linkName(l.id)} powering, ${e.source}: ${poweringLine(e)}.` });
        for (const t of e.warnings) for (const k of keys.slice(1)) warns.push({ key: k, level: 'warn', text: `${linkName(l.id)}: ${t}` });
      }
    }
    for (const w of warns) warnBy.set(w.key, [...(warnBy.get(w.key) || []), w]);
    const act = activeLink(scene, store.getSelection()), dock = getLinkDock();
    const owners = peopleLinkOwners(scene), personOf = (id) => { const o = owners.get(id); return o ? ((scene.people || []).find((p) => p.id === o.personId) || {}).name : null; };
    const antName = (id) => { const a = rack.antennas.find((x) => x.id === id); return a ? a.name : null; };
    const marginChip = (id) => { const r = resOf(id); return r && Number.isFinite(r.marginDb) ? chip(formatDb(r.marginDb), 'Margin over the receiver sensitivity (Budgets panel)', `m-${r.status}`) : null; };
    const freqChip = (l) => chip(`${l.freqMHz.toFixed(3)} MHz`, 'Frequency');
    // the person chip only when the name does not already say who; a generic model reads "Generic"
    const whoChip = (l, title) => { const p = personOf(l.id); return p && !String(l.name || '').toLowerCase().includes(p.toLowerCase()) ? chip(p, title) : null; };
    const modelChip = (l) => { const n = txDeviceName(l); return chip(/^generic\b/i.test(n) ? 'Generic' : short(n), `Transmitter model: ${n}`); };

    // summary: [status dot] name  chips...
    const facts = {
      mic: (it) => { const l = linkOf(it.id); return [l.name, [freqChip(l), modelChip(l), whoChip(l, 'Worn or held by'), marginChip(l.id)]]; },
      bodypack: (it) => { const l = linkOf(it.id); return [l.name, [freqChip(l), whoChip(l, 'Worn by'), marginChip(l.id)]]; },
      receiver: (it) => {
        const m = chanFind(it.id), l = linkOf(it.linkId || it.id); if (!m) return [l ? l.name : it.text, []];
        if (!l) { const up0 = m.r.loopFrom && rack.receivers.find((x) => x.id === m.r.loopFrom), sp0 = m.c.splitterId && rack.splitters.find((s) => s.id === m.c.splitterId); return [`${m.c.freqMHz} MHz receiver`, [chip(`${m.c.freqMHz.toFixed(3)} MHz`, 'Tuned to'), chip('no mic on this frequency', 'No mic is tuned to exactly this frequency', 'bad'), chip(m.r.name, 'Receiver unit'), chip(up0 ? `loop from ${up0.name}` : sp0 ? `from ${sp0.name}` : `from ${[antName(m.c.antA), antName(m.c.antB)].filter(Boolean).join(' + ') || 'no antenna'}`, 'Antenna feed')]]; }
        const up = m.r.loopFrom && rack.receivers.find((x) => x.id === m.r.loopFrom), sp = m.c.splitterId && rack.splitters.find((s) => s.id === m.c.splitterId);
        const feed = up ? `loop from ${up.name}` : sp ? `from ${sp.name}` : `from ${[antName(m.c.antA), antName(m.c.antB)].filter(Boolean).join(' + ') || 'no antenna'}`;
        return [l.name, [freqChip(l), chip(`${m.r.name}${m.r.channels.length > 1 ? ` ch ${m.r.channels.indexOf(m.c) + 1}` : ''}`, 'Receiver unit and channel'), chip(feed, 'Antenna feed', up || sp || m.c.antA ? '' : 'bad'), marginChip(l.id)]];
      },
      transmitter: (it) => {
        let m = null; for (const t of rack.transmitters || []) { const c = t.channels.find((x) => x.linkId === it.id || x.id === it.id); if (c) m = { r: t, c }; }
        const l = linkOf(m && m.c.linkId ? m.c.linkId : it.id);
        if (!m) return [l ? l.name : it.text, []];
        if (!l) { const cb0 = m.c.combinerId && rack.combiners.find((x) => x.id === m.c.combinerId); return [`${m.c.freqMHz} MHz transmitter`, [chip(`${m.c.freqMHz.toFixed(3)} MHz`, 'Tuned to'), chip('no bodypack on this frequency', 'No bodypack is tuned to exactly this frequency', 'bad'), chip(m.r.name, 'Transmitter unit'), chip(cb0 ? `via ${cb0.name}` : antName(m.c.antennaId) ? `to ${antName(m.c.antennaId)}` : 'no antenna', 'Output path', cb0 || antName(m.c.antennaId) ? '' : 'bad')]]; }
        const cb = m.c.combinerId && rack.combiners.find((x) => x.id === m.c.combinerId), path = cb ? `via ${cb.name}` : antName(m.c.antennaId) ? `to ${antName(m.c.antennaId)}` : 'no antenna';
        return [l.name, [freqChip(l), chip(formatPower(l.tx.powerDbm, pu), 'Transmit power'), chip(`${m.r.name}${m.r.channels.length > 1 ? ` ch ${m.r.channels.indexOf(m.c) + 1}` : ''}`, 'Transmitter unit and channel'), chip(path, 'Output path', cb || antName(m.c.antennaId) ? '' : 'bad'), marginChip(l.id)]];
      },
      antenna: (it) => {
        const a = rack.antennas.find((x) => x.id === it.id), to = [];
        for (const s of rack.splitters) { if (s.fromSplitter) continue; if (s.antA === a.id) to.push(`${s.name} A`); if (s.antB === a.id) to.push(`${s.name} B`); }
        for (const r of rack.receivers) if (!r.loopFrom) for (const c of r.channels) if (!c.splitterId && (c.antA === a.id || c.antB === a.id)) to.push(r.name);
        const fed = scene.links.find((l) => l.kind === 'mic' && to.length), loss = (a.chain || []).length ? runLossDb(a, fed ? fed.freqMHz : 600) : null;
        return [a.name, [chip(short((ANTENNAS[a.antenna.type] || {}).name || a.antenna.type), 'Antenna type'), chip(to.length ? `to ${to.slice(0, 3).join(', ')}${to.length > 3 ? ` +${to.length - 3}` : ''}` : 'not connected', 'Connected to', to.length ? '' : 'bad'), loss !== null && chip(`run ${formatDb(-loss)}`, 'Cable run gain (negative = loss)')]];
      },
      txantenna: (it) => {
        const a = rack.antennas.find((x) => x.id === it.id), by = [];
        for (const t of rack.transmitters || []) for (const c of t.channels) if (!c.combinerId && c.antennaId === a.id) by.push(linkName(c.linkId));
        for (const c of rack.combiners || []) if (c.antennaId === a.id || (c.fanout && (c.fanout.outputs || []).some((o) => o && o.antennaId === a.id))) by.push(c.name);
        return [a.name, [chip(a.load ? '50 ohm load' : short((ANTENNAS[a.antenna.type] || {}).name || a.antenna.type), 'Antenna type'), chip(by.length ? `from ${by.slice(0, 2).join(', ')}${by.length > 2 ? ` +${by.length - 2}` : ''}` : 'not connected', 'Fed by', by.length ? '' : 'bad')]];
      },
      splitter: (it) => {
        const s = rack.splitters.find((x) => x.id === it.id), n = splitterLoad(rack, s.id), par = s.fromSplitter && rack.splitters.find((x) => x.id === s.fromSplitter);
        return [s.name, [chip(s.type, 'Splitter type'), chip(`${n}${s.ports ? `/${s.ports}` : ''} out`, 'Outputs in use / ports'), chip(par ? `from ${par.name}` : `from ${[antName(s.antA), antName(s.antB)].filter(Boolean).join(' + ') || 'no antenna'}`, 'Input', par || s.antA ? '' : 'bad')]];
      },
      combiner: (it) => {
        const c = rack.combiners.find((x) => x.id === it.id), n = (rack.transmitters || []).reduce((k, t) => k + t.channels.filter((x) => x.combinerId === c.id).length, 0);
        const to = c.fanout ? `to ${(c.fanout.outputs || []).filter((o) => o && antName(o.antennaId)).length} antennas` : antName(c.antennaId) ? `to ${antName(c.antennaId)}` : 'no antenna';
        return [c.name, [chip(c.type, 'Combiner type'), chip(`${n}${c.ports ? `/${c.ports}` : ''} in`, 'Inputs in use / ports'), c.cable && chip(`${c.cable.lengthM} m cable`, 'Cable to the antenna'), chip(to, 'Output', /no antenna|to 0 /.test(to) ? 'bad' : '')]];
      },
    };
    const editors = makeEditors({ store, scene, rack, say, linkName, borrow, isActive: (id) => !!(act && act.id === id && dock) });
    const tools = (kind, id, box) => {
      const row = el('div', 'rf-tools'), name = (facts[kind] ? facts[kind]({ id })[0] : id);
      row.append(btn('Up', () => moveRadioItem(store, kind, id, -1), `Move ${name} up the list`), btn('Down', () => moveRadioItem(store, kind, id, 1), `Move ${name} down the list`));
      const l = kind !== 'receiver' && kind !== 'transmitter' && LINK_KINDS.includes(kind) && linkOf(id);
      if (kind === 'transmitter') { const m = (rack.transmitters || []).flatMap((t) => t.channels).find((c) => c.linkId === id || c.id === id); if (m) row.append(btn('Remove', () => { removeTxChannel(store, m.id); say(`Removed the transmitter on ${m.freqMHz} MHz. A bodypack it served stays on the plan, with no transmitter. Undo brings it back.`); }, 'Removes this transmitter channel; bodypacks, antennas and combiners stay', 'danger')); }
      if (kind === 'receiver') { const m = chanFind(id); if (m) row.append(btn('Remove', () => { removeReceiverChannel(store, m.c.id); say(`Removed the receiver on ${m.c.freqMHz} MHz. A mic it heard stays on the plan, with no receiver. Undo brings it back.`); }, 'Removes this receiver channel; mics, antennas and splitters stay', 'danger')); }
      if (l && l.txOf === undefined && (kind === 'mic' || kind === 'transmitter')) row.append(btn('Duplicate', () => { const nid = duplicateRadioLink(store, id); if (nid) { const n = store.getScene().links.find((q) => q.id === nid); say(`Added ${n.name} at ${n.freqMHz.toFixed(3)} MHz, a copy of ${l.name}.`); reveal([`${kind}:${nid}`], n.tx.id); } else say('Could not duplicate (link limit reached).'); }, `A copy of ${name} at the next clean frequency, fed the same way`));
      if (l && l.txOf !== undefined) row.append(btn('Duplicate', () => { const nid = addReceiverFor(store, l.txOf); say(nid ? `Added another ${l.kind === 'iem' ? 'bodypack' : 'receiver'} on ${linkName(l.txOf)}.` : 'Could not add (link limit reached).'); if (nid) reveal([`${kind}:${nid}`]); }, `Another ${l.kind === 'iem' ? 'bodypack' : 'receiver'} listening to ${linkName(l.txOf)}`));
      if (l) {
        row.append(btn('Remove', () => { if (removeLink(store, id)) say(`Removed ${name}. Undo brings it back.`); }, 'Removes it from the plan; people and walk-test readings that used it are cleared', 'danger'));
      }
      if (kind === 'antenna' || kind === 'txantenna') row.append(btn('Remove', () => removeRackItem(store, 'antennas', id), 'Whatever it fed is left with no antenna', 'danger'));
      if (kind === 'splitter') row.append(btn('Remove', () => removeRackItem(store, 'splitters', id), 'Receivers on it connect straight to its antennas', 'danger'));
      if (kind === 'combiner') row.append(btn('Remove', () => removeCombiner(store, id), 'Its channels go straight to the antenna', 'danger'));
      box.append(row);
    };

    const fill = (d, it, kind) => { // the open item: warnings, flow strip, essentials, tools, Advanced
      const key = `${kind}:${it.id}`, b = el('div', 'rack-edit'), ws = warnBy.get(key) || [];
      for (const w of [...ws].sort((x, y) => (x.level === 'warn' ? 0 : 1) - (y.level === 'warn' ? 0 : 1))) b.append(el('p', w.level === 'warn' ? 'rack-warn-text' : 'hint', `${w.level === 'warn' ? 'Fix: ' : ''}${w.text}`));
      const l = LINK_KINDS.includes(kind) && linkOf(it.id);
      if (l) { const f = signalFlow(l, resOf(l.id)); if (f) b.append(flowStrip(f, pu)); }
      const ess = el('div', 'rf-ess'), adv = el('div', 'rf-adv-body'), advD = el('details', 'rf-adv'), advS = el('summary', '', 'Advanced');
      advD.open = advOpen.has(key); advD.addEventListener('toggle', () => { if (advD.open) advOpen.add(key); else advOpen.delete(key); });
      (editors[kind] || (() => {}))(it, ess, adv);
      b.append(ess); tools(kind, it.id, b);
      adv.append(el('p', 'hint rf-conn', `Connections: ${it.text}`));
      if (l && dock && act && act.id === l.id) {
        const host = el('div', 'rack-docked');
        for (const n of DOCK_FOR[kind] || []) if (dock[n]) { if (n === 'tx' || n === 'rx') dock[n].classList.add('dock-merged'); host.append(dock[n]); } // the item already says what it is: its own fields show without a second heading
        if (l.kind === 'p2p' && dock.link) host.append(dock.link);
        for (const id of LIVE_FOR[kind] || []) { const n = document.getElementById(id); if (n) host.append(n); }
        adv.append(host);
      } else if (l) adv.append(el('p', 'hint', 'Select this link (open its item, or click it on the plan) to see all its transmitter, receiver and cable fields here.'));
      advD.append(advS, adv); b.append(advD);
      d.append(b);
    };
    const details = (it) => {
      const kind = it.kind, key = `${kind}:${it.id}`, d = el('details', 'rack-item'); d.dataset.key = key; d.open = open.has(key);
      const ws = warnBy.get(key) || [], l = LINK_KINDS.includes(kind) && linkOf(it.id);
      const state = statusOf(l ? resOf(l.id) : null, ws);
      const [name, chips] = facts[kind] ? facts[kind](it) : [it.text, []];
      const sum = el('summary', 'rf-sum'); d.dataset.state = state;
      const nameEl = el('span', 'rf-name', name), chipBox = el('span', 'rf-chips');
      for (const c of chips) if (c) chipBox.append(c);
      sum.append(statusDot(state), nameEl, chipBox);
      const nw = ws.filter((w) => w.level === 'warn').length;
      if (nw) sum.append(chip(`${nw} to fix`, ws.filter((w) => w.level === 'warn').map((w) => w.text).join('\n'), 'warn'));
      else if (ws.length) sum.append(chip(`${ws.length} note${ws.length === 1 ? '' : 's'}`, ws.map((w) => w.text).join('\n'), 'info'));
      if (l) { sum.addEventListener('pointerenter', () => setLinkFocus(l.id)); sum.addEventListener('pointerleave', () => setLinkFocus(null)); }
      if (l && DOCK_FOR[kind]) sum.addEventListener('click', () => { if (!d.open) store.select((kind === 'mic' || kind === 'transmitter' ? l.tx : l.rx).id); }); // opening an item selects its link so the link's own fields appear in it
      d.append(sum);
      d.addEventListener('toggle', () => { if (d.open) { open.add(key); if (d.childElementCount < 2) fill(d, it, kind); } else open.delete(key); });
      if (d.open) fill(d, it, kind);
      return d;
    };

    let nFail = 0, nWarnItems = 0;
    for (const sec of sections) {
      const h = el('h3', 'rack-cat', sec.title); out.append(h);
      for (const it of sec.items) { const d = details(it); if (d.dataset.state === 'fail') nFail++; else if (d.dataset.state === 'warn') nWarnItems++; out.append(d); }
    }
    if (!sections.length) out.append(el('p', 'hint', 'No radio items yet: add a mic or an IEM above.'));
    if (focusInfo) {
      const item = out.querySelector(`.rack-item[data-key="${CSS.escape(focusInfo.key)}"]`);
      const t = item && (focusInfo.summary ? item.querySelector(':scope > summary') : [...item.querySelectorAll('select, input, button')].find((n) => (n.getAttribute('aria-label') || n.textContent) === focusInfo.label));
      if (t) t.focus({ preventScroll: true });
    }
    const iv = inventoryView(scene, store.getSelection());
    summary.textContent = `Radio items (${iv.summary})`;
    const nWarn = warns.filter((w) => w.level === 'warn').length, loads = rackLoads(scene);
    status.textContent = [nFail ? `${nFail} item${nFail === 1 ? '' : 's'} failing.` : '', nWarn ? `${nWarn} warning${nWarn === 1 ? '' : 's'} to fix${nWarnItems ? ` on ${nWarnItems} item${nWarnItems === 1 ? '' : 's'}` : ''}: open the marked items.` : '', !nFail && !nWarn ? 'All items OK.' : '', loads.total ? `${loads.total} x 50 ohm load to pack.` : ''].filter(Boolean).join(' ');
    packPre.textContent = packListText(inventoryTotals(inventoryRows(scene), scene));
    bar.refresh(scene);
  }

  reveal = (keys, sel) => { for (const k of keys) open.add(k); if (sel) store.select(sel); else queue(); };
  body.append(el('p', 'hint', 'Every radio item in signal order. The coloured dot shows how each link is doing (green passes, amber is marginal, red will drop out) and the figure beside it is its margin in dB. Open one for its signal flow and essentials; the rest is under Advanced.'), bar.node, msg, status, out, pack);
  let timer = null, pending = false;
  const queue = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { // a field being typed in must keep focus: redraw when it is left
      const a = document.activeElement;
      if (a && a.closest && a.closest('.rack-docked, .rf-bulk') && body.contains(a) && a.tagName !== 'BUTTON') { pending = true; return; }
      render();
    }, 30);
  };
  body.addEventListener('focusout', () => { if (pending) { pending = false; queue(); } });
  const unsub = store.subscribe(queue), unsubDock = subscribeLinkDock(queue); render();
  return { render, destroy() { clearTimeout(timer); restore(); if (typeof unsub === 'function') unsub(); unsubDock(); } };
}
