// Example scene builders: even-order products, tone MPX and intermodulation / IEM 8-channel plans.
import { toneMpxReport } from '../model/tone-mpx.js';
import { createDefaultScene, createDefaultLink, createChainItem, createDefaultImd, createImdTransmitter, newId, syncScene } from '../model/scene.js';
import { txDevice, deriveRack } from '../model/rack.js';
import { make, iemHall } from './helpers.js';

/**
 * Even-order intermodulation examples (item 23). evenScene(id, { fixed }) with fixed false (default) or true for the version with the fix.
 *   'wideband':   mics on 500 and 700 MHz 3 m from a receive antenna with a wideband booster (IIP2 30 dBm, assumed) ahead of a 600 MHz receiver:
 *                 the difference (200 MHz, in an assumed VHF band) and sum (1200 MHz) products; fixed: a 470-698 MHz bandpass (40 dB, assumed) after the booster.
 *   'vhf-uhf':    a 190 MHz VHF mic and a 475 MHz UHF mic into one wideband booster, receiver on 665 MHz: f1 + f2 = 665 MHz lands in the wanted channel;
 *                 fixed: a 470-698 MHz bandpass (60 dB, assumed) BEFORE the booster removes the VHF tone.
 *   'harmonic':   a 902 MHz IEM transmitter 1.5 m from a 1795 MHz IEM bodypack: its second harmonic (50 dBc, assumed) lands at 1804 MHz in the wanted channel
 *                 band; fixed: 60 dB of low-pass on the transmitter output (assumed).
 *   'narrow-uhf': two UHF mics 8.2 MHz apart into a narrow-band receiver: sum near 1220 MHz and difference 8.2 MHz fall outside everything; only IM3 matters.
 */
export function evenScene(id, { fixed = false } = {}) {
  const cfg = {
    wideband: { f: 600.1, kind: 'mic', txs: [['Mic 500', 500.0, 14], ['Mic 700', 700.0, 14]], iip2: 30, bands: [{ name: 'VHF band 174-216 MHz', loMHz: 174, hiMHz: 216 }], booster: true },
    'vhf-uhf': { f: 665.0, kind: 'mic', txs: [['VHF mic', 190.0, 14], ['UHF mic', 475.0, 14]], iip2: 30, bands: [], booster: true },
    harmonic: { f: 1795.0, kind: 'iem', txs: [['UHF IEM', 902.0, 17]], iip2: 35, bands: [{ name: 'IEM band 1785-1805 MHz', loMHz: 1785, hiMHz: 1805 }], booster: false },
    'narrow-uhf': { f: 606.1, kind: 'mic', txs: [['Mic A', 606.1, 14], ['Mic B', 614.3, 14]], iip2: 40, bands: [{ name: 'VHF band 174-216 MHz', loMHz: 174, hiMHz: 216 }], booster: false },
  }[id];
  if (!cfg) return null;
  return imdScene(cfg.kind, cfg.f, cfg.txs.map(([n, f, p]) => [n, f, p, 7.5, 6.5, 1.5]), { preset: 'mic-rack-typical' }, (s, l, m) => {
    s.environment.model = 'free-space';
    s.stage = { width: 20, depth: 14 };
    l.rx.pos = { x: 10, y: 6.5, z: 1.5 }; m.rxAntennaPos = { x: 10, y: 6.5, z: 1.5 };
    m.rxAntenna = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } };
    if (id === 'harmonic') m.transmitters[0].pos = { x: 8.5, y: 6.5, z: 1.5 };
    m.iip2Dbm = cfg.iip2; m.bands = cfg.bands;
    if (cfg.booster) m.rxChain = [createChainItem('booster', { gainDb: 12, nfDb: 4 })];
    if (fixed && id === 'wideband') m.filterAfter = { passLoMHz: 470, passHiMHz: 698, rejectionDb: 40 };
    if (fixed && id === 'vhf-uhf') m.filterBefore = { passLoMHz: 470, passHiMHz: 698, rejectionDb: 60 };
    if (id === 'harmonic') m.filterBefore = { passLoMHz: 1700, passHiMHz: 1900, rejectionDb: 40 }; // the 1.8 GHz bodypack never sees the 902 MHz carrier
    if (fixed && id === 'harmonic') m.transmitters[0].harmonicFilterDb = 60;
  });
}

