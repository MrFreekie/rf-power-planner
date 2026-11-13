// Intermodulation demonstration model: receiver front-end IM, transmitter reverse IM, passive IM (PIM),
// transmitter noise skirts, noise-floor rise, spectrum and coordination check. Pure module (no DOM, no randomness).
//
// Scene shape (all fields optional, missing ones take the preset or a safe default):
//   scene.imd = { enabled, preset, transmitters: [{ id, name, freqMHz, powerDbm, pos, antenna }], rxAntennaPos,
//                 rxAntenna?, rxChain?, combiner: { type: 'none'|'hybrid'|'isolated', isolationDb, lossDb },
//                 pim: { preset: 'none'|'good'|'corroded', levelDbc }, channelBwKHz, iip3Dbm?, iip5Dbm?, noiseFigureDb? }
// Every transmitter's own channel is a "wanted channel" of the demonstration.
//
// Known gaps (kept simple on purpose): an accidental mixer such as a rusty fence has no position in the scene (use the
// 'rusty-contact' PIM figure as an equivalent junction at the antenna); FM products are drawn as lines although they are about
// three times the channel width (productBandwidthFactor), so the picture understates their overlap with a neighbouring channel.
//
// Conventions: product frequency = sum of a_i f_i with sum a_i = 1; order = sum |a_i|.
// Level laws (input referred, tone levels in dBm at the receiver input, n = order):
//   P = sum |a_i| L_i - (n - 1) IIPn + 20 log10(m / m_ref)
// m = n! / prod |a_i|!  is the multiplicity of the product and m_ref that of the two-tone product of the same order
// ((2,1) for third order, (3,2) for fifth): equal-level three-tone products f1 + f2 - f3 are 20 log10(6/3) = 6 dB higher.

import { solveLink, antennaGainDb, chainItemLossDb, cascadeChainIip3Dbm } from './rf.js';
import { RX_PRESETS, RX_DEFAULTS } from './rx-params.js';
import {
  IMD_PRESETS, COMBINER_PRESETS, TX_REVERSE_IM_CONVERSION_DB, TX_REVERSE_IM_5TH_EXTRA_DB, PIM_JUNCTIONS, PIM_REFERENCE_DBM,
  NEAR_FIELD_FLOOR_WAVELENGTHS, SPEED_OF_LIGHT_M_S, coordinationRules, coupledNoiseDbm,
} from './imd-params.js';

const FLOOR_DBM = -200;
const DEFAULT_ANT = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 0 } };
const pw = (dbm) => Math.pow(10, dbm / 10);
const dbm = (p) => (p > 1e-30 ? 10 * Math.log10(p) : FLOOR_DBM);
const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));

// ---------------------------------------------------------------- product frequencies

/**
 * productFrequencies(freqsMHz, orders = [3, 5]) -> [{ fMHz, order, terms: [{ tone, coef }], label, tones }]
 * All integer vectors a with sum a_i = 1 and sum |a_i| = order (the difference-type products that land near the band):
 * order 3: 2fi - fj (N(N-1)) and fi + fj - fk (N(N-1)(N-2)/2); order 5: 3fi - 2fj, 2fi + fj - 2fk, ... (see imProductCount
 * in imd-params.js). Counts for orders [3] with N = 2, 3, 4, 5: 2, 9, 24, 50. Products at f <= 0 are dropped.
 * `tone` is the 0-based index into freqsMHz. Deterministic order: by order, then lexicographic in a.
 */
