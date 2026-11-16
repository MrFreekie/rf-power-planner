// Radio items panel: every mic, receive antenna, splitter, receiver, IEM transmitter, combiner and transmit antenna in categories,
// each item expandable to show its details and edit its connections. Edits go through js/actionsRack.js (one undo step each).
import { rackSections, deriveRack, rackWarnings, rackLoads } from '../model/rack.js';
import { CABLES } from '../model/library.js';
import {
  renameRackItem, addRackAntenna, addRackSplitter, setSplitterType, setSplitterInput, connectChannel, moveChannel, removeRackItem, setRackAntenna,
  addRackCombiner, setCombiner, setSplitterPorts, connectTxChannel, moveTxChannel, removeCombiner,
} from '../actionsRack.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export function mountRack({ container, store }) {
  container.textContent = '';
  const summary = el('summary', container.tagName === 'DETAILS' ? '' : 'ob-summary', 'Radio items');
  const body = el('div', 'ob-body'), out = el('div', 'rack-out');
  out.setAttribute('aria-live', 'polite');
  container.append(summary, body);
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

  function render() {
    const scene = store.getScene(), rack = scene.rack || deriveRack(scene), sections = rackSections(scene);
    out.textContent = '';
    const warns = rackWarnings(scene), warnBy = new Map();
    for (const w of warns) warnBy.set(w.key, [...(warnBy.get(w.key) || []), w]);
    const portOpts = [['', 'As many as used'], ...[2, 3, 4, 5, 6, 8, 12, 16].map((n) => [String(n), `${n} ports`])];
    const antOpts = (role) => [['', 'No antenna'], ...rack.antennas.filter((a) => (a.role === 'tx') === (role === 'tx')).map((a) => [a.id, a.name])];
    const linkName = (id) => { const l = scene.links.find((q) => q.id === id); return l ? l.name : id; };
    const find = {
      receiver: (id) => { for (const r of rack.receivers) { const c = r.channels.find((x) => x.linkId === id); if (c) return { r, c }; } return null; },
      transmitter: (id) => { for (const r of rack.transmitters || []) { const c = r.channels.find((x) => x.linkId === id); if (c) return { r, c }; } return null; },
    };
    const details = (key, title, fill) => {
      const d = el('details', 'rack-item'); d.dataset.key = key; d.open = open.has(key);
      d.addEventListener('toggle', () => { if (d.open) open.add(key); else open.delete(key); });
      const ws = warnBy.get(key) || [], sum = el('summary', ws.some((w) => w.level === 'warn') ? 'rack-warn' : '', (ws.length ? (ws.some((w) => w.level === 'warn') ? '⚠ ' : 'ℹ ') : '') + title);
      d.append(sum); const b = el('div', 'rack-edit'); for (const w of ws) b.append(el('p', w.level === 'warn' ? 'rack-warn-text' : 'hint', w.text)); fill(b); d.append(b); return d;
    };
    const editors = {
      mic: (it, b) => { b.append(el('p', 'hint', 'Frequency, gear and receive antenna are in the link card above; its receiver and antennas are listed below.'), btn('Show this link', () => { const l = scene.links.find((q) => q.id === it.id); if (l) store.select(l.tx.id); })); },
      antenna: (it, b) => {
        const a = rack.antennas.find((x) => x.id === it.id);
        b.append(field('Name', text('Antenna name', a.name, (v) => renameRackItem(store, 'antennas', a.id, v))));
        for (const k of ['x', 'y', 'z']) b.append(field(`${k} (m)`, num(`Antenna ${k}`, a.pos[k], (v) => setRackAntenna(store, a.id, { pos: { [k]: v } }), k === 'z' ? 0 : -500, k === 'z' ? 50 : 500)));
        b.append(el('p', 'hint', `${a.antenna.type}, ${a.antenna.gainDbi} dBi. Antenna type and aim are set in the inspector.`), btn('Remove antenna', () => removeRackItem(store, 'antennas', a.id)));
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
        const recvOpts = [...rack.receivers.map((r) => [r.id, r.name]), ['new', 'A new receiver']];
        b.append(field('Receiver', select('Receiver for ' + linkName(it.id), recvOpts, m.r.id, (v) => moveChannel(store, it.id, v))),
          field('Receiver name', text('Receiver name', m.r.name, (v) => renameRackItem(store, 'receivers', m.r.id, v))),
          field('Fed from', select('Feed for ' + linkName(it.id), [['', 'Antennas directly'], ...rack.splitters.map((s) => [s.id, s.name])], m.c.splitterId, (v) => connectChannel(store, it.id, v ? { splitterId: v } : { antA: m.c.antA || (rack.antennas.find((a) => a.role !== 'tx') || {}).id, antB: m.c.antB }))));
        if (!m.c.splitterId) b.append(field('Antenna A', select('Antenna A for ' + linkName(it.id), antOpts('rx'), m.c.antA, (v) => connectChannel(store, it.id, { antA: v, antB: m.c.antB }))), field('Antenna B', select('Antenna B for ' + linkName(it.id), antOpts('rx'), m.c.antB, (v) => connectChannel(store, it.id, { antA: m.c.antA, antB: v }))));
        else b.append(el('p', 'hint', 'It takes antenna A and B from the splitter. A splitter costs each output its share of the signal.'));
      },
      transmitter: (it, b) => {
        const m = find.transmitter(it.id); if (!m) return;
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
    const nWarn = warns.filter((w) => w.level === 'warn').length, loads = rackLoads(scene);
    status.textContent = [nWarn ? `⚠ ${nWarn} warning${nWarn === 1 ? '' : 's'}: open the marked items.` : '', loads.total ? `${loads.total} x 50 ohm load to pack.` : ''].filter(Boolean).join(' ');
  }

  const status = el('p', 'hint rack-status'); status.setAttribute('role', 'status');
  const bar = el('div', 'inv-add');
  bar.append(
    btn('Add Rx antenna', () => addRackAntenna(store)), btn('Add splitter', () => addRackSplitter(store)),
    btn('Add Tx antenna', () => addRackAntenna(store, { role: 'tx' })), btn('Add combiner', () => addRackCombiner(store)),
  );
  body.append(el('p', 'hint', 'Every radio item in the show. Open one to see its details and change what it is connected to; the link maths follows.'), bar, status, out);
  let timer = null;
  const queue = () => { clearTimeout(timer); timer = setTimeout(render, 30); };
  const unsub = store.subscribe(queue); render();
  return { render, destroy() { clearTimeout(timer); if (typeof unsub === 'function') unsub(); } };
}