/**
 * Programme tone against the MPX tones (item 32 and 32a). TONE_MPX_EXAMPLES: id -> { kind: 'iem'|'mic', source, toneHz, settings } where settings are the
 * toneMpxReport() slider values (tone frequency kHz, tone level percent of peak deviation, pilot injection percent, overload level dB, mono).
 * toneMpxScene(id) builds the scene (audioSource and audioToneHz set to match) and toneMpxExampleReport(id) the report the notes quote.
 *   'products':  1 kHz sine at 40 percent of 75 kHz (30 kHz, beta 30) plus the 10 percent pilot (beta 0.395): baseband products and two-tone FM sidebands.
 *   'beat':      a 19.3 kHz tone getting past the audio filter beats with the pilot at 300 Hz.
 *   'sweep':     a sweep captured at 17 kHz (the filter is only 21 dB down there, assumed).
 *   'tone-key':  mono mic, 10.9 kHz tone overloaded: the third harmonic falls at 32.7 kHz in the tone-key window.
 *   'overdev':   a 95 percent tone plus the pilot reaches 104 percent of peak deviation.
 * All filter, nonlinearity and window figures are assumed (flag U); see tone-mpx.js.
 */
export const TONE_MPX_EXAMPLES = Object.freeze({
  products: { kind: 'iem', source: 'tone', toneHz: 1000, settings: { toneKhz: 1, tonePct: 40, pilotPct: 10, overloadDb: -6 } },
  beat: { kind: 'iem', source: 'tone', toneHz: 19300, settings: { toneKhz: 19.3, tonePct: 40, pilotPct: 9, overloadDb: -6 } },
  sweep: { kind: 'iem', source: 'sweep', toneHz: 17000, settings: { toneKhz: 17, tonePct: 40, pilotPct: 9, overloadDb: -6 } },
  'tone-key': { kind: 'mic', source: 'tone', toneHz: 10900, settings: { toneKhz: 10.9, tonePct: 60, pilotPct: 9, overloadDb: 0, mono: true } },
  overdev: { kind: 'iem', source: 'tone', toneHz: 1000, settings: { toneKhz: 1, tonePct: 95, pilotPct: 9, overloadDb: 0 } },
});
export function toneMpxScene(id) {
  const c = TONE_MPX_EXAMPLES[id];
  if (!c) return null;
  const s = createDefaultScene();
  s.links = [createDefaultLink(c.kind)];
  s.links[0].audio = { source: c.source, gainDb: 0 };
  s.audioSource = c.source; s.audioToneHz = c.toneHz;
  return s;
}
export function toneMpxExampleReport(id) {
  const c = TONE_MPX_EXAMPLES[id];
  return c ? toneMpxReport(c.settings) : null;
}

export const ANTENNAS_GAIN = { yagi: 10, paddle: 7, body: -3 };

export const OMNI_IMD = () => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 }, polarisation: 'vertical' });

/** Intermodulation example: the link under test sits on `wantedMHz`, transmitters are [name, MHz, dBm, x, y, z]. */
export function imdScene(kind, wantedMHz, txs, imdExtra, fn) {
  return make(kind, (s, l) => {
    l.freqMHz = wantedMHz;
    const m = createDefaultImd();
    m.enabled = true;
    m.rxAntennaPos = { ...l.rx.pos };
    m.rxAntenna = structuredClone(l.rx.antenna);
    m.transmitters = txs.map(([name, f, p, x, y, z]) => createImdTransmitter({ name, freqMHz: f, powerDbm: p, pos: { x, y, z }, ...(kind === 'iem' ? { antenna: OMNI_IMD() } : {}) }));
    Object.assign(m, imdExtra);
    s.imd = m;
    if (fn) fn(s, l, m);
  });
}

/** Eight coordinated IEM frequencies (MHz), third-order clean (checkIntermod) with a 400 kHz guard, spread over 606 to 630 MHz (illustrative band). */
export const IEM8_PLAN_MHZ = [606.1, 606.5, 607.3, 608.9, 610.9, 614.1, 618.1, 623.7];
const IEM8_DIRECTIONAL = () => ({ type: 'paddle', gainDbi: 7, orientation: { az: 90, el: 0 } });
const IEM8_POWER_DBM = 14; // 25 mW per transmitter

