// What an open radio item shows: essentials first (what a tech sets on every channel), the rest in its Advanced section.
// makeEditors(ctx) -> { mic, receiver, transmitter, bodypack, antenna, txantenna, splitter, combiner }: each (item, essentials, advanced) fills the two boxes.
// Every control from the old single list is still here; edits go through the same actions (one undo step each).
import { channelRoute, canFeedSplitter, canLoopReceiver, loopLossOf, RACK_LIMITS, DEFAULT_LOOP_LOSS_DB } from '../model/rack.js';
import { CABLES, ANTENNAS, GROUND_PLANE_LABELS, GROUND_PLANE_GAIN_DBI, allowedPolarisations, defaultPolarisation } from '../model/library.js';
import { CHAIN_PRESETS } from '../model/chain-presets.js';
import { chainItemLossDb } from '../model/rf.js';
import { bandOf, nextFreeFrequency } from '../model/radio-items.js';
import { linkCard } from '../model/inventory.js';
import { POLARISATION_LABELS } from './antennaFields.js';
import { gearPickers } from './gearUi.js';
import { addReceiverFor, assignMic, assignIem, assignExtraMic, removeExtraMic, peopleLinkOwners, setLinkField } from '../actions.js';
import {
  renameRackItem, setSplitterType, setSplitterInput, connectChannel, moveChannel, setRackAntenna,
  setCombiner, setSplitterPorts, setRxBias, setRackAntennaType, setRackAntennaAim, setRackAntennaDetail, addAntennaChainItem, setAntennaChainItem, removeAntennaChainItem, setAntennaZones, connectTxChannel, moveTxChannel,
  setCombinerFanout, setFanoutOutput, setTxIsolator, setSplitterFeed, setReceiverLoopLoss,
} from '../actionsRack.js';
import { setChannelFeed, feedValue } from '../actionsRadio.js';
import { el, field, select, text, num, btn, posFields } from './rackWidgets.js';

const RUN_PRESETS = ['lna-20', 'booster-12', 'filter-bandpass', 'filter-highpass', 'filter-lte-block', 'rof-passive-1km', 'rof-active-lna', 'biastee', 'dcblock', 'pad-3', 'pad-6'];
const portOpts = [['', 'As many as used'], ...[2, 3, 4, 5, 6, 8, 12, 16].map((n) => [String(n), `${n} ports`])];
const cableOpts = () => Object.entries(CABLES).map(([k, v]) => [k, v.name]);

/** Text of an antenna's cable run: "RG58 15 m > Booster" (empty run: ''). */
export function runText(a) {
  return ((a && a.chain) || []).map((c) => (c.kind === 'cable' ? `${(CABLES[c.cableType] && CABLES[c.cableType].name.split(' ')[0]) || c.cableType} ${c.lengthM} m` : (c.presetId && CHAIN_PRESETS[c.presetId] ? CHAIN_PRESETS[c.presetId].label.split(' (')[0] : c.kind))).join(' > ');
}
/** Net loss of an antenna's cable run at f (dB, negative = gain). */
export function runLossDb(a, f) { let t = 0; for (const c of (a && a.chain) || []) { try { t += chainItemLossDb(c, f); } catch { /* unpriced item */ } } return t; }

