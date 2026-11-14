// FM deviation comparison: same link, same audio, different peak deviation. Pure function (no DOM, no state), frozen result.
// Units: kHz, dB, dBm.
//
// Formulas (sources in brackets):
//  - Modulation index        beta = deviation / fmax                                   (Carson; Haykin, Communication Systems)
//  - Carson bandwidth        B_C = 2 (deviation + fmax)                                 (Carson's rule)
//  - fmax is the highest modulating frequency: the audio bandwidth, or a tone-key / pilot tone if one sits above the audio.
//  - FM improvement (tone modulation, above threshold) in a receiver noise bandwidth B:
//        SNR_audio = (3/2) beta^2 (B / W) CNR_B                                       (Haykin; Taub and Schilling)
//    With a matched receiver (B = B_C) kTB grows with B, so at the SAME input level B cancels and
//        SNR_audio = P - (-174 + NF) - 10 log10(W) + 10 log10(3/2) + 20 log10(beta)
//    i.e. the audio SNR above threshold rises 20 log10(deviation ratio) for the same audio bandwidth W.
//  - FM threshold (Rice / Taub and Schilling): the output SNR collapses when gamma = A^2 / (2 N0 W) falls below about 20 (beta + 1).
//    Converted to the carrier-to-noise ratio in the matched Carson bandwidth: CNR_B = gamma W / B_C = 20 (beta + 1) W / (2 (dev + W))
//    = 10 (linear) = 10 dB for every deviation, so the threshold CNR does not move, but the threshold INPUT LEVEL
//    P_T = -174 + 10 log10(B_C) + NF + 10 rises 10 log10(B ratio): a wider system needs a stronger signal to stay above threshold.
//  - Below threshold the existing model (mpx.js audioSnrDb) applies, with this threshold and this improvement.
//  - Adjacent channel: neighbour centred one offset away with the same Carson bandwidth: edge gap = offset - B_C (negative = overlap).
//    Receiver adjacent-channel rejection is interpolated (linearly in dB over offset) from the table given in params.acr.
//
// ALL SYSTEM FIGURES ARE EXAMPLES. Deviation of the two equipment-class systems is "based on published specs; some figures assumed":
// SKM 5200-II class +-40 kHz (inferred from the original model), UR4D class +-45 kHz (sourced); +-75 kHz broadcast FM is the usual
// regional figure (inferred) and +-12.5 kHz narrowband two-way with 3 kHz audio is a typical land-mobile class (assumed). Whether a
// tone-key sits above the audio and at what frequency is not published for either system, so toneKeyKhz defaults to null (assumed none).

import { audioSnrDb } from './mpx.js';

export const FM_DEVIATION_DEFAULT_SYSTEMS = Object.freeze([
  Object.freeze({ id: 'skm5200ii-class', label: 'Handheld mic, SKM 5200-II class (+-40 kHz)', deviationKhz: 40, audioBwKhz: 15, toneKeyKhz: null, confidence: Object.freeze({ deviationKhz: 'inferred', audioBwKhz: 'assumed', toneKeyKhz: 'assumed' }) }),
  Object.freeze({ id: 'ur4d-class', label: 'Mic system, UR4D class (+-45 kHz)', deviationKhz: 45, audioBwKhz: 15, toneKeyKhz: null, confidence: Object.freeze({ deviationKhz: 'sourced', audioBwKhz: 'assumed', toneKeyKhz: 'assumed' }) }),
  Object.freeze({ id: 'broadcast-fm', label: 'Broadcast FM (+-75 kHz)', deviationKhz: 75, audioBwKhz: 15, toneKeyKhz: null, confidence: Object.freeze({ deviationKhz: 'inferred', audioBwKhz: 'inferred', toneKeyKhz: 'assumed' }) }),
  Object.freeze({ id: 'narrowband-two-way', label: 'Narrowband two-way (+-12.5 kHz, 3 kHz audio)', deviationKhz: 12.5, audioBwKhz: 3, toneKeyKhz: null, confidence: Object.freeze({ deviationKhz: 'assumed', audioBwKhz: 'assumed', toneKeyKhz: 'assumed' }) }),
]);