/**
 * iem8Scene(variant, opts): the eight-IEM combining comparison on one geometry (same hall, antenna position, bodypack).
 *   'A': all eight through one isolated 8-way combiner (4.5 dB through, 45 dB port isolation, ASSUMED) to one directional antenna.
 *   'B': seven through a 7-in-8-way combiner (4 dB, 45 dB) to the same directional antenna, transmitter 8 straight to an omni antenna
 *        opts.omniDistanceM (default 2.5 m) from it, in front of the antenna (omniAt 'front', in the main lobe) or beside it ('side', in a pattern null), no isolator unless opts.tx8Isolator (35 dB reverse isolation, 1 dB through).
 *   'C': two 4-way combiners (3 dB, 40 dB) joined by a passive 2-way hybrid (3.5 dB, 25 dB), one antenna. opts.split puts the closely
 *        spaced neighbours in different groups (1,3,5,7 / 2,4,6,8) instead of the clustered grouping (1-4 / 5-8); opts.noIsolators drops the
 *        20 dB reverse isolation of each transmitter's own isolator. Isolated groups: isolation = 2 x isolatorDb (two isolators in series).
 * Losses and isolations are illustrative planning numbers (assumed), not product data.
 */
export function iem8Scene(variant, { omniDistanceM = 2.5, omniAt = 'front', tx8Isolator = false, split = false, noIsolators = false } = {}) {
  return imdScene('iem', IEM8_PLAN_MHZ[0], IEM8_PLAN_MHZ.map((f, i) => [`IEM ${i + 1}`, f, IEM8_POWER_DBM, 3, 10, 1.5]), { preset: 'iem-combiner-isolated', iip3Dbm: 10 }, (s, l, m) => {
    iemHall(s, l, m);
    m.transmitters.forEach((t) => { t.pos = { x: 3, y: 10, z: 1.5 }; t.antenna = IEM8_DIRECTIONAL(); });
    const ids = m.transmitters.map((t) => t.id);
    if (variant === 'A') {
      m.combiner = { type: 'isolated', isolationDb: 45, lossDb: 4.5 };
      m.topology = { groups: [{ id: 'g1', name: '8-way combiner', members: ids, lossDb: 4.5, isolationDb: 45, isolatorDb: 22.5 }] };
    } else if (variant === 'B') {
      m.combiner = { type: 'none', isolationDb: 0, lossDb: 0 };
      const t8 = m.transmitters[7];
      t8.pos = omniAt === 'side' ? { x: 3, y: 10 + omniDistanceM, z: 1.5 } : { x: 3 + omniDistanceM, y: 10, z: 1.5 }; // 'front' = along the boresight (in the main lobe)
      t8.antenna = OMNI_IMD();
      m.topology = { groups: [{ id: 'g1', name: '7-way combiner', members: ids.slice(0, 7), lossDb: 4, isolationDb: 45, isolatorDb: 22.5 }] };
      if (tx8Isolator) m.topology.groups.push({ id: 'g2', name: 'Isolator on IEM 8', members: [ids[7]], lossDb: 1, isolationDb: 0, isolatorDb: 35 });
    } else {
      m.combiner = { type: 'none', isolationDb: 0, lossDb: 0 };
      const iso = noIsolators ? 0 : 20;
      const pick = (idx) => idx.map((i) => ids[i]);
      const a = split ? [0, 2, 4, 6] : [0, 1, 2, 3], b = split ? [1, 3, 5, 7] : [4, 5, 6, 7];
      m.topology = {
        groups: [
          { id: 'g1', name: '4-way combiner 1', members: pick(a), lossDb: 3, isolationDb: 40, isolatorDb: iso, perChannel: true },
          { id: 'g2', name: '4-way combiner 2', members: pick(b), lossDb: 3, isolationDb: 40, isolatorDb: iso, perChannel: true },
        ],
        root: { lossDb: 3.5, isolationDb: 25 },
      };
    }
    iem8Rack(s, l, m);
  });
}