export function makeEditors(ctx) {
  const { store, scene, rack, say, linkName, borrow, isActive } = ctx;
  const link = (id) => scene.links.find((q) => q.id === id);
  const antOpts = (role) => [['', 'No antenna'], ...rack.antennas.filter((a) => (a.role === 'tx') === (role === 'tx')).map((a) => [a.id, a.name])];
  const find = (units, id) => { for (const r of units || []) { const c = r.channels.find((x) => x.linkId === id); if (c) return { r, c }; } return null; };
  const fact = (box, label, value) => { const p = el('p', 'rf-fact'); p.append(el('span', 'rf-fact-k', `${label}: `), el('span', '', value)); box.append(p); };

  /** Name, frequency, band and power: the inspector's own rows while this link is the selected one (one control each), else a button to select it. */
  const tuning = (l, box, withPower) => {
    const rows = isActive(l.id) ? borrow(withPower ? ['link-name', 'link-freq', 'link-band', 'tx-power'] : ['link-name', 'link-freq', 'link-band']) : null;
    if (rows) box.append(rows);
    else { fact(box, 'Frequency', `${l.freqMHz.toFixed(3)} MHz`); box.append(btn('Edit name and frequency', () => store.select(l.tx.id), 'Selects this link; its name, frequency and power fields appear here')); }
    const b = bandOf(l), hint = el('p', b.inWindow ? 'hint' : 'rack-warn-text', b.inWindow ? `Range: ${b.label}${b.onGrid ? '' : ' (off the tuning step)'}` : `Frequency is ${b.label}.`);
    const next = btn('Nearest clean frequency', () => {
      const others = { ...scene, links: scene.links.filter((q) => q.id !== l.id) };
      const n = nextFreeFrequency(others, { kind: l.kind, presetId: l.tx.fmPreset, nearMHz: l.freqMHz });
      setLinkField(store, l.id, 'freqMHz', n.freqMHz);
      say(`${l.name}: ${n.freqMHz.toFixed(3)} MHz (${n.level === 'clean' ? `third-order products at least ${n.clearanceKHz} kHz away` : n.level === 'spacing' ? 'spacing kept, but third-order products could not be cleared: run the Coordination panel' : 'the range is full: run the Coordination panel'}).`);
    }, 'Moves this link up to the next frequency that keeps 300 kHz spacing and stays clear of the third-order products of the whole show, inside the model\'s tuning range');
    const row = el('div', 'rf-row'); row.append(hint, next); box.append(row);
  };

  const owner = (id, box, which) => { // who wears or holds this link: choosing someone moves the pack onto them (the link takes their name)
    const people = scene.people || [], o = peopleLinkOwners(scene).get(id), cur = o ? o.personId : '';
    if (!people.length) { box.append(el('p', 'hint', 'No people in the show yet. Add one in the People section, then assign this link here.')); return; }
    const has = (p) => (which === 'mic' ? p.micLinkId : p.iemLinkId);
    const opts = [['', 'No one'], ...people.map((p) => [p.id, has(p) && has(p) !== id ? `${p.name} (has ${(link(has(p)) || {}).name || 'one'}; adds an extra)` : p.name])];
    box.append(field(which === 'mic' ? 'Worn or held by' : 'Worn by', select('Person for ' + linkName(id), opts, cur, (v) => {
      const who = (pid) => (people.find((x) => x.id === pid) || {}).name || 'the person';
      if (!v) { if (o && o.extra) { removeExtraMic(store, o.personId, id); say(`${linkName(id)} is no longer one of ${who(o.personId)}'s extra packs.`); } else if (o) { (which === 'mic' ? assignMic : assignIem)(store, o.personId, null); say(`${linkName(id)} is no longer ${who(o.personId)}'s main ${which === 'mic' ? 'mic' : 'IEM'}.`); } return; }
      if (o && o.personId === v) { say(`${linkName(id)} is already carried by ${who(v)}.`); return; }
      const swap = !!o && o.personId !== v, pe = people.find((x) => x.id === v);
      if (pe && has(pe) && has(pe) !== id) { assignExtraMic(store, v, id, { swap }); say(`${pe.name} already has ${linkName(has(pe))}, so ${linkName(id)} was added as an extra pack.`); }
      else { (which === 'mic' ? assignMic : assignIem)(store, v, id, { swap }); say(`${linkName(id)} is now ${(pe || {}).name || 'their'}'s main ${which === 'mic' ? 'mic' : 'IEM'}.`); }
    })));
  };
  const power = (l, box) => { // the model's power choices when it has some (gear pickers), else the inspector's Tx power row
    if (box.querySelector('[aria-label^="Transmit power"]')) return;
    const p = isActive(l.id) ? borrow(['tx-power']) : null;
    if (p) box.append(p); else if (!isActive(l.id)) fact(box, 'Power', `${Math.round(Math.pow(10, l.tx.powerDbm / 10) * 10) / 10} mW (${l.tx.powerDbm.toFixed(1)} dBm)`);
  };
  const props = (id, box, idx) => { const c = linkCard(scene, id); if (c) for (const i of idx) if (c.lines[i]) box.append(el('p', 'hint', c.lines[i])); };
  const battery = (l, box) => { const b = l.telemetry && l.telemetry.battery; if (b && b.chemistry) fact(box, 'Battery', String(b.chemistry).replace(/-/g, ' ')); };

  const cableRun = (a, box) => { // cable, booster, filter or fibre between an antenna and its splitter or receiver
    box.append(el('h5', '', 'Cable run from this antenna'));
    (a.chain || []).forEach((c, i) => {
      const row = el('div', 'rack-chain'); row.append(el('strong', '', `${i + 1}. ${c.presetId && CHAIN_PRESETS[c.presetId] ? CHAIN_PRESETS[c.presetId].label : c.kind === 'cable' ? 'Cable' : c.kind}`));
      if (c.kind === 'cable') row.append(field('Cable type', select('Cable type', cableOpts(), c.cableType, (v) => setAntennaChainItem(store, a.id, c.id, { cableType: v }))), field('Length', num('Cable length', c.lengthM, (v) => setAntennaChainItem(store, a.id, c.id, { lengthM: v }), 0, 500), 'm'));
      else if (c.kind === 'booster') row.append(field('Gain', num('Gain', c.gainDb, (v) => setAntennaChainItem(store, a.id, c.id, { gainDb: v }), -50, 60), 'dB'), field('Noise figure', num('Noise figure', c.nfDb, (v) => setAntennaChainItem(store, a.id, c.id, { nfDb: v }), 0, 30), 'dB'));
      else if (c.fibreKm !== undefined) row.append(field('Fibre', num('Fibre length', c.fibreKm, (v) => setAntennaChainItem(store, a.id, c.id, { fibreKm: v }), 0, 20), 'km'));
      else if (c.lossDb !== undefined) row.append(field('Loss', num('Loss', c.lossDb, (v) => setAntennaChainItem(store, a.id, c.id, { lossDb: v }), 0, 60), 'dB'));
      row.append(btn('Remove', () => removeAntennaChainItem(store, a.id, c.id), `Remove item ${i + 1} from the cable run`)); box.append(row);
    });
    if (!(a.chain || []).length) box.append(el('p', 'hint', 'Nothing between this antenna and its splitter or receiver yet (only the receiver\'s own lead).'));
    box.append(select('Add to the cable run', [['', 'Add to the cable run...'], ['cable', 'Cable'], ...RUN_PRESETS.filter((k) => CHAIN_PRESETS[k]).map((k) => [k, CHAIN_PRESETS[k].label])], '', (v) => { if (v) addAntennaChainItem(store, a.id, v === 'cable' ? { kind: 'cable' } : { presetId: v }); }));
  };

  const antennaCore = (a, box) => {
    box.append(field('Name', text('Antenna name', a.name, (v) => renameRackItem(store, 'antennas', a.id, v))));
    const types = Object.entries(ANTENNAS).filter(([k]) => k !== 'body' || a.antenna.type === 'body').map(([k, v]) => [k, v.name]);
    box.append(field('Antenna', select('Antenna type for ' + a.name, types, a.antenna.type, (v) => setRackAntennaType(store, a.id, v))),
      field('Gain', num('Gain', a.antenna.gainDbi, (v) => setRackAntennaAim(store, a.id, { gainDbi: v }), -30, 40), 'dBi'),
      posFields(scene, a.pos, (k, v) => setRackAntenna(store, a.id, { pos: { [k]: v } }), a.name));
  };
  const antennaAdvanced = (a, adv) => {
    const o = a.antenna.orientation || { az: 0, el: 0 };
    adv.append(field('Aim: azimuth', num('Azimuth', o.az, (v) => setRackAntennaAim(store, a.id, { az: v }), 0, 360, 1), 'deg'),
      field('Aim: elevation', num('Elevation', o.el, (v) => setRackAntennaAim(store, a.id, { el: v }), -90, 90, 1), 'deg'),
      field('Tilt (nose up)', num('Tilt', a.antenna.tiltDeg ?? 0, (v) => setRackAntennaDetail(store, a.id, { tiltDeg: v }), -90, 90, 1), 'deg'),
      field('Roll (0 = upright)', num('Roll', a.antenna.rollDeg ?? 0, (v) => setRackAntennaDetail(store, a.id, { rollDeg: v }), -180, 180, 1), 'deg'),
      field('Polarisation', select('Polarisation of ' + a.name, allowedPolarisations(a.antenna.type).map((p) => [p, POLARISATION_LABELS[p] || p]), a.antenna.polarisation ?? defaultPolarisation(a.antenna.type), (v) => setRackAntennaDetail(store, a.id, { polarisation: v }))));
    if (a.antenna.type === 'quarterwave') adv.append(field('Ground plane', select('Ground plane of ' + a.name, [['', 'Not set'], ...Object.keys(GROUND_PLANE_GAIN_DBI).map((g) => [g, `${GROUND_PLANE_LABELS[g]} (${GROUND_PLANE_GAIN_DBI[g]} dBi)`])], a.antenna.groundPlane ?? '', (v) => setRackAntennaDetail(store, a.id, { groundPlane: v }))));
    adv.append(el('p', 'hint', 'Every link fed by this antenna follows these settings. Positions are in stage coordinates: x from the centre line, y from the stage front.'));
  };

  const editors = {
    mic: (it, ess, adv) => {
      const l = link(it.id); if (!l) return;
      tuning(l, ess, false);
      owner(it.id, ess, 'mic');
      ess.append(gearPickers(store, l, 'tx', { modulation: false }));
      power(l, ess);
      battery(l, ess);
      const extras = scene.links.filter((q) => q.txOf === it.id);
      ess.append(el('p', 'hint', extras.length ? `Also heard by ${extras.map((q) => q.name).join(', ')}.` : 'Heard by one receiver.'));
      adv.append(gearPickers(store, l, 'tx', { modulation: 'only' }));
      props(it.id, adv, [1]);
      adv.append(btn('Add a receiver for this mic', () => { const id = addReceiverFor(store, it.id); say(id ? 'Receiver added: see it under Receivers.' : 'Could not add a receiver (link limit reached).'); }, 'A second receiver listening to this transmitter, for a backup, a recording rig or another room. It has its own antenna and path.'));
    },
    bodypack: (it, ess, adv) => {
      const l = link(it.id); if (!l) return;
      fact(ess, 'Frequency', `${l.freqMHz.toFixed(3)} MHz`);
      owner(it.id, ess, 'iem');
      ess.append(gearPickers(store, l, 'rx'));
      battery(l, ess);
      const src = l.txOf !== undefined && link(l.txOf);
      if (src) ess.append(el('p', 'hint', `Listens to ${src.name}: it hears that transmitter and mix, and follows its frequency.`));
      else if (scene.links.some((q) => q.txOf === it.id)) ess.append(el('p', 'hint', `Also heard by ${scene.links.filter((q) => q.txOf === it.id).map((q) => q.name).join(', ')}.`));
      props(it.id, adv, [2]);
    },
    receiver: (it, ess, adv) => {
      const m = find(rack.receivers, it.id); if (!m) return;
      const lk = link(it.id), src0 = lk.txOf !== undefined && link(lk.txOf);
      fact(ess, 'Frequency', `${lk.freqMHz.toFixed(3)} MHz${src0 ? ` (follows ${src0.name})` : ''}`);
      ess.append(gearPickers(store, lk, 'rx'));
      const recvOpts = [...rack.receivers.map((r) => [r.id, `${r.name} (${r.channels.length} channel${r.channels.length === 1 ? '' : 's'})`]), ['new', 'A new receiver unit']];
      ess.append(field('Receiver unit', select('Receiver unit for ' + linkName(it.id), recvOpts, m.r.id, (v) => moveChannel(store, it.id, v))));
      const feeds = [['antennas', 'Antennas directly'], ...rack.splitters.map((s) => [`splitter:${s.id}`, `${s.name} (${s.type})`]),
        ...rack.receivers.filter((x) => x.id !== m.r.id && (canLoopReceiver(rack, m.r.id, x.id) || x.id === m.r.loopFrom)).map((x) => [`loop:${x.id}`, `${x.name} loop-through`])];
      ess.append(field('Fed from', select('Feed for ' + linkName(it.id), feeds, feedValue(m.r, m.c), (v) => setChannelFeed(store, it.id, v))));
      if (!m.r.loopFrom && !m.c.splitterId) ess.append(field('Antenna A', select('Antenna A for ' + linkName(it.id), antOpts('rx'), m.c.antA, (v) => connectChannel(store, it.id, { antA: v, antB: m.c.antB }))), field('Antenna B', select('Antenna B for ' + linkName(it.id), antOpts('rx'), m.c.antB, (v) => connectChannel(store, it.id, { antA: m.c.antA, antB: v }))));
      const route = channelRoute(rack, m.c, m.r);
      for (const [w, a] of [['A', route.antA], ['B', route.antB]]) if (a) fact(ess, `Antenna ${w}`, `${a.name}${runText(a) ? `, cable run ${runText(a)} (${runLossDb(a, lk.freqMHz).toFixed(1)} dB)` : ', no cable run set'}`);
      if (route.antA || route.antB) ess.append(el('p', 'hint', 'Cable, booster and filter between the antenna and this receiver are edited in the antenna item.'));
      // advanced: unit name, loop loss, bias supply
      adv.append(field('Receiver unit name', text('Receiver unit name', m.r.name, (v) => renameRackItem(store, 'receivers', m.r.id, v))));
      if (m.r.loopFrom) adv.append(field(`Loss of this loop-through hop (${Number.isFinite(m.r.loopLossDb) ? 'set by you' : 'assumed ' + DEFAULT_LOOP_LOSS_DB + ' dB'})`, num('Loop-through loss', loopLossOf(m.r), (v) => setReceiverLoopLoss(store, m.r.id, v), 0, 20), 'dB'),
        el('p', 'hint', `This receiver takes the antenna signal passed on by ${(rack.receivers.find((x) => x.id === m.r.loopFrom) || {}).name || 'another receiver'}, with one small insertion loss per hop (about 1 to 3 dB, an assumption: check the data sheet). At most ${RACK_LIMITS.maxLoopHops} hops; the whole unit follows.`));
      else if (m.c.splitterId) adv.append(el('p', 'hint', 'It takes antenna A and B from the splitter. A splitter costs each output its share of the signal.'));
      const on = lk.rx.antennaBiasV > 0, bias = el('input'); bias.type = 'checkbox'; bias.checked = on; bias.setAttribute('aria-label', 'Antenna bias for ' + lk.name);
      bias.addEventListener('change', () => setRxBias(store, it.id, { on: bias.checked }));
      const bl = el('label', 'inv-field rf-check'); bl.append(bias, el('span', '', ' Supply antenna bias from this receiver (powers a booster or active antenna up the cable)')); adv.append(bl);
      if (on) adv.append(field('Bias voltage', num('Bias voltage', lk.rx.antennaBiasV, (v) => setRxBias(store, it.id, { volts: v }), 1, 48), 'V'), field('Bias current limit (0 = not stated)', num('Bias current', lk.rx.antennaBiasMa || 0, (v) => setRxBias(store, it.id, { ma: v }), 0, 1000, 1), 'mA'));
      else adv.append(el('p', 'hint', 'Or put a bias tee in the antenna cable run. The list warns when something on the line needs bias and none reaches it.'));
      props(it.id, adv, [2, 3, 4]);
    },
    transmitter: (it, ess, adv) => {
      const m = find(rack.transmitters, it.id); if (!m) return;
      const l = link(it.id);
      tuning(l, ess, false);
      ess.append(gearPickers(store, l, 'tx', { modulation: false }));
      power(l, ess);
      const opts = [...rack.transmitters.map((r) => [r.id, `${r.name} (${r.channels.length} channel${r.channels.length === 1 ? '' : 's'})`]), ['new', 'A new transmitter unit']];
      ess.append(field('Transmitter unit', select('Transmitter unit for ' + linkName(it.id), opts, m.r.id, (v) => moveTxChannel(store, it.id, v))),
        field('Through', select('Combiner for ' + linkName(it.id), [['', 'Straight to an antenna'], ...rack.combiners.map((c) => [c.id, c.name])], m.c.combinerId || '', (v) => connectTxChannel(store, it.id, v ? { combinerId: v } : { antennaId: m.c.antennaId }))));
      if (!m.c.combinerId) ess.append(field('Antenna', select('Transmit antenna for ' + linkName(it.id), antOpts('tx'), m.c.antennaId, (v) => connectTxChannel(store, it.id, { antennaId: v }))));
      else ess.append(el('p', 'hint', 'The combiner sets the antenna and any cable run; each channel pays the combining loss.'));
      const own = scene.people && peopleLinkOwners(scene).get(it.id);
      if (own) fact(ess, 'Bodypack worn by', ((scene.people || []).find((p) => p.id === own.personId) || {}).name || '-');
      adv.append(field('Transmitter unit name', text('Transmitter unit name', m.r.name, (v) => renameRackItem(store, 'transmitters', m.r.id, v))),
        field('Isolator', select('Isolator for ' + linkName(it.id), [['', 'None'], ['20', 'Isolator, 20 dB'], ['25', 'Isolator, 25 dB'], ['30', 'Circulator, 30 dB']], m.c.isolator ? String(m.c.isolatorDb || 25) : '', (v) => setTxIsolator(store, it.id, !!v, v ? Number(v) : undefined))));
      if (m.c.isolator) adv.append(el('p', 'hint', 'Fitted at the transmitter output: 0.5 dB loss, and reflected power returning to the output stage is cut by the isolation. The combiner-to-combiner IMD isolation setting is separate.'));
      adv.append(gearPickers(store, l, 'tx', { modulation: 'only' }));
      owner(it.id, adv, 'iem');
      props(it.id, adv, [1]);
    },
    antenna: (it, ess, adv) => {
      const a = rack.antennas.find((x) => x.id === it.id); if (!a) return;
      antennaCore(a, ess);
      if (a.role !== 'tx') cableRun(a, ess);
      antennaAdvanced(a, adv);
      if (a.role !== 'tx' && (scene.zones || []).length) {
        adv.append(el('h5', '', 'Zones this antenna serves'), el('p', 'hint', 'A planning note: the list warns about a zone no antenna serves. Coverage results do not use it yet.'));
        for (const z of scene.zones) { const l = el('label', 'inv-field rf-check'), cb = el('input'); cb.type = 'checkbox'; cb.checked = (a.zones || []).includes(z.id); cb.addEventListener('change', () => setAntennaZones(store, a.id, scene.zones.filter((q) => (q.id === z.id ? cb.checked : (a.zones || []).includes(q.id))).map((q) => q.id))); l.append(cb, el('span', '', ` ${z.name || z.id}`)); adv.append(l); }
      }
    },
    txantenna: (it, ess, adv) => {
      const a = rack.antennas.find((x) => x.id === it.id); if (!a) return;
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!a.load; cb.setAttribute('aria-label', 'Dummy load');
      cb.addEventListener('change', () => setRackAntenna(store, a.id, { load: cb.checked }));
      const l = el('label', 'inv-field rf-check'); l.append(cb, el('span', '', ' This is a 50 ohm dummy load: nothing is radiated (1 W is plenty for an IEM)')); ess.append(l);
      antennaCore(a, ess); antennaAdvanced(a, adv);
    },
    splitter: (it, ess, adv) => {
      const s = rack.splitters.find((x) => x.id === it.id); if (!s) return;
      ess.append(field('Name', text('Splitter name', s.name, (v) => renameRackItem(store, 'splitters', s.id, v))),
        field('Type', select('Splitter type', [['passive', 'Passive'], ['active', 'Active (powers the antennas)']], s.type, (v) => setSplitterType(store, s.id, v))),
        field('Ports', select('Splitter ports', portOpts, s.ports ? String(s.ports) : '', (v) => setSplitterPorts(store, s.id, v || null))),
        field('Fed from', select('Splitter feed', [['', 'Antennas'], ...rack.splitters.filter((x) => x.id !== s.id && canFeedSplitter(rack, s.id, x.id)).map((x) => [x.id, `${x.name} (output)`])], s.fromSplitter || '', (v) => setSplitterFeed(store, s.id, v || null))));
      if (s.fromSplitter) adv.append(el('p', 'hint', `Cascaded: takes its signal from an output of another splitter, up to ${RACK_LIMITS.maxSplitterDepth} stages. Each stage adds its own split loss (and gain if active); antennas come from the first stage.`));
      else ess.append(field('Input A', select('Splitter input A', antOpts('rx'), s.antA, (v) => setSplitterInput(store, s.id, 'A', v))),
        field('Input B', select('Splitter input B', antOpts('rx'), s.antB, (v) => setSplitterInput(store, s.id, 'B', v))));
      adv.append(el('p', 'hint', 'An active splitter makes up its split loss and powers the antennas up the cable; a passive one costs each output its share.'));
    },
    combiner: (it, ess, adv) => {
      const c = rack.combiners.find((x) => x.id === it.id); if (!c) return;
      ess.append(field('Name', text('Combiner name', c.name, (v) => renameRackItem(store, 'combiners', c.id, v))),
        field('Type', select('Combiner type', [['passive', 'Passive'], ['active', 'Active']], c.type, (v) => setCombiner(store, c.id, { type: v }))),
        field('Ports', select('Combiner ports', portOpts, c.ports ? String(c.ports) : '', (v) => setCombiner(store, c.id, { ports: v || null }))));
      if (!c.fanout) ess.append(field('Transmit antenna', select('Antenna for ' + c.name, antOpts('tx'), c.antennaId, (v) => setCombiner(store, c.id, { antennaId: v }))));
      ess.append(field('Cable to antenna', num('Cable length for ' + c.name, c.cable ? c.cable.lengthM : 0, (v) => setCombiner(store, c.id, { cableM: v }), 0, 500), 'm'),
        field('Cable type', select('Cable type for ' + c.name, cableOpts(), c.cable ? c.cable.type : 'rg58', (v) => setCombiner(store, c.id, { cableType: v }))));
      adv.append(field('Splitter to several antennas', select('Output splitter for ' + c.name, [['', 'None'], ['passive', 'Passive'], ['active', 'Active']], c.fanout ? c.fanout.type : '', (v) => setCombinerFanout(store, c.id, v ? { on: true, type: v } : { on: false }))));
      if (c.fanout) {
        const outs = c.fanout.outputs;
        [...outs, null].forEach((o, i) => {
          if (!o && outs.length >= 16) return;
          adv.append(field(`Output ${i + 1} antenna`, select(`Splitter output ${i + 1} antenna for ${c.name}`, antOpts('tx'), o ? o.antennaId : '', (v) => setFanoutOutput(store, c.id, i, { antennaId: v }))));
          if (o) adv.append(field(`Output ${i + 1} cable`, num(`Splitter output ${i + 1} cable length for ${c.name}`, o.cable ? o.cable.lengthM : 0, (v) => setFanoutOutput(store, c.id, i, { cableM: v }), 0, 500), 'm'),
            btn(`Remove output ${i + 1}`, () => setFanoutOutput(store, c.id, i, null)));
        });
        adv.append(el('p', 'hint', 'Every antenna gets the splitter loss plus its own cable. The link is solved on the first output that has an antenna; the Transmit antenna field is not used.'));
        ess.append(el('p', 'hint', 'Feeds several antennas through a splitter: set them under Advanced.'));
      }
    },
  };
  return editors;
}