/**
 * Optional sixth system: Sennheiser G3 / 2000 series class, +-24 kHz nominal (peak +-48 kHz is the limiter figure; the comparison
 * uses the nominal deviation like the other entries, so its Carson bandwidth is a nominal-deviation estimate). Audio bandwidth set to
 * 15 kHz so the comparison is like for like (the products quote up to 18 kHz). Included with params.includeG3 or by the systems list.
 */
export const FM_DEVIATION_G3_SYSTEM = Object.freeze({ id: 'sennheiser-g3-class', label: 'Mic system, Sennheiser G3 / 2000 class (+-24 kHz)', deviationKhz: 24, audioBwKhz: 15, toneKeyKhz: null, confidence: Object.freeze({ deviationKhz: 'sourced', audioBwKhz: 'assumed', toneKeyKhz: 'assumed' }) });
export const FM_DEVIATION_EXTENDED_SYSTEMS = Object.freeze([FM_DEVIATION_G3_SYSTEM, ...FM_DEVIATION_DEFAULT_SYSTEMS]);

/** Receiver adjacent-channel rejection table of the EM 3732 class (sourced): 75 dB at 400 kHz, 80 dB at 800 kHz. */
export const FM_DEVIATION_DEFAULT_ACR = Object.freeze([Object.freeze({ offsetKhz: 400, db: 75 }), Object.freeze({ offsetKhz: 800, db: 80 })]);

const L10 = (x) => 10 * Math.log10(x);

function acrAt(table, offsetKhz) {
  const t = [...table].sort((a, b) => a.offsetKhz - b.offsetKhz);
  if (!t.length || offsetKhz < t[0].offsetKhz) return null; // inside the first tabulated offset: not specified
  for (let i = 1; i < t.length; i++) {
    if (offsetKhz <= t[i].offsetKhz) {
      const a = t[i - 1], b = t[i];
      return a.db + ((b.db - a.db) * (offsetKhz - a.offsetKhz)) / (b.offsetKhz - a.offsetKhz);
    }
  }
  return t[t.length - 1].db;
}

/**
 * fmDeviationComparison(params?) -> frozen result.
 * params (all optional):
 *   includeG3          true adds FM_DEVIATION_G3_SYSTEM (+-24 kHz) in front of the default systems (ignored when systems is given)
 *   systems            [{ id, label, deviationKhz, audioBwKhz, toneKeyKhz?, confidence? }]  default FM_DEVIATION_DEFAULT_SYSTEMS
 *   inputDbm           receive level at the receiver input, dBm (default -80)
 *   noiseFigureDb      receiver NF, dB (default 6, assumed)
 *   channelBwsKhz      channel widths to test the fit against (default [200, 400])
 *   adjacentOffsetKhz  centre spacing of an adjacent channel (default 400)
 *   acr                [{ offsetKhz, db }] receiver adjacent-channel rejection table (default FM_DEVIATION_DEFAULT_ACR)
 *   referenceId        id of the system the deltas are relative to (default: the first system)
 * result: { inputDbm, noiseFigureDb, referenceId, channelBwsKhz, adjacentOffsetKhz, assumedFigures: [string],
 *   systems: [{ id, label, deviationKhz, audioBwKhz, toneKeyKhz, fmaxKhz, modulationIndex, carsonBwKhz, noiseBwKhz, noiseFloorDbm,
 *     cnrDb, fmImprovementDb, thresholdCnrDb, thresholdInputDbm, aboveThresholdDb, belowThreshold, audioSnrDb,
 *     snrVsReferenceDb, thresholdInputVsReferenceDb, carsonVsReference,
 *     fit: [{ channelKhz, fits, marginKhz, occupancyPct }],
 *     adjacent: { offsetKhz, gapKhz, overlaps, acrDb | null },
 *     confidence, assumed: [paramName] }] }
 */