/** Four microphone frequencies (MHz) for micImdScene: 'clean' has no third-order product on any of them, 'equal' is a 400 kHz comb where 2 f2 - f1 = f3 and 2 f3 - f2 = f4. */
export const MIC_IMD_PLANS_MHZ = { clean: [606.1, 606.5, 607.3, 608.9], equal: [606.0, 606.4, 606.8, 607.2] };

/**
 * micImdScene(plan): four microphones in a rack on one omni receive antenna at the front of a 16 x 10 m stage, performers 3 to 7 m from it. The rack takes the intermod
 * transmitters from the microphone links themselves (imd.fromRack), each at its own performer position, so retuning a mic or moving a performer changes the intermod.
 * plan 'clean' (default) or 'equal': see MIC_IMD_PLANS_MHZ. Output power 14 dBm (25 mW), assumed.
 */
export function micImdScene(plan = 'clean') {
  const f = MIC_IMD_PLANS_MHZ[plan] || MIC_IMD_PLANS_MHZ.clean;
  const spots = [{ x: 4, y: 7, z: 1.5 }, { x: 7, y: 4, z: 1.5 }, { x: 9.5, y: 6, z: 1.5 }, { x: 12, y: 3.5, z: 1.5 }];
  return make('mic', (s, l) => {
    s.stage = { width: 16, depth: 10 };
    const ant = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } };
    const links = [l, ...[1, 2, 3].map(() => { const k = structuredClone(l); k.id = newId('link'); k.tx.id = newId('tx'); k.rx.id = newId('rx'); return k; })];
    links.forEach((k, i) => {
      k.name = `Mic ${i + 1}`; k.tx.name = `Mic ${i + 1}`; k.freqMHz = f[i]; k.tx.powerDbm = 14; k.tx.pos = { ...spots[i] };
      k.rx.antenna = structuredClone(ant); k.rx.pos = { x: 8, y: 0.5, z: 2 };
      if (i > 0) k.rx.sharedAntennaOf = links[0].id; else delete k.rx.sharedAntennaOf;
    });
    s.links = links;
    s.rack = deriveRack(s);
    const m = createDefaultImd();
    m.enabled = true; m.fromRack = true; m.transmitters = []; m.iip3Dbm = -30; // a receiver front end with a wideband booster ahead of it, assumed
    s.imd = m;
    syncScene(s);
  });
}

/**
 * iem8Rack(s, l, m): the eight transmitters of an iem8Scene as real links in a frequency-paired rack. Each link sits on its intermod transmitter's exact frequency (so the plan lists the pair once),
 * every combiner group with several members is a rack combiner on the shared antenna, a transmitter outside any group sits on an antenna of its own, and a single-member group is an isolator on that channel.
 * The rack's combiner is the generic passive one, so link margins use its loss; the intermod figures still come from scene.imd, whose combiner and isolation values are the assumed ones.
 */