export function productFrequencies(freqsMHz, orders = [3, 5]) {
  const n = freqsMHz.length;
  const out = [];
  for (const order of orders) {
    if (order % 2 === 0 || order < 3) continue;
    const pos = (order + 1) / 2, neg = (order - 1) / 2;
    const a = new Array(n).fill(0);
    const rec = (i, p, q) => {
      if (i === n) {
        if (p === 0 && q === 0) emit(order, a.slice());
        return;
      }
      for (let k = -q; k <= p; k++) {
        a[i] = k;
        rec(i + 1, p - Math.max(k, 0), q - Math.max(-k, 0));
      }
      a[i] = 0;
    };
    const emit = (ord, vec) => {
      const f = vec.reduce((s, c, i) => s + c * freqsMHz[i], 0);
      if (!(f > 0)) return;
      const terms = vec.map((coef, tone) => ({ tone, coef })).filter((t) => t.coef !== 0);
      out.push({ fMHz: f, order: ord, terms, label: labelOf(terms), tones: terms.map((t) => t.tone) });
    };
    rec(0, pos, neg);
  }
  return out;
}

function labelOf(terms) {
  const ordered = [...terms.filter((t) => t.coef > 0), ...terms.filter((t) => t.coef < 0)];
  return ordered.map((t, i) => {
    const mag = Math.abs(t.coef);
    const body = `${mag === 1 ? '' : mag}f${t.tone + 1}`;
    return t.coef < 0 ? `-${body}` : i === 0 ? body : `+${body}`;
  }).join('');
}

// ---------------------------------------------------------------- configuration

function imdOf(scene) {
  const imd = scene && scene.imd ? scene.imd : {};
  const preset = IMD_PRESETS[imd.preset] || null;
  return { imd, preset };
}

function txOf(scene) {
  return (scene.imd && scene.imd.transmitters) || [];
}

function bwKHz(scene) {
  const { imd, preset } = imdOf(scene);
  return Number.isFinite(imd.channelBwKHz) ? imd.channelBwKHz : preset && preset.channelBwKhz ? preset.channelBwKhz : 200;
}

function receiver(scene) {
  const { imd, preset } = imdOf(scene);
  const link = (scene.links || [])[0];
  const rxPreset = (link && link.rx && RX_PRESETS[link.rx.rxPreset]) || (preset && RX_PRESETS[preset.rxPresetId]) || RX_DEFAULTS;
  const iip3 = [imd.iip3Dbm, link && link.rx && link.rx.overload && link.rx.overload.iip3Dbm, rxPreset && rxPreset.iip3Dbm, preset && preset.iip3Dbm]
    .find(Number.isFinite) ?? -8;
  const iip5 = [imd.iip5Dbm, preset && preset.iip5Dbm].find(Number.isFinite) ?? iip3 + 12;
  const nf = [imd.noiseFigureDb, preset && preset.noiseFigureDb, rxPreset && rxPreset.noiseFigureDb].find(Number.isFinite) ?? 8;
  return { iip3, iip5, nf };
}

function combinerOf(scene) {
  const c = (scene.imd && scene.imd.combiner) || {};
  const id = c.type === 'hybrid' ? 'passive-hybrid' : c.type === 'isolated' ? 'isolated-cavity' : COMBINER_PRESETS[c.type] ? c.type : 'none';
  const base = COMBINER_PRESETS[id];
  return {
    shared: id !== 'none',
    lossDb: Number.isFinite(c.lossDb) ? c.lossDb : base.insertionLossDb,
    isolationDb: Number.isFinite(c.isolationDb) ? c.isolationDb : base.isolationDb,
  };
}

function conversionDb(scene) {
  const { preset } = imdOf(scene);
  if (preset && Number.isFinite(preset.paConversionDb)) return preset.paConversionDb;
  return TX_REVERSE_IM_CONVERSION_DB['class-ab'];
}

function rxAntenna(scene) {
  const { imd } = imdOf(scene);
  const link = (scene.links || [])[0];
  return imd.rxAntenna || (link && link.rx && link.rx.antenna) || DEFAULT_ANT;
}

function rxPointOf(scene, rxPoint) {
  return rxPoint || (scene.imd && scene.imd.rxAntennaPos) || { x: 0, y: 0, z: 1.5 };
}

// ---------------------------------------------------------------- coupling and received levels

