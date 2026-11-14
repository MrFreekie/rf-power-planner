// Even-order intermodulation (item 23): second order (f1 + f2, |f2 - f1|, 2f) and the usual fourth-order products. Pure functions, no DOM.
// imd.js covers the odd (third and fifth) order products; this module adds the even order ones, which land far from the carriers in a narrow-band
// UHF system and so are usually harmless there, but bite on wideband front ends, octave-wide boosters, mixed VHF/UHF/1.8 GHz/2.4 GHz gear on one
// antenna or cable, harmonics landing in another band, and direct-conversion receivers (low-frequency products).
//
// Product list for tones f1..fN (only positive frequencies; each distinct frequency once per tone set):
//   order 2: fi + fj (i < j), |fi - fj| (i < j), 2 fi (second harmonic)
//   order 4: 2fi + 2fj, |2fi - 2fj|, 3fi - fj and 3fj - fi (i < j), 4 fi (fourth harmonic)
// Level law (input referred, tone levels L in dBm at the nonlinear device input, n = order, same convention as imd.js):
//   P = sum |a_i| L_i - (n - 1) IIPn + 20 log10(m / m_ref),   m = n! / prod |a_i|!,  m_ref = 2 (order 2: the f1 +- f2 pair), 6 (order 4: 2f1 +- 2f2)
// so equal tones of level Pin give P = 2 Pin - IIP2 for f1 +- f2 (slope 2:1: 2 dB per dB of input, against 3:1 for IM3), and the second harmonic
// of one tone sits 6 dB lower, 2 Pin - IIP2 - 6. IIP4 defaults to IIP2 + 15 dB (ASSUMED). The intercepts of real devices are not published for
// most wireless gear, so every default here is an ASSUMED planning number (flag U), not a measurement.
//
// Where a product lands (landsIn): the wanted channel (centre +- half the channel bandwidth), any named band in opts.bands, 'near DC' below
// 5 MHz (audio buzz in direct-conversion designs, ASSUMED limit), or null (outside everything the link uses: harmless unless it hits another
// receiver). Filters: opts.filterBefore attenuates TONES outside its passband before the nonlinearity (a bandpass ahead of a booster); opts.filterAfter
// attenuates PRODUCTS outside its passband after it (a bandpass between the booster and the receiver). Rejection default 40 dB (assumed).

export const IIP2_PRESETS = Object.freeze({
  'wideband-booster': { label: 'Wideband booster or active splitter (470-960 MHz)', iip2Dbm: 30, flag: 'U' },
  'uhf-receiver': { label: 'Narrow-band UHF receiver front end', iip2Dbm: 40, flag: 'U' },
  'direct-conversion': { label: 'Direct-conversion receiver (IP2 limited)', iip2Dbm: 20, flag: 'U' },
  'iem-bodypack': { label: 'IEM bodypack front end', iip2Dbm: 35, flag: 'U' },
});
export const DEFAULT_IIP2_DBM = 30;
export const IIP4_OVER_IIP2_DB = 15;
export const NEAR_DC_MHZ = 5;
export const DEFAULT_FILTER_REJECTION_DB = 40;
export const BELOW_FLOOR_HARMLESS_DB = 10; // a product this far under the noise floor is reported harmless even where it lands
export const DEFAULT_H2_DBC = 50; // radiated second harmonic of a transmitter, dB below the carrier (ASSUMED; regulations typically require 40 to 60)