export function fmDeviationComparison(params = {}) {
  const systems = params.systems && params.systems.length ? params.systems : params.includeG3 ? FM_DEVIATION_EXTENDED_SYSTEMS : FM_DEVIATION_DEFAULT_SYSTEMS;
  const inputDbm = Number.isFinite(params.inputDbm) ? params.inputDbm : -80;
  const nf = Number.isFinite(params.noiseFigureDb) ? params.noiseFigureDb : 6;
  const channels = params.channelBwsKhz && params.channelBwsKhz.length ? [...params.channelBwsKhz] : [200, 400];
  const offset = Number.isFinite(params.adjacentOffsetKhz) ? params.adjacentOffsetKhz : 400;
  const acr = params.acr || FM_DEVIATION_DEFAULT_ACR;

  const rows = systems.map((s) => {
    const fmax = Math.max(s.audioBwKhz, Number.isFinite(s.toneKeyKhz) ? s.toneKeyKhz : 0);
    const beta = s.deviationKhz / fmax;
    const carson = 2 * (s.deviationKhz + fmax);
    const noiseFloor = -174 + L10(carson * 1000) + nf;
    const cnr = inputDbm - noiseFloor;
    // improvement uses the audio bandwidth W for the output noise, beta from the highest modulating frequency (W = fmax when no tone-key)
    const improvement = L10(1.5 * beta * beta * (carson / fmax));
    // threshold: gamma_T = 20 (beta + 1) in W; CNR_B = gamma W / B_C (linear)
    const thrCnr = L10((20 * (beta + 1) * fmax) / carson);
    const thrInput = noiseFloor + thrCnr;
    const snr = audioSnrDb(cnr, { fmImprovementDb: improvement, thresholdCnrDb: thrCnr, snrCeilingDb: 200, belowThresholdSlope: 3 });
    const conf = s.confidence || {};
    const assumed = Object.entries(conf).filter(([, v]) => v !== 'sourced').map(([k]) => k);
    return {
      id: s.id, label: s.label, deviationKhz: s.deviationKhz, audioBwKhz: s.audioBwKhz, toneKeyKhz: Number.isFinite(s.toneKeyKhz) ? s.toneKeyKhz : null,
      fmaxKhz: fmax, modulationIndex: beta, carsonBwKhz: carson, noiseBwKhz: carson, noiseFloorDbm: noiseFloor, cnrDb: cnr,
      fmImprovementDb: improvement, thresholdCnrDb: thrCnr, thresholdInputDbm: thrInput, aboveThresholdDb: cnr - thrCnr,
      belowThreshold: cnr < thrCnr, audioSnrDb: snr,
      fit: channels.map((c) => ({ channelKhz: c, fits: carson <= c, marginKhz: c - carson, occupancyPct: (100 * carson) / c })),
      adjacent: { offsetKhz: offset, gapKhz: offset - carson, overlaps: offset - carson < 0, acrDb: acrAt(acr, offset) },
      confidence: Object.freeze({ ...conf }), assumed,
    };
  });
  const ref = rows.find((r) => r.id === params.referenceId) || rows[0];
  for (const r of rows) {
    r.snrVsReferenceDb = r.audioSnrDb - ref.audioSnrDb;
    r.thresholdInputVsReferenceDb = r.thresholdInputDbm - ref.thresholdInputDbm;
    r.carsonVsReference = r.carsonBwKhz / ref.carsonBwKhz;
    Object.freeze(r.fit.map(Object.freeze)); Object.freeze(r.fit); Object.freeze(r.adjacent); Object.freeze(r.assumed); Object.freeze(r);
  }
  const assumedFigures = ['audio bandwidth (15 kHz, 3 kHz narrowband)', 'receiver noise figure', 'tone-key frequency (none)', 'deviation of the SKM 5200-II class (from the original model)', 'broadcast and narrowband deviations (typical regional figures)'];
  return Object.freeze({
    inputDbm, noiseFigureDb: nf, referenceId: ref.id, channelBwsKhz: Object.freeze(channels), adjacentOffsetKhz: offset,
    assumedFigures: Object.freeze(assumedFigures), systems: Object.freeze(rows),
  });
}