/**
 * couplingLossDb(txA, txB, freqMHz) -> positive dB between two transmit antennas (Friis).
 *   loss = 20 log10(4 pi d_eff / lambda) - G_A(toward B) - G_B(toward A),  d_eff = max(d, 0.5 lambda).
 * The 0.5 lambda floor (NEAR_FIELD_FLOOR_WAVELENGTHS) stops the 20 log d law inside the reactive near field, where the
 * antennas load each other and the formula would otherwise give gain: at 600 MHz it caps the loss at about 16 dB minus the
 * gains. Doubling the distance in the far field adds 6.02 dB.
 */
export function couplingLossDb(txA, txB, freqMHz) {
  const dx = txB.pos.x - txA.pos.x, dy = txB.pos.y - txA.pos.y, dz = (txB.pos.z || 0) - (txA.pos.z || 0);
  const d = Math.hypot(dx, dy, dz);
  const lambda = SPEED_OF_LIGHT_M_S / (freqMHz * 1e6);
  const dEff = Math.max(d, NEAR_FIELD_FLOOR_WAVELENGTHS * lambda);
  const brg = (x, y, z) => ({ az: Math.atan2(x, y) * 180 / Math.PI, el: Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI });
  const gA = antennaGainDb(txA.antenna || DEFAULT_ANT, brg(dx, dy, dz));
  const gB = antennaGainDb(txB.antenna || DEFAULT_ANT, brg(-dx, -dy, -dz));
  return 20 * Math.log10((4 * Math.PI * dEff) / lambda) - gA - gB;
}

// Tone levels at the receiver input: solveLink-style budget (antenna gains, path, reflections, walls, rx chain).
function toneLevels(scene, rxPoint) {
  const comb = combinerOf(scene);
  const rx = rxPointOf(scene, rxPoint);
  const ant = rxAntenna(scene);
  const chain = (scene.imd && scene.imd.rxChain) || [];
  return txOf(scene).map((t) => {
    const powerEff = t.powerDbm - (comb.shared ? comb.lossDb : 0);
    const link = {
      id: `imd-${t.id}`, kind: 'mic', freqMHz: t.freqMHz,
      tx: { pos: t.pos, powerDbm: powerEff, antenna: t.antenna || DEFAULT_ANT },
      rx: { pos: rx, antenna: ant, bodyLossDb: 0, sensitivityDbm: -120 },
      chain,
    };
    const r = solveLink(scene, link);
    return { levelDbm: r.inputPowerDbm, antennaDbm: r.rxPowerDbm, powerEff, pathGainDb: r.inputPowerDbm - powerEff };
  });
}

// ---------------------------------------------------------------- front-end IM

function multiplicity(terms) {
  return fact(terms.reduce((s, t) => s + Math.abs(t.coef), 0)) / terms.reduce((p, t) => p * fact(Math.abs(t.coef)), 1);
}
const REF_MULT = { 3: 3, 5: 10 };

/**
 * cascadeIip3Dbm(chain, rxIip3Dbm, freqMHz) -> IIP3 of "chain then receiver" referred to the antenna terminals, dBm.
 * The implementation is shared with overload.js (cascadeChainIip3Dbm in rf.js, built on cascadeIip3Dbm of rx-params.js):
 *   1 / IIP3_total = sum_k G_before_k / IIP3_k   (linear mW; G_before_k = linear gain ahead of stage k).
 * A high-gain preamp lowers the effective intercept (the reason to use fewer boosters); a pad in front raises it by its loss.
 */
export const cascadeIip3Dbm = cascadeChainIip3Dbm;

/**
 * frontEndImd(scene, rxPoint) -> [{ ...product, source: 'front-end', levelDbm }]
 * Products created in the receiver (or a shared preamp) from the tone levels at its input and the IIP3 / IIP5
 * (3:1 and 5:1 slopes; see the header law). IIP3 comes from imd.iip3Dbm, rx.overload.iip3Dbm, the receiver preset
 * (rx-params) or the imd preset, in that order; IIP5 defaults to IIP3 + 12 dB. With imd.rxChain (boosters, pads, cable) the
 * law is applied at the antenna terminals with the cascaded IIP3 (cascadeIip3Dbm) and IIP5 = IIP3_total + (IIP5 - IIP3)
 * of the receiver; the product is then carried to the receiver input by the net chain gain.
 */