const sameSpot = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
function iem8Rack(s, l, m) {
  l.rx.antenna = structuredClone(m.rxAntenna); // the bodypacks are the intermod receivers: same antenna as the figures were worked out with
  const links = m.transmitters.map((t, i) => {
    const k = i === 0 ? l : structuredClone(l);
    if (i > 0) { k.id = newId('link'); k.tx.id = newId('tx'); k.rx.id = newId('rx'); }
    k.name = t.name; k.freqMHz = t.freqMHz; k.tx.name = t.name; k.tx.powerDbm = t.powerDbm;
    return k;
  });
  s.links = links;
  const groups = m.topology && Array.isArray(m.topology.groups) ? m.topology.groups : [], rootSpec = m.topology && m.topology.root ? m.topology.root : null;
  const antennas = [{ id: 'ta_main', role: 'tx', name: 'Directional antenna', pos: structuredClone(m.transmitters[0].pos), antenna: structuredClone(m.transmitters[0].antenna) }];
  const combiners = [], channels = [];
  groups.filter((g) => g.members.length > 1).forEach((g, gi) => {
    const cb = { id: `cb_${gi + 1}`, name: g.name, type: !g.perChannel && g.isolatorDb > 0 && g.isolationDb >= 2 * g.isolatorDb ? 'isolated' : 'passive', antennaId: rootSpec ? null : 'ta_main', ports: g.members.length, lossDb: g.lossDb, isolationDb: g.isolationDb };
    if (rootSpec) cb.into = 'cb_root';
    combiners.push(cb);
  });
  if (rootSpec) combiners.push({ id: 'cb_root', name: 'Joining combiner', type: 'passive', antennaId: 'ta_main', ports: 2, lossDb: rootSpec.lossDb, isolationDb: rootSpec.isolationDb });
  m.transmitters.forEach((t, i) => {
    const g = groups.find((q) => q.members.includes(t.id)) || null, cb = g && g.members.length > 1 ? combiners.find((c) => c.name === g.name) : null;
    const own = !cb && !(t.antenna && t.antenna.type === antennas[0].antenna.type && sameSpot(t.pos, antennas[0].pos));
    if (own) antennas.push({ id: `ta_${i + 1}`, role: 'tx', name: `${t.name} antenna`, pos: structuredClone(t.pos), antenna: structuredClone(t.antenna) });
    const ch = { id: `tc_${i + 1}`, linkId: links[i].id, freqMHz: t.freqMHz, tx: txDevice(links[i].tx), combinerId: cb ? cb.id : null, antennaId: cb ? null : own ? `ta_${i + 1}` : 'ta_main' };
    if (g && g.isolatorDb > 0 && (g.members.length === 1 || g.perChannel || !(cb && cb.type === 'isolated'))) { ch.isolator = true; ch.isolatorDb = g.isolatorDb; }
    channels.push(ch);
  });
  s.rack = { byFreq: true, antennas, splitters: [], receivers: [], combiners, transmitters: [{ id: 'rt_1', name: 'IEM Tx', channels }] };
  delete m.topology; m.combiner = { type: 'none', isolationDb: 0, lossDb: 0 }; m.fromRack = true; m.transmitters = []; // the rack now carries the transmitters, antennas and combiners
  syncScene(s); // compiled now, so the shared and reloaded scene are the same
}

/**
 * Review-batch examples (chain parts, polarisation, antenna contact, noise, coverage, fifth-order plans, p2p ground reflection).
 * reviewScene(id, opts) builds the scenes; every figure quoted in a note is recomputed in tests/review-examples.test.mjs. Part losses,
 * isolations and the absorption of a wet body are assumed round numbers for teaching (chain-presets.js and library.js carry the S/I/U flags).
 *   'splitter-two-way-receiver'  opts.part = 'passive' (default) | 'active' | 'none'
 *   'coupler-monitor-tap'        opts.part = 'coupler' (default) | 'none'
 *   'lna-no-filter' / 'filter-before-booster'   the same scene as sosScene('crossed-pol'), a 20 dB LNA with or without the bandpass filter ahead of it
 *   'bias-tee-booster-up-the-mast'  opts.block = true puts a DC block between the cable and the bias tee (the 'bias-tee-into-dcblock' example)
 *   'body-contact-sweaty-bodypack'  opts.contact / opts.dampness override 'skin' / 'wet'
 *   'tilted-whip-vs-vertical'       opts.tiltDeg (default 60)
 *   'circular-polarisation-wanted-mic'  opts.rx = 'circular' (default, helical-cp) | 'vertical'
 *   'ground-plane-quarterwave'      opts.groundPlane = 'none' (default) | 'body' | 'rack' | 'large'
 *   'coverage-modes-compare'        two antennas 1.5 m apart and a front zone; opts.mode sets scene.coverage.mode (default 'power')
 *   'external-noise-urban-vs-quiet' opts.noise = 'urban' (default) | 'quiet' | 0
 *   'audio-bandwidth-iem-vs-mic'    a mic link with a user audio bandwidth (opts.audioBandwidthHz, default 9000; null = none set)
 *   'imd-iem-8-with-fifth-order'    opts.channels = how many of the eight IEM8 channels (default 5)
 *   'pad-on-iem-transmitter'        bandScene('iem-tx-wrong-band', { pad: true }): the 6 dB pad in front of a badly matched transmit antenna
 *   'p2p-ground-reflection'         p2pScene('delay') moved to 40 m (opts.distanceM), paddles horizontal, with the flat-earth ground reflection on (opts.groundReflection = false for the direct ray only)
 */