const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** evenOrderFrequencies(freqsMHz, orders = [2, 4]) -> [{ fMHz, order, terms: [{ tone, coef }], label, kind: 'sum'|'difference'|'harmonic' }] */
export function evenOrderFrequencies(freqsMHz, orders = [2, 4]) {
  const out = [];
  const add = (order, terms, kind) => {
    const f = terms.reduce((s, t) => s + t.coef * freqsMHz[t.tone], 0);
    if (!(Math.abs(f) > 0)) return;
    const sg = f < 0 ? -1 : 1;
    const tt = terms.map((t) => ({ tone: t.tone, coef: t.coef * sg }));
    out.push({ fMHz: Math.abs(f), order, terms: tt, label: labelOf(tt), kind });
  };
  const n = freqsMHz.length;
  for (let i = 0; i < n; i++) {
    if (orders.includes(2)) add(2, [{ tone: i, coef: 2 }], 'harmonic');
    if (orders.includes(4)) add(4, [{ tone: i, coef: 4 }], 'harmonic');
    for (let j = i + 1; j < n; j++) {
      if (orders.includes(2)) { add(2, [{ tone: i, coef: 1 }, { tone: j, coef: 1 }], 'sum'); add(2, [{ tone: i, coef: 1 }, { tone: j, coef: -1 }], 'difference'); }
      if (orders.includes(4)) {
        add(4, [{ tone: i, coef: 2 }, { tone: j, coef: 2 }], 'sum');
        add(4, [{ tone: i, coef: 2 }, { tone: j, coef: -2 }], 'difference');
        add(4, [{ tone: i, coef: 3 }, { tone: j, coef: -1 }], 'difference');
        add(4, [{ tone: i, coef: -1 }, { tone: j, coef: 3 }], 'difference');
      }
    }
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

const mRef = { 2: 2, 4: 6 };
function multiplicity(terms) {
  return fact(terms.reduce((s, t) => s + Math.abs(t.coef), 0)) / terms.reduce((p, t) => p * fact(Math.abs(t.coef)), 1);
}

const inPass = (f, flt) => !flt || !(flt.passLoMHz > 0 && flt.passHiMHz > flt.passLoMHz) || (f >= flt.passLoMHz && f <= flt.passHiMHz);
const rej = (flt) => num(flt && flt.rejectionDb, DEFAULT_FILTER_REJECTION_DB);

/**
 * evenOrderProducts(tones, opts) -> products sorted by level, strongest first. Each:
 *   { fMHz, order, label, kind, levelDbm, landsIn: string|null, severity: 'critical'|'warning'|'info'|'harmless', filteredDb, aboveFloorDb? }
 * tones: [{ freqMHz, levelDbm }] (levels at the nonlinear device input, before any filterBefore is applied here).
 * opts: { iip2Dbm, iip4Dbm, orders = [2, 4], wanted: { freqMHz, bwKHz = 200 }, bands: [{ name, loMHz, hiMHz }], filterBefore, filterAfter,
 *         noiseFloorDbm }
 * severity: 'critical' = lands in the wanted channel; 'warning' = in another named band or near DC; 'info' = in neither but within 10 dB of
 * noiseFloorDbm when given; 'harmless' otherwise, and always when it is more than 10 dB under noiseFloorDbm.
 */
export function evenOrderProducts(tones, opts = {}) {
  const iip2 = num(opts.iip2Dbm, DEFAULT_IIP2_DBM), iip4 = num(opts.iip4Dbm, iip2 + IIP4_OVER_IIP2_DB);
  const f = tones.map((t) => t.freqMHz);
  const lev = tones.map((t) => t.levelDbm - (inPass(t.freqMHz, opts.filterBefore) ? 0 : rej(opts.filterBefore)));
  const wanted = opts.wanted || null, bw = num(wanted && wanted.bwKHz, 200) / 1000;
  const bands = Array.isArray(opts.bands) ? opts.bands : [];
  return evenOrderFrequencies(f, opts.orders || [2, 4]).map((p) => {
    const n = p.order, iip = n === 2 ? iip2 : iip4;
    let level = p.terms.reduce((s, t) => s + Math.abs(t.coef) * lev[t.tone], 0) - (n - 1) * iip + 20 * Math.log10(multiplicity(p.terms) / mRef[n]);
    let filteredDb = 0;
    if (!inPass(p.fMHz, opts.filterAfter)) { filteredDb = rej(opts.filterAfter); level -= filteredDb; }
    let landsIn = null, severity = 'harmless';
    if (wanted && Math.abs(p.fMHz - wanted.freqMHz) <= bw / 2) { landsIn = 'wanted channel'; severity = 'critical'; }
    else {
      const b = bands.find((x) => p.fMHz >= x.loMHz && p.fMHz <= x.hiMHz);
      if (b) { landsIn = b.name; severity = 'warning'; }
      else if (p.fMHz < NEAR_DC_MHZ) { landsIn = 'near DC'; severity = 'warning'; }
    }
    const out = { fMHz: p.fMHz, order: n, label: p.label, kind: p.kind, levelDbm: level, landsIn, severity, filteredDb };
    if (Number.isFinite(opts.noiseFloorDbm)) {
      out.aboveFloorDb = level - opts.noiseFloorDbm;
      if (out.aboveFloorDb < -BELOW_FLOOR_HARMLESS_DB) out.severity = 'harmless'; // far under the receiver noise floor: nobody hears it
      else if (severity === 'harmless') out.severity = 'info';
    }
    return out;
  }).sort((a, b) => b.levelDbm - a.levelDbm);
}

/**
 * radiatedHarmonics(txs, opts) -> [{ txIndex, fMHz: 2 f, levelDbm, landsIn, severity }]: the second harmonic a transmitter radiates, h2Dbc below its
 * carrier (default 50 dB, ASSUMED), arriving at a receiver where the fundamental is carrierDbm; the path is 6 dB weaker at twice the frequency
 * (free space, 20 log 2). opts.filterDb is a low-pass or band filter on the transmitter output (extra rejection of the harmonic).
 * txs: [{ freqMHz, carrierDbm, h2Dbc?, filterDb? }]; opts: { bands, wanted, noiseFloorDbm }.
 */
export function radiatedHarmonics(txs, opts = {}) {
  const bands = Array.isArray(opts.bands) ? opts.bands : [];
  const wanted = opts.wanted || null, bw = num(wanted && wanted.bwKHz, 200) / 1000;
  return txs.map((t, txIndex) => {
    const f = 2 * t.freqMHz;
    const levelDbm = t.carrierDbm - num(t.h2Dbc, DEFAULT_H2_DBC) - num(t.filterDb, 0) - 20 * Math.log10(2);
    let landsIn = null, severity = 'harmless';
    if (wanted && Math.abs(f - wanted.freqMHz) <= bw / 2) { landsIn = 'wanted channel'; severity = 'critical'; }
    else { const b = bands.find((x) => f >= x.loMHz && f <= x.hiMHz); if (b) { landsIn = b.name; severity = 'warning'; } }
    const out = { txIndex, fMHz: f, levelDbm, landsIn, severity };
    if (Number.isFinite(opts.noiseFloorDbm)) { out.aboveFloorDb = levelDbm - opts.noiseFloorDbm; if (out.aboveFloorDb < -BELOW_FLOOR_HARMLESS_DB) out.severity = 'harmless'; }
    return out;
  });
}