export function frontEndImd(scene, rxPoint, orders = [3, 5]) {
  const tx = txOf(scene);
  if (tx.length < 2) return [];
  const lv = toneLevels(scene, rxPoint);
  const { iip3, iip5 } = receiver(scene);
  const chain = (scene.imd && scene.imd.rxChain) || [];
  const f0 = tx[0].freqMHz;
  const iip3Tot = cascadeIip3Dbm(chain, iip3, f0);
  const iip5Tot = iip3Tot + (iip5 - iip3);
  const chainGainDb = -chain.reduce((s, it) => s + chainItemLossDb(it, f0), 0);
  const L = lv.map((x) => (chain.length ? x.antennaDbm : x.levelDbm));
  return productFrequencies(tx.map((t) => t.freqMHz), orders).map((p) => {
    const iip = p.order === 3 ? iip3Tot : iip5Tot;
    const sum = p.terms.reduce((s, t) => s + Math.abs(t.coef) * L[t.tone], 0);
    const levelDbm = sum - (p.order - 1) * iip + 20 * Math.log10(multiplicity(p.terms) / REF_MULT[p.order]) + (chain.length ? chainGainDb : 0);
    return { ...p, source: 'front-end', levelDbm };
  });
}

// ---------------------------------------------------------------- transmitter reverse IM

/**
 * txReverseImd(scene, rxPoint) -> [{ fMHz, order, label, source: 'tx-reverse', pumpTx, interfererTx, levelDbm, atPaOutDbm }]
 * Product 2 f_a - f_b (order 3) and 3 f_a - 2 f_b (order 5) generated in transmitter a's output stage by the power of
 * transmitter b arriving there:
 *   P_in = P_b - coupling(a, b)   (separate antennas)   or   P_b - combiner isolation   (shared combiner; insertion loss only on the through path)
 *   P_product(at PA out) = P_in - conversion loss       (TX_REVERSE_IM_CONVERSION_DB; +15 dB more for fifth order)
 * It then leaves through a's chain like a's own carrier: level at the receiver = P_product - combiner loss +
 * (L_a - P_a_eff), L_a being a's carrier level at the receiver. Linear in P_in: 6 dB per halving of the distance.
 */
export function txReverseImd(scene, rxPoint) {
  const tx = txOf(scene);
  const comb = combinerOf(scene);
  const conv = conversionDb(scene);
  if (tx.length < 2) return [];
  const lv = toneLevels(scene, rxPoint);
  const out = [];
  tx.forEach((a, ia) => {
    tx.forEach((b, ib) => {
      if (ia === ib) return;
      // shared combiner: port-to-port isolation only (it already includes the split); insertion loss belongs to the through path
      const coupling = comb.shared ? comb.isolationDb : couplingLossDb(a, b, b.freqMHz);
      const pIn = b.powerDbm - coupling;
      for (const order of [3, 5]) {
        const fMHz = order === 3 ? 2 * a.freqMHz - b.freqMHz : 3 * a.freqMHz - 2 * b.freqMHz;
        if (!(fMHz > 0)) continue;
        const atPaOut = pIn - conv - (order === 5 ? TX_REVERSE_IM_5TH_EXTRA_DB : 0);
        const levelDbm = atPaOut - (comb.shared ? comb.lossDb : 0) + lv[ia].pathGainDb;
        out.push({
          fMHz, order, label: order === 3 ? `2f${ia + 1}-f${ib + 1}` : `3f${ia + 1}-2f${ib + 1}`,
          source: 'tx-reverse', pumpTx: a.id, interfererTx: b.id, levelDbm, atPaOutDbm: atPaOut,
          terms: order === 3 ? [{ tone: ia, coef: 2 }, { tone: ib, coef: -1 }] : [{ tone: ia, coef: 3 }, { tone: ib, coef: -2 }],
        });
      }
    });
  });
  return out;
}

