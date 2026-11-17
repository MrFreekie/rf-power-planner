// Radio items panel: every mic, receive antenna, splitter, receiver, IEM transmitter, combiner and transmit antenna in categories,
// each item expandable to show its details and edit its connections. Edits go through js/actionsRack.js (one undo step each).
import { rackSections, deriveRack, rackWarnings, rackLoads, channelRoute } from '../model/rack.js';
import { solveCached } from '../view/util.js';
import { CABLES, ANTENNAS } from '../model/library.js';
import { linkCard, txFormFactor } from '../model/inventory.js';
import { inventoryView } from './inventoryUi.js';
import { addLink, addReceiverFor, assignMic, assignIem, removeExtraMic, peopleLinkOwners } from '../actions.js';
import { setLinkFocus } from '../view/linkFocus.js';
import { getLinkDock, subscribeLinkDock } from './linkDock.js';
import { activeLink } from '../view/util.js';
import { FM_PRESETS } from '../model/fm-presets.js';
import { CHAIN_PRESETS } from '../model/chain-presets.js';
import { gearPickers } from './gearUi.js';
import {
  renameRackItem, addRackAntenna, addRackSplitter, setSplitterType, setSplitterInput, connectChannel, moveChannel, removeRackItem, setRackAntenna,
  addRackCombiner, setCombiner, setSplitterPorts, setRxBias, setRackAntennaType, setRackAntennaAim, addAntennaChainItem, setAntennaChainItem, removeAntennaChainItem, setAntennaZones, connectTxChannel, moveTxChannel, removeCombiner,
} from '../actionsRack.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// Which of the selected link's inspector sections each kind of item hosts.
// Live panels built once at start-up (view/diversity.js, view/telemetry.js); they are moved into the open item of the active link.
const LIVE_FOR = { mic: ['telemetry'], receiver: ['diversity'] };
const DOCK_FOR = { mic: ['link', 'tx'], transmitter: ['link', 'tx', 'chain'], receiver: ['rx', 'chain', 'chainB'], bodypack: ['rx', 'rxchain'] };

