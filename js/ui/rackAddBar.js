// Add bar of the Radio items list: one-click adds (a mic or IEM copies the selected or last one: same model, same feed, next clean frequency),
// and "Add several" for N mics or IEMs on a chosen receiver or transmitter unit and person, as one undo step.
import { addReceiverFor } from '../actions.js';
import { addRackAntenna, addRackSplitter, addRackCombiner, addReceiver, addTransmitter } from '../actionsRack.js';
import { addRadioChannels } from '../actionsRadio.js';
import { activeLink } from '../view/util.js';
import { RACK_LIMITS } from '../model/rack.js';
import { el, btn, field, select, num } from './rackWidgets.js';

/** addBar({ store, say, reveal(keys, selectId?) }) -> { node, refresh(scene) } */
export function addBar({ store, say, reveal }) {
  const node = el('div', 'rf-addbar'), quick = el('div', 'inv-add');
  const refOf = (kind) => { const sc = store.getScene(), a = activeLink(sc, store.getSelection()); return a && a.kind === kind && a.txOf === undefined ? a.id : undefined; };
  const describe = (ids, kind) => {
    const sc = store.getScene(), ls = ids.map((id) => sc.links.find((l) => l.id === id)).filter(Boolean);
    if (!ls.length) return 'Nothing added: the link limit has been reached.';
    return `Added ${ls.map((l) => `${l.name} (${l.freqMHz.toFixed(3)} MHz)`).join(', ')}: ${kind === 'mic' ? 'same model and antenna feed as the one it copies' : 'same model and combiner or antenna as the one it copies'}, frequencies clear of the show's third-order products. Check them in the Coordination panel before the show.`;
  };
  const addLinks = (kind, o) => {
    const ids = addRadioChannels(store, kind, o); say(describe(ids, kind));
    if (ids.length) { const l = store.getScene().links.find((q) => q.id === ids[0]); reveal(ids.map((id) => `${kind === 'mic' ? 'mic' : 'transmitter'}:${id}`), l.tx.id); }
    return ids;
  };
  quick.append(
    btn('Add mic', () => addLinks('mic', { refLinkId: refOf('mic') }), 'Another microphone: copies the selected (or last) mic\'s model and receive feed, at the next clean frequency'),
    btn('Add receiver', () => { const id = addReceiver(store); if (id) { const c = store.getScene().rack.receivers.flatMap((u) => u.channels).find((x) => x.id === id); reveal([`receiver:${c ? c.linkId || c.id : id}`]); } say(id ? 'Receiver added, tuned to a mic that had none (else 600 MHz). Pick its antennas, and tune it to the exact frequency of a mic to pair them.' : 'Could not add a receiver (limit reached).'); }, 'A receiver of its own: it hears the mic tuned to exactly its frequency'),
    btn('Add transmitter', () => { const id = addTransmitter(store); if (id) { const c = store.getScene().rack.transmitters.flatMap((u) => u.channels).find((x) => x.id === id); reveal([`transmitter:${c ? c.linkId || c.id : id}`]); } say(id ? 'Transmitter added, tuned to a bodypack that had none. Pick its combiner or antenna, and tune it to the exact frequency of a bodypack to pair them.' : 'Could not add a transmitter (limit reached).'); }, 'An IEM transmitter of its own: it sends to the bodypack tuned to exactly its frequency'),
    btn('Add IEM', () => addLinks('iem', { refLinkId: refOf('iem') }), 'Another in-ear mix: copies the selected (or last) IEM transmitter\'s model and combiner, at the next clean frequency'),
    btn('Add bodypack', () => {
      const sc = store.getScene(), act = activeLink(sc, store.getSelection()), prim = sc.links.filter((q) => q.kind === 'iem' && q.txOf === undefined);
      const src = act && act.kind === 'iem' ? (act.txOf !== undefined ? sc.links.find((q) => q.id === act.txOf) : act) : prim[prim.length - 1];
      if (!src) { say('Add an IEM first: a bodypack needs a transmitter to listen to.'); return; }
      const id = addReceiverFor(store, src.id);
      say(id ? `Added a bodypack on ${src.name}'s mix: see it under In-ear bodypacks and assign it to a person there.` : 'Could not add a bodypack (link limit reached).');
      if (id) reveal([`bodypack:${id}`]);
    }, 'Another bodypack on the same IEM transmitter and mix (the selected IEM, or the last one)'),
    btn('Add Rx antenna', () => { const id = addRackAntenna(store); if (id) reveal([`antenna:${id}`]); say(id ? 'Receive antenna added: connect it to a splitter or receiver.' : `At most ${RACK_LIMITS.maxAntennas} antennas.`); }),
    btn('Add splitter', () => { const id = addRackSplitter(store); if (id) reveal([`splitter:${id}`]); say(id ? 'Splitter added: pick its antennas, then feed receivers from it.' : `At most ${RACK_LIMITS.maxSplitters} splitters.`); }),
    btn('Add Tx antenna', () => { const id = addRackAntenna(store, { role: 'tx' }); if (id) reveal([`txantenna:${id}`]); say(id ? 'Transmit antenna added: pick it on an IEM transmitter or combiner.' : `At most ${RACK_LIMITS.maxAntennas} antennas.`); }),
    btn('Add combiner', () => { const id = addRackCombiner(store); if (id) reveal([`combiner:${id}`]); say(id ? 'Combiner added: pick its antenna, then route IEM transmitters through it.' : `At most ${RACK_LIMITS.maxCombiners} combiners.`); }),
  );
  // Add several
  const more = el('details', 'rf-bulk'), ms = el('summary', '', 'Add several mics or IEMs...'), box = el('div', 'rf-bulk-body');
  more.append(ms, box); node.append(quick, more);
  const st = { kind: 'mic', count: 4, unit: '', person: '' };
  function refresh(scene) {
    if (!more.open) return; // built when opened
    box.textContent = '';
    const units = st.kind === 'mic' ? (scene.rack ? scene.rack.receivers : []) : (scene.rack ? scene.rack.transmitters : []);
    const people = scene.people || [];
    box.append(
      field('What', select('Kind to add', [['mic', 'Microphones'], ['iem', 'In-ear mixes (IEM)']], st.kind, (v) => { st.kind = v; st.unit = ''; refresh(store.getScene()); })),
      field('How many', num('How many to add', st.count, (v) => { st.count = Math.round(v); }, 1, 16, 1)),
      field(st.kind === 'mic' ? 'Receiver channels' : 'Transmitter channels', select('Unit for the new channels', [['', 'A new unit each'], ...units.filter((u) => u.channels.length < RACK_LIMITS.maxChannels).map((u) => [u.id, `On ${u.name} (${u.channels.length} in use, up to ${RACK_LIMITS.maxChannels})`])], st.unit, (v) => { st.unit = v; })),
      field('For', select('Person for the new channels', [['', 'No one yet'], ...people.map((p) => [p.id, p.name])], st.person, (v) => { st.person = v; })),
      btn(`Add`, () => addLinks(st.kind, { count: st.count, unitId: st.unit || undefined, personId: st.person || undefined, refLinkId: refOf(st.kind) }), 'Adds them as one undo step: each copies the selected (or last) one of its kind and takes the next clean frequency'),
      el('p', 'hint', 'A person gets the first as their main pack and the rest as extras. Each new channel is fed like the one it copies (same splitter or antennas, same combiner).'),
    );
  }
  more.addEventListener('toggle', () => refresh(store.getScene()));
  return { node, refresh };
}