// ---------------------------------------------------------------- PIM

function pimDbcAtRef(scene) {
  const p = (scene.imd && scene.imd.pim) || {};
  if (Number.isFinite(p.levelDbc)) return p.levelDbc; // dBc relative to one carrier at the 2 x 43 dBm test condition
  const id = { good: 'good-connector', corroded: 'corroded-connector' }[p.preset] || (PIM_JUNCTIONS[p.preset] ? p.preset : null);
  return id ? PIM_JUNCTIONS[id].dbcAtRef : null;
}

/**
 * pimImd(scene, rxPoint) -> [{ fMHz, order: 3, label, source: 'pim', pumpTx, interfererTx, levelDbm, atJunctionDbm }]
 * Passive IM in transmitter a's connector / cable / antenna from its own output power P_a and the power of transmitter b
 * at the same junction (P_b - coupling for separate antennas, P_b - combiner loss for a shared combiner):
 *   P_pim = (43 + dBcRef) + 2 (P_a - 43) + (P_b' - 43)     (3:1 scaling; equals P + dBc(P) for equal tones)
 * dBcRef is the junction figure at 2 x 43 dBm (pim.preset or pim.levelDbc). Radiated like a's carrier. Preset 'none' gives [].
 */
export function pimImd(scene, rxPoint) {
  const dbcRef = pimDbcAtRef(scene);
  const tx = txOf(scene);
  if (dbcRef === null || tx.length < 2) return [];
  const comb = combinerOf(scene);
  const lv = toneLevels(scene, rxPoint);
  const out = [];
  tx.forEach((a, ia) => {
    tx.forEach((b, ib) => {
      if (ia === ib) return;
      const fMHz = 2 * a.freqMHz - b.freqMHz;
      if (!(fMHz > 0)) return;
      const pa = a.powerDbm - (comb.shared ? comb.lossDb : 0);
      const pb = b.powerDbm - (comb.shared ? comb.lossDb : couplingLossDb(a, b, b.freqMHz));
      const atJunction = (PIM_REFERENCE_DBM + dbcRef) + 2 * (pa - PIM_REFERENCE_DBM) + (pb - PIM_REFERENCE_DBM);
      out.push({
        fMHz, order: 3, label: `2f${ia + 1}-f${ib + 1}`, source: 'pim', pumpTx: a.id, interfererTx: b.id,
        levelDbm: atJunction + lv[ia].pathGainDb, atJunctionDbm: atJunction,
        terms: [{ tone: ia, coef: 2 }, { tone: ib, coef: -1 }],
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------- noise floor

/**
 * noiseFloor(scene, rxPoint) -> { thermalDbm, imSumDbm, txNoiseSkirtDbm, desenseDb, totalDbm, riseDb, perChannel, worstChannel }
 * Per wanted channel (each transmitter's frequency): thermal = -174 + 10 log10(B) + NF; imSum = power sum of every
 * product (front-end, reverse, PIM) whose frequency lies within +-B/2 of the channel; skirt = power sum over the other
 * transmitters b of the coupled wideband noise L_b + L(offset) + 10 log10(B) (txNoiseDbcPerHz, imd-params).
 * total = power sum of the three; rise = total - thermal; desenseDb = rise (sensitivity lost to the extra noise).
 * The headline numbers are those of the channel with the largest rise (worstChannel = its transmitter id).
 */
export function noiseFloor(scene, rxPoint) {
  const tx = txOf(scene);
  const bw = bwKHz(scene);
  const { nf } = receiver(scene);
  const thermalDbm = -174 + 10 * Math.log10(bw * 1000) + nf;
  if (!tx.length) return { thermalDbm, imSumDbm: FLOOR_DBM, txNoiseSkirtDbm: FLOOR_DBM, desenseDb: 0, totalDbm: thermalDbm, riseDb: 0, perChannel: [], worstChannel: null };
  const L = toneLevels(scene, rxPoint).map((x) => x.levelDbm);
  const products = [...frontEndImd(scene, rxPoint), ...txReverseImd(scene, rxPoint), ...pimImd(scene, rxPoint)];
  const perChannel = tx.map((w, iw) => {
    let imP = 0;
    for (const p of products) if (Math.abs(p.fMHz - w.freqMHz) * 1000 <= bw / 2) imP += pw(p.levelDbm);
    let skP = 0;
    tx.forEach((b, ib) => {
      if (ib === iw) return;
      skP += pw(coupledNoiseDbm(L[ib], Math.abs(b.freqMHz - w.freqMHz) * 1000, bw * 1000));
    });
    const total = pw(thermalDbm) + imP + skP;
    return {
      channelId: w.id, freqMHz: w.freqMHz, wantedDbm: L[iw], thermalDbm, imSumDbm: dbm(imP), txNoiseSkirtDbm: dbm(skP),
      totalDbm: dbm(total), riseDb: dbm(total) - thermalDbm, desenseDb: dbm(total) - thermalDbm,
    };
  });
  let worst = perChannel[0];
  for (const c of perChannel) if (c.riseDb > worst.riseDb) worst = c;
  return {
    thermalDbm, imSumDbm: worst.imSumDbm, txNoiseSkirtDbm: worst.txNoiseSkirtDbm, desenseDb: worst.desenseDb,
    totalDbm: worst.totalDbm, riseDb: worst.riseDb, perChannel, worstChannel: worst.channelId,
  };
}

// ---------------------------------------------------------------- coordination

function allProducts(scene, rxPoint) {
  return [...frontEndImd(scene, rxPoint), ...txReverseImd(scene, rxPoint), ...pimImd(scene, rxPoint)];
}

/**
 * coordinationCheck(scene) -> [{ product, channelId, offsetKHz, levelDbm, wantedDbm, ciDb, severity }]
 * Products landing within +-channelBw/2 of any transmitter frequency. A product may land on the channel of one of its own source
 * tones (f1 + f3 - f2 on channel 2 for evenly spaced channels is the classic case): it is a real in-channel interferer and is
 * listed with ownTone = true (the tone sits in the product with a negative coefficient; a positive coefficient needs equal
 * frequencies). Nothing is skipped. ciDb = wanted level - product level. severity: 'critical' when ciDb < requiredCiDb / 3
 * (10 dB), 'warning' when below requiredCiDb (30 dB, coordinationRules), else 'info'. Sorted by ciDb ascending.
 */
export function coordinationCheck(scene, rxPoint) {
  const tx = txOf(scene);
  const bw = bwKHz(scene);
  if (tx.length < 2) return [];
  const L = toneLevels(scene, rxPoint).map((x) => x.levelDbm);
  const out = [];
  for (const p of allProducts(scene, rxPoint)) {
    tx.forEach((w, iw) => {
      const off = (p.fMHz - w.freqMHz) * 1000;
      if (Math.abs(off) > bw / 2) return;
      const ownTone = p.terms.some((t) => t.tone === iw);
      const ci = L[iw] - p.levelDbm;
      const severity = ci < coordinationRules.requiredCiDb / 3 ? 'critical' : ci < coordinationRules.requiredCiDb ? 'warning' : 'info';
      out.push({ product: p, channelId: w.id, ownTone, offsetKHz: off, levelDbm: p.levelDbm, wantedDbm: L[iw], ciDb: ci, severity });
    });
  }
  return out.sort((a, b) => a.ciDb - b.ciDb || a.product.fMHz - b.product.fMHz);
}

// ---------------------------------------------------------------- spectrum

// Narrow peak seen through a Gaussian resolution filter: -3 dB at +-rbw/2 (12 (d/rbw)^2 dB), floor 100 dB down.
const peakDb = (dKHz, rbwKHz) => Math.min(100, 12 * (dKHz / rbwKHz) * (dKHz / rbwKHz));

/**
 * spectrum(scene, { centerMHz, spanMHz, points = 512, rbwKHz = 10 })
 *   -> { freqMHz[], carriersDbm[], im3FrontEndDbm[], im5FrontEndDbm[], txReverseDbm[], pimDbm[], noiseDbm[], markers[], rbwKHz }
 * Each tone or product is a narrow peak at its level seen through the RBW; traces are power sums per mechanism, -200 dBm where
 * empty. noiseDbm = thermal in the RBW plus the coupled transmitter noise skirts. markers: { fMHz, kind: 'carrier' | 'im3'
 * | 'im5' | 'tx-reverse' | 'pim', label, levelDbm, collidesWith: channelId | null } for everything inside the span.
 * Defaults: centre on the mean transmitter frequency, span = 4 x (frequency spread + 1 MHz). Deterministic.
 */
export function spectrum(scene, { centerMHz, spanMHz, points = 512, rbwKHz = 10 } = {}) {
  const tx = txOf(scene);
  const freqs = tx.map((t) => t.freqMHz);
  const lo = freqs.length ? Math.min(...freqs) : 600, hi = freqs.length ? Math.max(...freqs) : 600;
  const centre = Number.isFinite(centerMHz) ? centerMHz : (lo + hi) / 2;
  const span = Number.isFinite(spanMHz) ? spanMHz : 4 * (hi - lo + 1);
  const n = Math.max(8, Math.floor(points));
  const f = new Array(n);
  for (let i = 0; i < n; i++) f[i] = centre - span / 2 + (span * i) / (n - 1);
  const { nf } = receiver(scene);
  const bw = bwKHz(scene);
  const L = tx.length ? toneLevels(scene).map((x) => x.levelDbm) : [];
  const fe = frontEndImd(scene);
  const trace = (items) => f.map((fi) => dbm(items.reduce((s, it) => s + pw(it.levelDbm - peakDb((fi - it.fMHz) * 1000, rbwKHz)), 0)));
  const carriers = tx.map((t, i) => ({ fMHz: t.freqMHz, levelDbm: L[i] }));
  const thermal = -174 + 10 * Math.log10(rbwKHz * 1000) + nf;
  const noiseDbm = f.map((fi) => {
    let p = pw(thermal);
    tx.forEach((b, ib) => {
      const off = Math.abs(fi - b.freqMHz) * 1000;
      if (off >= 199.9) p += pw(coupledNoiseDbm(L[ib], off, rbwKHz * 1000));
    });
    return dbm(p);
  });
  const inSpan = (x) => x.fMHz >= f[0] && x.fMHz <= f[n - 1];
  const markers = [];
  carriers.forEach((c, i) => { if (inSpan(c)) markers.push({ fMHz: c.fMHz, kind: 'carrier', label: tx[i].name || tx[i].id, levelDbm: c.levelDbm, collidesWith: null }); });
  const addMarkers = (items, kindOf) => items.forEach((p) => {
    if (!inSpan(p)) return;
    const own = p.terms.map((t) => t.tone);
    // collision with any channel, including the channel of one of the product's own tones (flagged ownTone)
    const k = tx.findIndex((t) => Math.abs(p.fMHz - t.freqMHz) * 1000 <= bw / 2);
    markers.push({
      fMHz: p.fMHz, kind: kindOf(p), label: p.label, levelDbm: p.levelDbm,
      collidesWith: k >= 0 ? tx[k].id : null, ownTone: k >= 0 && own.includes(k),
    });
  });
  const rev = txReverseImd(scene), pim = pimImd(scene);
  addMarkers(fe, (p) => (p.order === 3 ? 'im3' : 'im5'));
  addMarkers(rev, () => 'tx-reverse');
  addMarkers(pim, () => 'pim');
  markers.sort((a, b) => a.fMHz - b.fMHz || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  return {
    freqMHz: f, rbwKHz,
    carriersDbm: trace(carriers),
    im3FrontEndDbm: trace(fe.filter((p) => p.order === 3)),
    im5FrontEndDbm: trace(fe.filter((p) => p.order === 5)),
    txReverseDbm: trace(rev),
    pimDbm: trace(pim),
    noiseDbm,
    markers,
  };
}

// ---------------------------------------------------------------- distance sweep

const unit = (dx, dy, dz, fallback) => {
  const m = Math.hypot(dx, dy, dz);
  return m < 1e-9 ? fallback : { x: dx / m, y: dy / m, z: dz / m };
};

/**
 * sweepDistance(scene, { txId, from, to, n = 8, what = 'rxAntenna' })
 *   -> { distanceM[], worstProductDbm[], worstFrontEndDbm[], worstReverseDbm[], worstPimDbm[], riseDb[], thermalDbm, what }
 * what 'rxAntenna': the receive antenna is placed at distance d from transmitter txId along the line to its current position.
 * what 'otherTx': transmitter txId is placed at distance d from its nearest other transmitter, along the line between them.
 * Distances are linearly spaced from `from` to `to`. Expected free-space slopes: front-end IM3 gains 18.06 dB per halving
 * of the distance to the rx when all carriers rise together (3 x 6.02), reverse IM 6.02 dB per halving of the tx-tx distance.
 */
export function sweepDistance(scene, { txId, from, to, n = 8, what = 'rxAntenna' } = {}) {
  const base = txOf(scene);
  const ti = base.findIndex((t) => t.id === txId);
  const out = { distanceM: [], worstProductDbm: [], worstFrontEndDbm: [], worstReverseDbm: [], worstPimDbm: [], riseDb: [], thermalDbm: NaN, what };
  if (ti < 0) return out;
  const N = Math.max(2, Math.floor(n));
  const worst = (arr) => (arr.length ? Math.max(...arr.map((p) => p.levelDbm)) : FLOOR_DBM);
  for (let k = 0; k < N; k++) {
    const d = from + ((to - from) * k) / (N - 1);
    const sc = JSON.parse(JSON.stringify(scene));
    const t = sc.imd.transmitters[ti];
    if (what === 'otherTx') {
      let bi = -1, bd = Infinity;
      sc.imd.transmitters.forEach((o, i) => {
        if (i === ti) return;
        const dd = Math.hypot(o.pos.x - t.pos.x, o.pos.y - t.pos.y, (o.pos.z || 0) - (t.pos.z || 0));
        if (dd < bd) { bd = dd; bi = i; }
      });
      if (bi < 0) break;
      const o = sc.imd.transmitters[bi];
      const u = unit(t.pos.x - o.pos.x, t.pos.y - o.pos.y, (t.pos.z || 0) - (o.pos.z || 0), { x: 1, y: 0, z: 0 });
      t.pos = { x: o.pos.x + u.x * d, y: o.pos.y + u.y * d, z: (o.pos.z || 0) + u.z * d };
    } else {
      const rp = sc.imd.rxAntennaPos || { x: 0, y: 10, z: 1.5 };
      const u = unit(rp.x - t.pos.x, rp.y - t.pos.y, (rp.z || 0) - (t.pos.z || 0), { x: 0, y: 1, z: 0 });
      sc.imd.rxAntennaPos = { x: t.pos.x + u.x * d, y: t.pos.y + u.y * d, z: (t.pos.z || 0) + u.z * d };
    }
    const fe = frontEndImd(sc), rev = txReverseImd(sc), pim = pimImd(sc);
    const nz = noiseFloor(sc);
    out.distanceM.push(d);
    out.worstFrontEndDbm.push(worst(fe));
    out.worstReverseDbm.push(worst(rev));
    out.worstPimDbm.push(worst(pim));
    out.worstProductDbm.push(Math.max(worst(fe), worst(rev), worst(pim)));
    out.riseDb.push(nz.riseDb);
    out.thermalDbm = nz.thermalDbm;
  }
  return out;
}