export function mountRack({ container, store }) {
  container.textContent = '';
  const summary = el('summary', container.tagName === 'DETAILS' ? '' : 'ob-summary', 'Radio items');
  const body = el('div', 'ob-body'), out = el('div', 'rack-out');
  out.setAttribute('aria-live', 'polite');
  container.append(summary, body);
  if (container.tagName === 'DETAILS') container.open = true;
  const open = new Set(); // expanded item keys survive a redraw

  const field = (label, control) => { const l = el('label', 'inv-field'); l.append(el('span', '', label), control); return l; };
  const select = (label, options, value, onPick) => {
    const s = el('select'); s.setAttribute('aria-label', label);
    for (const [v, t] of options) s.append(Object.assign(el('option', '', t), { value: v }));
    s.value = value == null ? '' : value; s.addEventListener('change', () => onPick(s.value)); return s;
  };
  const text = (label, value, onSet) => {
    const i = el('input'); i.type = 'text'; i.value = value; i.maxLength = 40; i.setAttribute('aria-label', label);
    i.addEventListener('change', () => onSet(i.value)); return i;
  };
  const num = (label, value, onSet, min = -1000, max = 1000) => {
    const i = el('input'); i.type = 'number'; i.step = '0.1'; i.min = String(min); i.max = String(max); i.value = String(Math.round(value * 100) / 100); i.setAttribute('aria-label', label);
    i.addEventListener('change', () => { const v = Number(i.value); if (Number.isFinite(v)) onSet(Math.min(max, Math.max(min, v))); }); return i;
  };
  const btn = (label, onClick, title) => { const b = el('button', '', label); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', onClick); return b; };

  let lastSel = Symbol('none');
  function render() {
    const selNow = store.getSelection();
    if (selNow !== lastSel) { // picking a transmitter or receiver on the plan opens its items here
      lastSel = selNow;
      const sc0 = store.getScene(), l0 = sc0.links.find((q) => q.tx.id === selNow || q.rx.id === selNow);
      if (l0) for (const k of (l0.tx.id === selNow ? ['mic', 'transmitter'] : ['receiver', 'bodypack'])) open.add(`${k}:${l0.id}`);
    }
    const scene = store.getScene(), rack = scene.rack || deriveRack(scene), sections = rackSections(scene, txFormFactor);
    { const hold = document.getElementById('live-holder'); if (hold) for (const id of ['diversity', 'telemetry']) { const n = document.getElementById(id); if (n && out.contains(n)) hold.append(n); } } // park the live panels before the list is rebuilt
    out.textContent = '';
    const linkName = (id) => { const l = scene.links.find((q) => q.id === id); return l ? l.name : id; };
    const bwOf = (l) => { const p = l.tx && l.tx.fmPreset && FM_PRESETS[l.tx.fmPreset]; return p && p.params ? p.params.occupiedBwKhz : 200; };
    const warns = rackWarnings(scene, bwOf), warnBy = new Map();
    const dcOf = new Map(); // bias warnings from the link maths, shown on the receiver and on the antennas that feed it
    for (const l of scene.links) if (l.kind === 'mic') { const r = solveCached(scene, l); const ws = ((r && r.warnings) || []).filter((t) => /bias|DC/i.test(t)); if (ws.length) dcOf.set(l.id, ws); }
    for (const [lid, ws] of dcOf) {
      const m = (rack.receivers || []).flatMap((r) => r.channels).find((c) => c.linkId === lid); if (!m) continue;
      const route = channelRoute(rack, m), keys = [`receiver:${lid}`, ...[route.antA, route.antB].filter(Boolean).map((a) => `antenna:${a.id}`)];
      for (const k of new Set(keys)) for (const t of new Set(ws)) warns.push({ key: k, level: 'warn', text: `${linkName(lid)}: ${t}` });
    }
    for (const w of warns) warnBy.set(w.key, [...(warnBy.get(w.key) || []), w]);
    const portOpts = [['', 'As many as used'], ...[2, 3, 4, 5, 6, 8, 12, 16].map((n) => [String(n), `${n} ports`])];
    const antOpts = (role) => [['', 'No antenna'], ...rack.antennas.filter((a) => (a.role === 'tx') === (role === 'tx')).map((a) => [a.id, a.name])];
    const find = {
      receiver: (id) => { for (const r of rack.receivers) { const c = r.channels.find((x) => x.linkId === id); if (c) return { r, c }; } return null; },
      transmitter: (id) => { for (const r of rack.transmitters || []) { const c = r.channels.find((x) => x.linkId === id); if (c) return { r, c }; } return null; },
    };
    const details = (key, title, fill) => {
      const d = el('details', 'rack-item'); d.dataset.key = key; d.open = open.has(key);
      d.addEventListener('toggle', () => { if (d.open) open.add(key); else open.delete(key); });
      const ws = warnBy.get(key) || [], sum = el('summary', ws.some((w) => w.level === 'warn') ? 'rack-warn' : '', (ws.length ? (ws.some((w) => w.level === 'warn') ? '⚠ ' : 'ℹ ') : '') + title);
      if (['mic', 'bodypack', 'receiver', 'transmitter'].includes(key.split(':')[0])) { const lid = key.split(':')[1]; sum.addEventListener('pointerenter', () => setLinkFocus(lid)); sum.addEventListener('pointerleave', () => setLinkFocus(null)); }
      const kind = key.split(':')[0], lid = key.split(':')[1], lk = scene.links.find((q) => q.id === lid);
      if (lk && DOCK_FOR[kind]) sum.addEventListener('click', () => { if (!d.open) store.select((kind === 'mic' || kind === 'transmitter' ? lk.tx : lk.rx).id); }); // opening an item selects its link so the link's own fields appear in it
      d.append(sum); const b = el('div', 'rack-edit'); for (const w of ws) b.append(el('p', w.level === 'warn' ? 'rack-warn-text' : 'hint', w.text)); fill(b);
      if (lk && DOCK_FOR[kind] && d.open) { // the selected link's Link, Transmitter, Receiver and cable sections live here
        const dock = getLinkDock(), act = activeLink(scene, store.getSelection());
        if (dock && act && act.id === lid) { const host = el('div', 'rack-docked'); for (const n of DOCK_FOR[kind]) if (dock[n]) host.append(dock[n]); for (const id of LIVE_FOR[kind] || []) { const n = document.getElementById(id); if (n) host.append(n); } b.append(host); }
      }
      d.append(b); return d;
    };
    const props = (id, b, idx) => { const c = linkCard(scene, id); if (c) for (const i of idx) if (c.lines[i]) b.append(el('p', 'hint', c.lines[i])); };
    const owner = (id, b, which) => { // who wears or holds this link: choosing someone moves the pack onto them (the link takes their name)
      const people = scene.people || [], o = peopleLinkOwners(scene).get(id), cur = o ? o.personId : '';
      if (!people.length) { b.append(el('p', 'hint', 'No people in the show yet. Add one in the People section, then assign this link here.')); return; }
      const has = (p) => (which === 'mic' ? p.micLinkId : p.iemLinkId);
      const opts = [['', 'No one'], ...people.map((p) => [p.id, has(p) && has(p) !== id ? `${p.name} (replaces ${(scene.links.find((l) => l.id === has(p)) || {}).name || 'their link'})` : p.name])];
      b.append(field(which === 'mic' ? 'Worn or held by' : 'Worn by', select('Person for ' + linkName(id), opts, cur, (v) => {
        if (!v) { if (o && o.extra) removeExtraMic(store, o.personId, id); else if (o) (which === 'mic' ? assignMic : assignIem)(store, o.personId, null); return; }
        (which === 'mic' ? assignMic : assignIem)(store, v, id, { swap: !!o && o.personId !== v });
      })));
    };
    const gear = (id, b, part) => { const l = scene.links.find((q) => q.id === id); if (l) b.append(gearPickers(store, l, part)); };
    const editors = {
      mic: (it, b) => {
        props(it.id, b, [0, 1]); owner(it.id, b, 'mic'); gear(it.id, b, 'tx');
        const extras = scene.links.filter((q) => q.txOf === it.id);
        const add = btn('Add a receiver for this mic', () => { const id = addReceiverFor(store, it.id); msg.textContent = id ? 'Receiver added: see it under Receivers.' : 'Could not add a receiver (link limit reached).'; }, 'A second receiver listening to this transmitter, for a backup, a recording rig or another room. It has its own antenna and path.');
        b.append(el('p', 'hint', extras.length ? `Also heard by ${extras.map((q) => q.name).join(', ')}.` : 'Heard by one receiver.'), add);
      },
      bodypack: (it, b) => { props(it.id, b, [2]); owner(it.id, b, 'iem'); gear(it.id, b, 'rx'); },
      antenna: (it, b) => {
        const a = rack.antennas.find((x) => x.id === it.id);
        b.append(field('Name', text('Antenna name', a.name, (v) => renameRackItem(store, 'antennas', a.id, v))));
        for (const k of ['x', 'y', 'z']) b.append(field(`${k} (m)`, num(`Antenna ${k}`, a.pos[k], (v) => setRackAntenna(store, a.id, { pos: { [k]: v } }), k === 'z' ? 0 : -500, k === 'z' ? 50 : 500)));
        const types = Object.entries(ANTENNAS).filter(([k]) => k !== 'body' || a.antenna.type === 'body').map(([k, v]) => [k, v.name]), o = a.antenna.orientation || { az: 0, el: 0 };
        b.append(field('Antenna', select('Antenna type for ' + a.name, types, a.antenna.type, (v) => setRackAntennaType(store, a.id, v))),
          field('Gain (dBi)', num('Gain', a.antenna.gainDbi, (v) => setRackAntennaAim(store, a.id, { gainDbi: v }), -30, 40)),
          field('Aim: azimuth (degrees)', num('Azimuth', o.az, (v) => setRackAntennaAim(store, a.id, { az: v }), 0, 360)),
          field('Aim: elevation (degrees)', num('Elevation', o.el, (v) => setRackAntennaAim(store, a.id, { el: v }), -90, 90)),
          el('p', 'hint', 'Polarisation, tilt and the other antenna details are in the receiver radio item. Every link fed by this antenna follows.'));
        if (a.role !== 'tx') {
          b.append(el('h5', '', 'Cable run from this antenna'), el('p', 'hint', 'Cable, booster, filter or fibre between the antenna and its splitter or receiver. Every receiver on this antenna shares it, in the order listed.'));
          (a.chain || []).forEach((c) => {
            const row = el('div', 'rack-chain'); row.append(el('strong', '', c.presetId && CHAIN_PRESETS[c.presetId] ? CHAIN_PRESETS[c.presetId].label : c.kind));
            if (c.kind === 'cable') row.append(field('Cable', select('Cable type', Object.entries(CABLES).map(([k, v]) => [k, v.name]), c.cableType, (v) => setAntennaChainItem(store, a.id, c.id, { cableType: v }))), field('Length (m)', num('Cable length', c.lengthM, (v) => setAntennaChainItem(store, a.id, c.id, { lengthM: v }), 0, 500)));
            else if (c.kind === 'booster') row.append(field('Gain (dB)', num('Gain', c.gainDb, (v) => setAntennaChainItem(store, a.id, c.id, { gainDb: v }), -50, 60)), field('Noise figure (dB)', num('Noise figure', c.nfDb, (v) => setAntennaChainItem(store, a.id, c.id, { nfDb: v }), 0, 30)));
            else if (c.fibreKm !== undefined) row.append(field('Fibre (km)', num('Fibre length', c.fibreKm, (v) => setAntennaChainItem(store, a.id, c.id, { fibreKm: v }), 0, 20)));
            else if (c.lossDb !== undefined) row.append(field('Loss (dB)', num('Loss', c.lossDb, (v) => setAntennaChainItem(store, a.id, c.id, { lossDb: v }), 0, 60)));
            row.append(btn('Remove', () => removeAntennaChainItem(store, a.id, c.id))); b.append(row);
          });
          const add = select('Add to the cable run', [['', 'Add to the cable run...'], ['cable', 'Cable'], ...['lna-20', 'booster-12', 'filter-bandpass', 'rof-passive-1km', 'rof-active-lna', 'biastee', 'dcblock'].filter((k) => CHAIN_PRESETS[k]).map((k) => [k, CHAIN_PRESETS[k].label])], '', (v) => { if (v) addAntennaChainItem(store, a.id, v === 'cable' ? { kind: 'cable' } : { presetId: v }); });
          b.append(add);
          if ((scene.zones || []).length) {
            b.append(el('h5', '', 'Zones this antenna serves'), el('p', 'hint', 'A planning note: the list warns about a zone no antenna serves. Coverage results do not use it yet.'));
            for (const z of scene.zones) { const l = el('label', 'inv-field'), cb = el('input'); cb.type = 'checkbox'; cb.checked = (a.zones || []).includes(z.id); cb.addEventListener('change', () => setAntennaZones(store, a.id, scene.zones.filter((q) => (q.id === z.id ? cb.checked : (a.zones || []).includes(q.id))).map((q) => q.id))); l.append(cb, el('span', '', ` ${z.name || z.id}`)); b.append(l); }
          }
        }
        b.append(btn('Remove antenna', () => removeRackItem(store, 'antennas', a.id)));
      },
      splitter: (it, b) => {
        const s = rack.splitters.find((x) => x.id === it.id);
        b.append(field('Name', text('Splitter name', s.name, (v) => renameRackItem(store, 'splitters', s.id, v))),
          field('Type', select('Splitter type', [['passive', 'Passive'], ['active', 'Active (powers the antennas)']], s.type, (v) => setSplitterType(store, s.id, v))),
          field('Ports', select('Splitter ports', portOpts, s.ports ? String(s.ports) : '', (v) => setSplitterPorts(store, s.id, v || null))),
          field('Input A', select('Splitter input A', antOpts('rx'), s.antA, (v) => setSplitterInput(store, s.id, 'A', v))),
          field('Input B', select('Splitter input B', antOpts('rx'), s.antB, (v) => setSplitterInput(store, s.id, 'B', v))),
          btn('Remove splitter', () => removeRackItem(store, 'splitters', s.id), 'Receivers on it connect straight to its antennas'));
      },
      receiver: (it, b) => {
        const m = find.receiver(it.id); if (!m) return;
        props(it.id, b, [2, 3, 4]); gear(it.id, b, 'rx');
        const lk = scene.links.find((q) => q.id === it.id), on = lk.rx.antennaBiasV > 0, bias = el('input'); bias.type = 'checkbox'; bias.checked = on; bias.setAttribute('aria-label', 'Antenna bias for ' + lk.name);
        bias.addEventListener('change', () => setRxBias(store, it.id, { on: bias.checked }));
        const bl = el('label', 'inv-field'); bl.append(bias, el('span', '', ' Supply antenna bias from this receiver (powers a booster or active antenna up the cable)')); b.append(bl);
        if (on) b.append(field('Bias voltage (V)', num('Bias voltage', lk.rx.antennaBiasV, (v) => setRxBias(store, it.id, { volts: v }), 1, 48)), field('Bias current limit (mA, 0 = not stated)', num('Bias current', lk.rx.antennaBiasMa || 0, (v) => setRxBias(store, it.id, { ma: v }), 0, 1000)));
        else b.append(el('p', 'hint', 'Or put a bias tee in the antenna cable run. The list warns when something on the line needs bias and none reaches it.'));
        const recvOpts = [...rack.receivers.map((r) => [r.id, r.name]), ['new', 'A new receiver']];
        b.append(field('Receiver', select('Receiver for ' + linkName(it.id), recvOpts, m.r.id, (v) => moveChannel(store, it.id, v))),
          field('Receiver name', text('Receiver name', m.r.name, (v) => renameRackItem(store, 'receivers', m.r.id, v))),
          field('Fed from', select('Feed for ' + linkName(it.id), [['', 'Antennas directly'], ...rack.splitters.map((s) => [s.id, s.name])], m.c.splitterId, (v) => connectChannel(store, it.id, v ? { splitterId: v } : { antA: m.c.antA || (rack.antennas.find((a) => a.role !== 'tx') || {}).id, antB: m.c.antB }))));
        if (!m.c.splitterId) b.append(field('Antenna A', select('Antenna A for ' + linkName(it.id), antOpts('rx'), m.c.antA, (v) => connectChannel(store, it.id, { antA: v, antB: m.c.antB }))), field('Antenna B', select('Antenna B for ' + linkName(it.id), antOpts('rx'), m.c.antB, (v) => connectChannel(store, it.id, { antA: m.c.antA, antB: v }))));
        else b.append(el('p', 'hint', 'It takes antenna A and B from the splitter. A splitter costs each output its share of the signal.'));
      },
      transmitter: (it, b) => {
        const m = find.transmitter(it.id); if (!m) return;
        props(it.id, b, [0, 1]); owner(it.id, b, 'iem'); gear(it.id, b, 'tx');
        const opts = [...rack.transmitters.map((r) => [r.id, r.name]), ['new', 'A new transmitter']];
        b.append(field('Transmitter', select('Transmitter for ' + linkName(it.id), opts, m.r.id, (v) => moveTxChannel(store, it.id, v))),
          field('Transmitter name', text('Transmitter name', m.r.name, (v) => renameRackItem(store, 'transmitters', m.r.id, v))),
          field('Through', select('Combiner for ' + linkName(it.id), [['', 'Straight to an antenna'], ...rack.combiners.map((c) => [c.id, c.name])], m.c.combinerId, (v) => connectTxChannel(store, it.id, v ? { combinerId: v } : { antennaId: m.c.antennaId }))));
        if (!m.c.combinerId) b.append(field('Antenna', select('Transmit antenna for ' + linkName(it.id), antOpts('tx'), m.c.antennaId, (v) => connectTxChannel(store, it.id, { antennaId: v }))));
        else b.append(el('p', 'hint', 'The combiner sets the antenna and any cable run; each channel pays the combining loss.'));
      },
      combiner: (it, b) => {
        const c = rack.combiners.find((x) => x.id === it.id);
        b.append(field('Name', text('Combiner name', c.name, (v) => renameRackItem(store, 'combiners', c.id, v))),
          field('Type', select('Combiner type', [['passive', 'Passive'], ['active', 'Active']], c.type, (v) => setCombiner(store, c.id, { type: v }))),
          field('Ports', select('Combiner ports', portOpts, c.ports ? String(c.ports) : '', (v) => setCombiner(store, c.id, { ports: v || null }))),
          field('Transmit antenna', select('Antenna for ' + c.name, antOpts('tx'), c.antennaId, (v) => setCombiner(store, c.id, { antennaId: v }))),
          field('Cable to antenna (m)', num('Cable length for ' + c.name, c.cable ? c.cable.lengthM : 0, (v) => setCombiner(store, c.id, { cableM: v }), 0, 500)),
          field('Cable type', select('Cable type for ' + c.name, Object.entries(CABLES).map(([k, v]) => [k, v.name]), c.cable ? c.cable.type : 'rg58', (v) => setCombiner(store, c.id, { cableType: v }))),
          btn('Remove combiner', () => removeCombiner(store, c.id), 'Its channels go straight to the antenna'));
      },
      txantenna: (it, b) => {
        editors.antenna(it, b);
        const a = rack.antennas.find((x) => x.id === it.id), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!a.load; cb.setAttribute('aria-label', 'Dummy load');
        cb.addEventListener('change', () => setRackAntenna(store, a.id, { load: cb.checked }));
        const l = el('label', 'inv-field'); l.append(cb, el('span', '', ' This is a 50 ohm dummy load: nothing is radiated (1 W is plenty for an IEM)')); b.prepend(l);
      },
    };
    for (const sec of sections) {
      const h = el('h3', 'rack-cat', sec.title); out.append(h);
      for (const it of sec.items) out.append(details(`${it.kind}:${it.id}`, it.text, (b) => (editors[it.kind] || (() => {}))(it, b)));
    }
    if (!sections.length) out.append(el('p', 'hint', 'No radio items yet.'));
    const iv = inventoryView(scene, store.getSelection());
    summary.textContent = `Radio items (${iv.summary})`;
    const nWarn = warns.filter((w) => w.level === 'warn').length, loads = rackLoads(scene);
    status.textContent = [nWarn ? `⚠ ${nWarn} warning${nWarn === 1 ? '' : 's'}: open the marked items.` : '', loads.total ? `${loads.total} x 50 ohm load to pack.` : ''].filter(Boolean).join(' ');
  }

  const status = el('p', 'hint rack-status'); status.setAttribute('role', 'status');
  const bar = el('div', 'inv-add'), msg = el('p', 'hint inv-msg'); msg.setAttribute('role', 'status');
  for (const [kind, word] of [['mic', 'microphone'], ['iem', 'in-ear monitor']]) {
    const b = btn(`Add ${kind === 'mic' ? 'mic' : 'IEM'}`, () => {
      const id = addLink(store, kind);
      if (!id) { msg.textContent = 'The link limit has been reached.'; return; }
      const l = store.getScene().links.find((q) => q.id === id);
      msg.textContent = `Added ${l.name} at ${l.freqMHz} MHz. Check it against the others in the Coordination panel.`; store.select(l.tx.id);
    }, `Add another ${word} link at the next free frequency, beside the last one`);
    bar.append(b);
  }
  bar.append(
    btn('Add Rx antenna', () => addRackAntenna(store)), btn('Add splitter', () => addRackSplitter(store)),
    btn('Add Tx antenna', () => addRackAntenna(store, { role: 'tx' })), btn('Add combiner', () => addRackCombiner(store)),
  );
  body.append(el('p', 'hint', 'Every radio item in the show. Open one to see its properties, pick its equipment and change what it is connected to; the link maths follows.'), bar, msg, status, out);
  let timer = null;
  let pending = false;
  const queue = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { // a field being typed in must keep focus: redraw when it is left
      const a = document.activeElement;
      if (a && a.closest && a.closest('.rack-docked') && out.contains(a)) { pending = true; return; }
      render();
    }, 30);
  };
  out.addEventListener('focusout', () => { if (pending) { pending = false; queue(); } });
  const unsub = store.subscribe(queue), unsubDock = subscribeLinkDock(queue); render();
  return { render, destroy() { clearTimeout(timer); if (typeof unsub === 'function') unsub(); unsubDock(); } };
}
