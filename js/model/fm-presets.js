// Analogue FM equipment presets (wireless mic / receiver systems). Pure constants and helpers (no DOM, no state), all frozen.
// Units: dBm for levels, dB for ratios, kHz, MHz, mW.
//
// LABEL RULE: these presets are "based on published specs; some figures assumed" (FM_PRESET_DISCLAIMER). They are NOT
// endorsements or certified models of any product. Every parameter has a confidence flag:
//   'sourced'  read in a manufacturer or trade source (titles in `sources`)
//   'inferred' derived here from sourced figures with a stated model (FM threshold, kTB, P1dB to IIP3 rule)
//   'assumed'  not published or not verified: a plausible class value. UI text must show "assumed" next to such a figure.
//
// ADDING A PRESET is a one-entry data change: add one object to FM_PRESET_LIST below (role 'rx' or 'tx'). Rx entries are
// registered automatically as planner receiver presets (rx-params.js RX_PRESETS, link.rx.rxPreset), tx entries are
// available as link.tx.fmPreset / imd transmitter fmPreset. Nothing else needs editing.
//
// Mapping notes (documented, not measured):
//  - Planner sensitivityDbm is "level at which the link just works at the required CNR". For a receiver that quotes SINAD
//    sensitivities, the planner value is the higher (30 dB SINAD, usable audio) figure; the 12 dB SINAD figure is the
//    threshold / dropout point, kept as `thresholdSensitivityDbm`.
//  - requiredCnrDb = sensitivityDbm - (kTB(channelBwKhz) + NF), kTB = -174 + 10 log10(B) (Friis / thermal noise).
//  - Overload: p1dBDbm is the level where the unit flags overload (a "red LED" level is a compression indication, approx),
//    maxInputDbm the quoted maximum; iip3 = p1dB + 9.6 dB (memoryless cubic rule, see rx-params.js).
//  - Low-intermod transmitter modes: reduce the transmitter-side reverse IM product (imd.js txReverseImd) by
//    `lowIntermod.extraConversionDb`. The size is ASSUMED; the only source is a trade report of "about 30 % more
//    simultaneous channels", a manufacturer-side claim that is not independently verified.

export const FM_PRESET_DISCLAIMER = 'Based on published specs; some figures assumed. Not an endorsement or a certified model.';
export const FM_CONFIDENCE_LEVELS = Object.freeze(['sourced', 'inferred', 'assumed']);
export const FM_ROLES = Object.freeze(['tx', 'rx', 'system']);

const noiseDbm = (bwKhz, nfDb) => -174 + 10 * Math.log10(bwKhz * 1000) + nfDb;
const S = 'sourced', I = 'inferred', A = 'assumed';

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};

// ---- Sennheiser evolution wireless G3 (ew 100 / 300 / 500, ew 300 IEM) and 2000 series ----------------------------------
// Built from small helpers so each preset is one call. Figures: see the confidence flags; sources are manufacturer data sheets and
// manuals (titles in `sources`). Mapping notes:
//  - Sensitivity is quoted in microvolts "for 52 dBA rms S/N". Conversion at 50 ohm: P(dBm) = 20 log10(V / 1 uV) - 107 (since
//    20 log10(1e-6) - 10 log10(50) + 30 = -106.99 dBm per 0 dBuV). 2 uV = -101.0 dBm, 4 uV = -95.0 dBm, 1.6 uV = -102.9 dBm. Whether
//    the data sheet means EMF (open circuit, 6 dB lower power) or terminal voltage is not stated: terminal voltage ASSUMED.
//    The "52 dBA S/N" criterion is mapped to the planner's required CNR of 13 dB in 200 kHz (same as the Shure mapping, ASSUMED);
//    the receiver noise figure is then DERIVED: NF = sensitivity - kTB(200 kHz) - 13 dB (7 dB for 2 uV, 13 dB for 4 uV).
//  - Squelch is quoted in dBuV: threshold dBm = dBuV - 107. Default used: 15 dBuV = -92 dBm (the "Middle" step), 3 dB hysteresis ASSUMED.
//  - Adjacent-channel, intermod and blocking figures are stored as data. They are NOT mapped to IIP3 or P1dB: the data sheets
//    give no test conditions (offsets, tone levels, criterion), and IIP3 = S + 1.5 R from a rejection R would give an unrealistic
//    value, so overload levels use the typical-mic-receiver class values (ASSUMED).
//  - "Adaptive diversity" is mapped to the planner's 'ratio' combining mode (ASSUMED); "true diversity" to 'true'.
const dbuvToDbm = (dbuv) => dbuv - 107;
const uvToDbm = (uv) => Math.round((20 * Math.log10(uv) - 107) * 10) / 10;
const mwToDbm = (mw) => Math.round(10 * Math.log10(mw) * 100) / 100;
const SQUELCH_DEFAULT_DBUV = 15;
const G3_RANGES = [
  { id: 'A', label: 'A 516-558 MHz', fromMHz: 516, toMHz: 558 },
  { id: 'G', label: 'G 566-608 MHz', fromMHz: 566, toMHz: 608 },
  { id: 'B', label: 'B 626-668 MHz', fromMHz: 626, toMHz: 668 },
  { id: 'C', label: 'C 734-776 MHz', fromMHz: 734, toMHz: 776 },
  { id: 'D', label: 'D 780-822 MHz', fromMHz: 780, toMHz: 822 },
  { id: 'E', label: 'E 823-865 MHz', fromMHz: 823, toMHz: 865 },
];
const S2000_RANGES = [
  { id: 'Aw', label: 'Aw 516-558 MHz', fromMHz: 516, toMHz: 558 },
  { id: 'Aw+', label: 'Aw+ 470-558 MHz', fromMHz: 470, toMHz: 558 },
  { id: 'Bw', label: 'Bw 626-698 MHz', fromMHz: 626, toMHz: 698 },
  { id: 'Cw', label: 'Cw 718-790 MHz', fromMHz: 718, toMHz: 790 },
  { id: 'Dw', label: 'Dw 790-865 MHz', fromMHz: 790, toMHz: 865 },
  { id: 'Gw', label: 'Gw 558-626 MHz', fromMHz: 558, toMHz: 626 },
  { id: 'Gw1', label: 'Gw1 558-608 MHz', fromMHz: 558, toMHz: 608 },
  { id: 'GBw', label: 'GBw 606-678 MHz (2000 series only)', fromMHz: 606, toMHz: 678 },
];
const S2000_IEM_RANGES = S2000_RANGES.filter((r) => ['Aw+', 'Gw', 'Gw1', 'GBw', 'Bw'].includes(r.id));
const PWR = {
  low: { id: 'low-10mw', label: '10 mW (Low)', powerDbm: mwToDbm(10), lowIntermod: false },
  std: { id: 'std-30mw', label: '30 mW (Standard)', powerDbm: mwToDbm(30), lowIntermod: false },
  high: { id: 'high-50mw', label: '50 mW (High)', powerDbm: mwToDbm(50), lowIntermod: false },
  xp: { id: 'xp-100mw', label: '100 mW (SR 2050XP version)', powerDbm: mwToDbm(100), lowIntermod: false, assumed: true },
};
const SRC_G3 = {
  100: ['Sennheiser EM 100 G3 manual', 'Sennheiser ew 100 G3 data sheets', 'Sennheiser SK 100 G3 / SKM 100 G3 specification'],
  300: ['Sennheiser ew 312 G3 presentation set data sheet'],
  500: ['Sennheiser ew 512 G3 data sheet'],
  iem: ['Sennheiser SR 300 IEM G3 / EK 300 IEM G3 data sheet', 'Sennheiser EK 300 IEM specifications'],
  2000: ['Sennheiser 2000 Series Specifications 03/2019'],
  2000.5: ['Sennheiser 2000 IEM Specifications 10/2023', 'Sennheiser SR 2050 IEM product specification'],
};

// Transmitter entry. o: { id, model, kind, series, options[], ranges, windowMHz, freqs, chPerBank, userBanks, devConf, powerConf, audioKhz, ppm, extra, caveat, sources, extraConf }
function clean(obj) { const out = {}; for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== false) out[k] = v; return out; }
function senTx(o) {
  const dev = o.dev ?? 24, peak = o.peak ?? 48;
  const mfr = o.mfr || 'Sennheiser';
  return {
    id: o.id, label: `${mfr} ${o.model} class ${o.kind} (FM)`, manufacturer: mfr, model: o.model, role: 'tx',
    params: clean({
      powerOptions: o.options, defaultPowerOptionId: o.defaultPowerId || (o.options.length > 1 ? 'std-30mw' : o.options[0].id),
      deviationKhz: dev, peakDeviationKhz: peak, audioBwKhz: o.audioKhz,
      occupiedBwKhz: 2 * (peak + o.audioKhz),     // Carson at peak deviation, ASSUMED (not published)
      tuningStepKhz: o.stepKhz || 25, tuningWindows: o.ranges, tuningWindowMaxMHz: o.windowMHz, frequencies: o.freqs,
      factoryBanks: o.factoryBanks === undefined ? 20 : o.factoryBanks, channelsPerBank: o.chPerBank, userBanks: o.userBanks, stabilityPpm: o.ppm,
      pilotSquelchSwitchable: o.pilotSq === undefined ? true : o.pilotSq,
      paConversionDb: 20, lowIntermod: { available: false },
      ...(o.extra || {}),
    }),
    confidence: {
      powerOptions: o.powerConf, defaultPowerOptionId: A, deviationKhz: o.devConf, peakDeviationKhz: o.devConf, audioBwKhz: o.audioConf || S,
      occupiedBwKhz: A, tuningStepKhz: o.stepConf || S, tuningWindows: o.rangesConf || S, tuningWindowMaxMHz: o.windowConf || S, frequencies: S,
      factoryBanks: S, channelsPerBank: S, userBanks: o.userBanksConf || S, stabilityPpm: o.ppmConf || S, pilotSquelchSwitchable: S,
      paConversionDb: A, lowIntermod: A, ...(o.extraConf || {}),
    },
    sources: o.sources, caveat: o.caveat,
  };
}

// Receiver entry. o: { id, model, kind, uv, typUv?, cnr?, criterion?, ranges, windowMHz, freqs, chPerBank, userBanks, acr, im, blk, diversity ('true'|'switching'|'ratio'|'none'), ... }
function senRx(o) {
  const sens = uvToDbm(o.uv);
  const cnr = o.cnr ?? 13;
  const nf = Math.round((sens + 120.99 - cnr) * 10) / 10;    // NF = sensitivity - kTB(200 kHz) - required CNR
  const iem = o.iem === true;
  const mfr = o.mfr || 'Sennheiser';
  const sq = o.squelchOptions === null ? undefined : (o.squelchOptions || { min: 5, max: 25, stepDb: 2 });
  return {
    id: o.id, label: `${mfr} ${o.model} class ${o.kind} (FM)`, manufacturer: mfr, model: o.model, role: 'rx',
    params: clean({
      sensitivityDbm: sens, sensitivityUv: o.uv, sensitivityCriterion: o.criterion || '52 dBA rms S/N',
      ...(o.typUv ? { typicalSensitivityDbm: uvToDbm(o.typUv), typicalSensitivityUv: o.typUv } : {}),
      channelBwKhz: 200, requiredCnrDb: cnr, noiseFigureDb: nf,
      agcRangeDb: iem ? 60 : 65, p1dBDbm: iem ? -22 : -18, iip3Dbm: iem ? -12 : -8, maxInputDbm: iem ? -15 : -10, overloadHysteresisDb: 3, hotMarginDb: 10,
      squelch: { thresholdDbm: o.squelchDbm ?? dbuvToDbm(SQUELCH_DEFAULT_DBUV), hysteresisDb: 3 },
      squelchOptionsDbuv: sq,
      diversityMode: o.diversity, deviationKhz: o.dev ?? 24, peakDeviationKhz: o.peak ?? 48,
      tuningStepKhz: o.stepKhz || 25, tuningWindows: o.ranges, tuningWindowMaxMHz: o.windowMHz, frequencies: o.freqs,
      factoryBanks: o.factoryBanks === undefined ? 20 : o.factoryBanks, channelsPerBank: o.chPerBank, userBanks: o.userBanks,
      adjacentChannelRejectionMinDb: o.acr, intermodRejectionMinDb: o.im, blockingRejectionMinDb: o.blk,
      pilotSquelchSwitchable: o.pilotSq === undefined ? true : o.pilotSq, antennaInput: o.noAntenna ? undefined : { connector: 'BNC', impedanceOhm: 50, ...(o.bias ? { dcBiasV: o.bias } : {}) },
      ...(o.extra || {}),
    }),
    confidence: {
      sensitivityDbm: I, sensitivityUv: o.uvConf || S, sensitivityCriterion: S, ...(o.typUv ? { typicalSensitivityDbm: I, typicalSensitivityUv: S } : {}),
      channelBwKhz: A, requiredCnrDb: A, noiseFigureDb: I,
      agcRangeDb: A, p1dBDbm: A, iip3Dbm: A, maxInputDbm: A, overloadHysteresisDb: A, hotMarginDb: A,
      squelch: A, squelchOptionsDbuv: o.squelchConf || S, diversityMode: o.diversityConf || S, deviationKhz: o.devConf || S, peakDeviationKhz: o.devConf || S,
      tuningStepKhz: o.stepConf || S, tuningWindows: o.rangesConf || S, tuningWindowMaxMHz: o.windowConf || S, frequencies: S,
      factoryBanks: S, channelsPerBank: S, userBanks: o.userBanksConf || S,
      adjacentChannelRejectionMinDb: o.figConf || S, intermodRejectionMinDb: o.figConf || S, blockingRejectionMinDb: o.figConf || S,
      pilotSquelchSwitchable: S, antennaInput: S, ...(o.extraConf || {}),
    },
    sources: o.sources, caveat: o.caveat,
  };
}

const G3_BAND_CAVEAT = 'Letters A to E, G are mapped to the six ranges by order (assumed).';
const SENNHEISER_G3_2000 = [
  // ---- ew 100 G3 -------------------------------------------------------------------------------------------------
  senTx({ id: 'sennheiser-sk100g3', model: 'SK 100 G3', kind: 'bodypack', options: [PWR.std], ranges: G3_RANGES, rangesConf: I, windowMHz: 42, freqs: 1680, chPerBank: 12, userBanks: 1, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC_G3[100], caveat: `30 mW fixed. Occupied bandwidth is a Carson estimate (assumed). ${G3_BAND_CAVEAT}` }),
  senTx({ id: 'sennheiser-skm100g3', model: 'SKM 100 G3', kind: 'handheld', options: [PWR.std], ranges: G3_RANGES, rangesConf: I, windowMHz: 42, freqs: 1680, chPerBank: 12, userBanks: 1, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC_G3[100], caveat: `30 mW fixed. Occupied bandwidth is a Carson estimate (assumed). ${G3_BAND_CAVEAT}` }),
  senRx({ id: 'sennheiser-em100g3', model: 'EM 100 G3', kind: 'receiver', uv: 2, ranges: G3_RANGES, rangesConf: I, windowMHz: 42, freqs: 1680, chPerBank: 12, userBanks: 1, acr: 65, im: 65, blk: 70, diversity: 'true',
    squelchOptions: { values: [5, 15, 25], names: ['Low', 'Middle', 'High'] },
    sources: SRC_G3[100], caveat: `Sensitivity under 2 uV (-101 dBm at 50 ohm) for 52 dBA S/N; the system page quotes 2.5 uV (discrepancy open). Noise figure is derived (assumed). ${G3_BAND_CAVEAT}` }),
  // ---- ew 300 G3 -------------------------------------------------------------------------------------------------
  senTx({ id: 'sennheiser-sk300g3', model: 'SK 300 G3', kind: 'bodypack', options: [PWR.low, PWR.std], ranges: G3_RANGES, rangesConf: I, windowMHz: 42, freqs: 1680, chPerBank: 24, userBanks: 6, userBanksConf: A, devConf: I, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC_G3[300], caveat: `10 or 30 mW. Deviation is not printed for the ew 300 G3 (taken from the same platform, inferred). ${G3_BAND_CAVEAT}` }),
  senTx({ id: 'sennheiser-skm300g3', model: 'SKM 300 G3', kind: 'handheld', options: [PWR.low, PWR.std], ranges: G3_RANGES, rangesConf: I, windowMHz: 42, freqs: 1680, chPerBank: 24, userBanks: 6, userBanksConf: A, devConf: I, powerConf: A, audioKhz: 18, ppm: 15,
    sources: SRC_G3[300], caveat: `Power options assumed the same as the SK 300 G3; deviation inferred. ${G3_BAND_CAVEAT}` }),
  senRx({ id: 'sennheiser-em300g3', model: 'EM 300 G3', kind: 'receiver', uv: 2, ranges: G3_RANGES, rangesConf: I, windowMHz: 42, freqs: 1680, chPerBank: 24, userBanks: 6, userBanksConf: A, acr: 75, im: 70, blk: 75, figConf: A, diversity: 'true',
    squelchConf: A, devConf: I,
    sources: SRC_G3[300], caveat: `The adjacent/intermod/blocking column order is garbled in the data sheet (assumed), the squelch range is assumed from the EM 500 G3 and deviation is inferred. ${G3_BAND_CAVEAT}` }),
  // ---- ew 500 G3 -------------------------------------------------------------------------------------------------
  senTx({ id: 'sennheiser-sk500g3', model: 'SK 500 G3', kind: 'bodypack', options: [PWR.low, PWR.std], ranges: G3_RANGES, rangesConf: I, windowMHz: 42, freqs: 1680, chPerBank: 32, userBanks: 1, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC_G3[500], caveat: `10 or 30 mW, no 50 mW option found. ${G3_BAND_CAVEAT}` }),
  senTx({ id: 'sennheiser-skm500g3', model: 'SKM 500 G3', kind: 'handheld', options: [PWR.low, PWR.std], ranges: G3_RANGES, rangesConf: I, windowMHz: 42, freqs: 1680, chPerBank: 32, userBanks: 1, devConf: S, powerConf: A, audioKhz: 18, ppm: 15,
    sources: SRC_G3[500], caveat: `Power options assumed the same as the SK 500 G3. ${G3_BAND_CAVEAT}` }),
  senRx({ id: 'sennheiser-em500g3', model: 'EM 500 G3', kind: 'receiver', uv: 2, ranges: G3_RANGES, rangesConf: I, windowMHz: 42, freqs: 1680, chPerBank: 32, userBanks: 1, acr: 75, im: 70, blk: 75, diversity: 'true',
    sources: SRC_G3[500], caveat: `Sensitivity under 2 uV (-101 dBm at 50 ohm) for 52 dBA S/N; noise figure derived (assumed). ${G3_BAND_CAVEAT}` }),
  // ---- ew 300 IEM G3 (no ew 500 IEM G3 exists) -----------------------------------------------------------------
  senTx({ id: 'sennheiser-sr300iemg3', model: 'SR 300 IEM G3', kind: 'IEM transmitter', options: [PWR.low, PWR.std], ranges: G3_RANGES, rangesConf: I, windowMHz: 42, freqs: 1680, chPerBank: 16, userBanks: 6, devConf: I, powerConf: S, audioKhz: 15, ppm: 15,
    extra: { mpxPilotKhz: 19, pilotDeviationKhz: 5, antennaOutput: { connector: 'BNC', impedanceOhm: 50 } },
    extraConf: { mpxPilotKhz: I, pilotDeviationKhz: I, antennaOutput: S },
    sources: SRC_G3.iem, caveat: `10 or 30 mW. The stereo pilot (19 kHz, +-5 kHz) is taken from the 2000 series and deviation is not printed for the SR (both assumed). ${G3_BAND_CAVEAT}` }),
  senRx({ id: 'sennheiser-ek300iemg3', model: 'EK 300 IEM G3', kind: 'bodypack receiver', iem: true, uv: 4, typUv: 1.6, ranges: G3_RANGES, rangesConf: I, windowMHz: 42, freqs: 1680, chPerBank: 16, userBanks: 6, acr: 65, im: 70, blk: 80, diversity: 'ratio', diversityConf: A,
    sources: SRC_G3.iem, caveat: `Under 4 uV (-95 dBm), typically 1.6 uV (-103 dBm) for 52 dBA S/N; the planner uses the guaranteed figure. Adaptive diversity is mapped to ratio combining (assumed). ${G3_BAND_CAVEAT}` }),
  // ---- 2000 series -----------------------------------------------------------------------------------------------
  senRx({ id: 'sennheiser-em2050', model: 'EM 2050 / EM 2000', kind: 'dual / single receiver', uv: 2, uvConf: A, ranges: S2000_RANGES, windowMHz: 75, freqs: 3000, chPerBank: 64, userBanks: 6, acr: 80, im: 75, blk: 80, diversity: 'true', bias: 11,
    sources: SRC_G3[2000], caveat: 'About 2 uV; the less-than sign was lost in the source, so under 2 uV is assumed. Same figures for the single-channel EM 2000. GBw 606-678 is 2000-series only.' }),
  senTx({ id: 'sennheiser-sk2000', model: 'SK 2000', kind: 'bodypack', options: [PWR.low, PWR.std, PWR.high], ranges: S2000_RANGES, windowMHz: 75, freqs: 3000, chPerBank: 64, userBanks: 6, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC_G3[2000], caveat: '10 / 30 / 50 mW. Occupied bandwidth is a Carson estimate (assumed).' }),
  senTx({ id: 'sennheiser-skm2000', model: 'SKM 2000', kind: 'handheld', options: [PWR.low, PWR.std, PWR.high], ranges: S2000_RANGES, windowMHz: 75, freqs: 3000, chPerBank: 64, userBanks: 6, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC_G3[2000], caveat: '10 / 30 / 50 mW. Occupied bandwidth is a Carson estimate (assumed).' }),
  senTx({ id: 'sennheiser-skp2000', model: 'SKP 2000', kind: 'plug-on', options: [PWR.low, PWR.std, PWR.high], ranges: S2000_RANGES, windowMHz: 75, freqs: 3000, chPerBank: 64, userBanks: 6, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC_G3[2000], caveat: '10 / 30 / 50 mW. Occupied bandwidth is a Carson estimate (assumed).' }),
  senTx({ id: 'sennheiser-sr2050iem', model: 'SR 2050 IEM', kind: 'IEM transmitter (dual stereo)', options: [PWR.low, PWR.std, PWR.high, PWR.xp], ranges: S2000_IEM_RANGES, windowMHz: 75, freqs: 3000, chPerBank: 32, userBanks: 6, devConf: S, powerConf: I, audioKhz: 15, ppm: 10,
    extra: { mpxPilotKhz: 19, pilotDeviationKhz: 5, antennaOutput: { connector: 'BNC', impedanceOhm: 50 } },
    extraConf: { mpxPilotKhz: S, pilotDeviationKhz: S, antennaOutput: S },
    sources: SRC_G3['2000.5'], caveat: '10 / 30 / 50 mW; the 100 mW option belongs to the SR 2050XP version and is flagged assumed. 19 kHz pilot with +-5 kHz deviation is sourced.' }),
  senRx({ id: 'sennheiser-ek2000iem', model: 'EK 2000 IEM', kind: 'bodypack receiver', iem: true, uv: 4, typUv: 1.6, ranges: S2000_IEM_RANGES, windowMHz: 75, freqs: 3000, chPerBank: 32, userBanks: 6, acr: 80, im: 78, blk: 80, diversity: 'ratio', diversityConf: A,
    sources: SRC_G3['2000.5'], caveat: 'Under 4 uV (-95 dBm), typically 1.6 uV (-103 dBm) for 52 dBA S/N; the planner uses the guaranteed figure. Adaptive diversity is mapped to ratio combining (assumed).' }),
];

// ---- More Sennheiser families (G2, G4, IEM G4, 3000, 5000, 3254/3256, IEM G2) and Shure PSM 900 / PSM 1000 ----------------------
// Same helpers and mapping notes as the G3 block above. Additional mappings:
//  - PSM receivers quote sensitivity at 20 dB SINAD (2.2 uV = -100.2 dBm at 50 ohm, terminal voltage assumed). As for the UR
//    mapping the quoted SINAD figure is the planner sensitivity; the required CNR comes from the UR SINAD line (12 dB SINAD ->
//    8 dB CNR, 30 dB SINAD -> 13 dB CNR, linear in between, ASSUMED): 20 dB SINAD -> 10.2 dB, 22 dB SINAD -> 10.8 dB. NF is then derived
//    (10.6 dB), and the squelch default (22 dB SINAD, +-3 dB) maps to kTB(200 kHz) + NF + 10.8 dB = -99.6 dBm (assumed).
//  - Naming: there is no SKM 3000, no EM 5000, no ew 300 or 500 IEM G4 and no SR 3300; the corresponding real products are modelled
//    (SK 3063, SKM 3072, SKP 3000, EM 3031 / EM 3032, SKM 5000, ew IEM G4, SR 3254 / SR 3256). G1 and the ew 300 / 500 G2 data sheets
//    were not read, so those are gaps and have no presets.
const mwId = (mw, id, label, extra) => ({ id, label, powerDbm: mwToDbm(mw), lowIntermod: false, ...(extra || {}) });
const rng = (id, label, fromMHz, toMHz) => ({ id, label: `${label} ${fromMHz}-${toMHz} MHz`, fromMHz, toMHz });
const G2_RANGES = [rng('518-554', '', 518, 554), rng('626-662', '', 626, 662), rng('740-776', '', 740, 776), rng('786-822', '', 786, 822), rng('830-866', '', 830, 866)].map((r) => ({ ...r, label: r.label.trim() }));
const G2_IEM_RANGES = [rng('518-554', '', 518, 554), rng('572-608', '', 572, 608), rng('626-662', '', 626, 662), rng('740-776', '', 740, 776), rng('786-822', '', 786, 822), rng('830-866', '', 830, 866)].map((r) => ({ ...r, label: r.label.trim() }));
const G4_100_RANGES = [rng('A1', 'A1', 470, 516), rng('A', 'A', 516, 558), rng('AS', 'AS', 520, 558), rng('G', 'G', 566, 608), rng('GB', 'GB', 606, 648), rng('B', 'B', 626, 668),
  rng('C', 'C', 734, 776), rng('D', 'D', 780, 822), rng('E', 'E', 823, 865), rng('JB', 'JB', 806, 810), rng('K+', 'K+', 925, 937.5), rng('1G8', '1G8', 1785, 1800)];
const G4_500_RANGES = [rng('Aw+', 'Aw+', 470, 558), rng('AS', 'AS', 520, 558), rng('Gw1', 'Gw1', 558, 608), rng('Gw', 'Gw', 558, 626), rng('GBw', 'GBw', 606, 678), rng('Bw', 'Bw', 626, 698),
  rng('Cw', 'Cw', 718, 790), rng('Dw', 'Dw', 790, 865), rng('JB', 'JB', 806, 810), rng('K+', 'K+', 925, 937.5)];
const G4_IEM_RANGES = G4_100_RANGES.filter((r) => !['JB', 'K+', '1G8'].includes(r.id));
const G4_IEM_RX_RANGES = [...G4_IEM_RANGES, rng('C-TH', 'C-TH', 748.2, 757.8)];
const SERIES3000_SKP_RANGES = [rng('518-554', '', 518, 554), rng('556-592', '', 556, 592), rng('576-612', '', 576, 612), rng('626-662', '', 626, 662), rng('670-706', '', 670, 706),
  rng('696-732', '', 696, 732), rng('740-776', '', 740, 776), rng('786-822', '', 786, 822), rng('830-866', '', 830, 866)].map((r) => ({ ...r, label: r.label.trim() }));
const SPAN_450_960 = [{ id: 'span', label: '450-960 MHz in 24 MHz windows', fromMHz: 450, toMHz: 960 }];
const SKM5000_RANGES = [rng('A', 'A', 450, 570), rng('B', 'B', 550, 690), rng('C', 'C', 670, 820), rng('D', 'D', 800, 960)];
const PSM900_RANGES = [rng('G6', 'G6 / G6E', 470, 506), rng('G7', 'G7 / G7E', 506, 542), rng('K1', 'K1 / K1E', 596, 632), rng('L6', 'L6 / L6E', 656, 692), rng('P7', 'P7', 702, 742),
  rng('Q15', 'Q15', 750, 790), rng('R21', 'R21', 794, 806), rng('X7', 'X7', 925, 937.5), rng('X1', 'X1', 944, 952)];
const PSM1000_RANGES = [rng('G10', 'G10', 470, 542), rng('H8Z', 'H8Z', 518, 582), rng('J8', 'J8', 554, 626), rng('K10E', 'K10E', 596, 668), rng('L8', 'L8', 626, 698), rng('L9E', 'L9E', 670, 742),
  rng('P8', 'P8', 710, 790), rng('Q21', 'Q21', 710, 787), rng('Q22E', 'Q22E', 750, 822), rng('R27', 'R27', 794, 806), rng('X1', 'X1', 944, 952), rng('X7', 'X7', 925, 937.5)];
const SRC2 = {
  g2: ['Sennheiser EM 100 G2 manual', 'Sennheiser SK 100 G2 specifications'],
  g4100: ['Sennheiser ew 100 G4 product specification'],
  g4500: ['Sennheiser ew 500 G4 product specification', 'Sennheiser SK 500 G4 product specification'],
  g4iem: ['Sennheiser ew IEM G4 product specification'],
  s3000: ['Sennheiser EM 3031 / EM 3032 data sheet', 'Sennheiser SKP 3000 manual'],
  s5000: ['Sennheiser SKM 5000 data sheet', 'Sennheiser EM 3732-II data sheet'],
  sr3254: ['Sennheiser SR 3254 / SR 3256 manual', 'Sennheiser EK 3253 manual'],
  iemg2: ['Sennheiser ew 300 IEM G2 manual'],
  psm900: ['Shure PSM 900 specification sheets'],
  psm1000: ['Shure PSM 1000 specification sheet'],
};
const PSM_SINAD_NOTE = 'Sensitivity is 2.2 uV (-100.2 dBm) at 20 dB SINAD; required CNR 10.2 dB comes from the UR SINAD line (assumed).';
const psmExtraConf = { compander: S, mpxPilotKhz: S, pilotToleranceKhz: S, compatibleFrequenciesPerBand: S };
const psmTx = (o) => senTx({ mfr: 'Shure', kind: 'IEM transmitter (dual stereo)', dev: 34, peak: 34, audioKhz: 15, audioConf: I, devConf: S, powerConf: I, stepKhz: 25, stepConf: A, windowConf: I,
  factoryBanks: null, pilotSq: false, ppm: 2.5, defaultPowerId: 'low-10mw', options: [PWR.low, PWR.high, mwId(100, 'hi-100mw', '100 mW (band dependent)')],
  extra: { compander: 'Audio Reference Companding', mpxPilotKhz: 19, pilotToleranceKhz: 0.3, compatibleFrequenciesPerBand: o.perBank }, extraConf: psmExtraConf, ...o });

const SENNHEISER_MORE = [
  // ---- evolution wireless G2: only ew 100 G2 data was read (ew 300 / 500 G2 and G1 are gaps) -------------------------
  senTx({ id: 'sennheiser-sk100g2', model: 'SK 100 G2', kind: 'bodypack', options: [PWR.std], ranges: G2_RANGES, windowMHz: 36, freqs: 1440, factoryBanks: 8, chPerBank: 4, userBanks: 1, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC2.g2, caveat: '30 mW. Data from the ew 100 G2; the ew 300 / 500 G2 and G1 were not researched. Occupied bandwidth is a Carson estimate (assumed).' }),
  senTx({ id: 'sennheiser-skm100g2', model: 'SKM 100 G2', kind: 'handheld', options: [PWR.std], ranges: G2_RANGES, windowMHz: 36, freqs: 1440, factoryBanks: 8, chPerBank: 4, userBanks: 1, devConf: S, powerConf: A, audioKhz: 18, ppm: 15,
    sources: SRC2.g2, caveat: '30 mW assumed the same as the SK 100 G2. The ew 300 / 500 G2 and G1 were not researched. Occupied bandwidth is a Carson estimate (assumed).' }),
  senRx({ id: 'sennheiser-em100g2', model: 'EM 100 G2', kind: 'receiver', uv: 2.5, ranges: G2_RANGES, windowMHz: 36, freqs: 1440, factoryBanks: 8, chPerBank: 4, userBanks: 1, acr: 65, im: 65, blk: 70, diversity: 'true',
    squelchOptions: { values: [5, 15, 25], names: ['Low', 'Middle', 'High'] },
    sources: SRC2.g2, caveat: 'Under 2.5 uV (-99.0 dBm) for 52 dBA S/N; noise figure derived (assumed). Five ranges of 36 MHz; the G1 generation has no pilot squelch and was not researched.' }),
  // ---- evolution wireless G4 ----------------------------------------------------------------------------------------
  senTx({ id: 'sennheiser-sk100g4s', model: 'SK 100 G4-S', kind: 'bodypack', options: [PWR.std], ranges: G4_100_RANGES, windowMHz: 42, freqs: 1680, chPerBank: 12, userBanks: 1, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC2.g4100, caveat: 'Maximum 30 mW. Ranges include 1G8 (1785-1800 MHz). The pilot-tone frequency is not published. Occupied bandwidth is a Carson estimate (assumed).' }),
  senTx({ id: 'sennheiser-skm100g4s', model: 'SKM 100 G4-S', kind: 'handheld', options: [PWR.std], ranges: G4_100_RANGES, windowMHz: 42, freqs: 1680, chPerBank: 12, userBanks: 1, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC2.g4100, caveat: 'Maximum 30 mW. Ranges include 1G8 (1785-1800 MHz). Occupied bandwidth is a Carson estimate (assumed).' }),
  senRx({ id: 'sennheiser-em100g4', model: 'EM 100 G4', kind: 'receiver', uv: 2.5, ranges: G4_100_RANGES, windowMHz: 42, freqs: 1680, chPerBank: 12, userBanks: 1, acr: 65, im: 65, blk: 70, figConf: I, diversity: 'true',
    squelchOptions: { values: [5, 15, 25], names: ['Low', 'Middle', 'High'] },
    sources: SRC2.g4100, caveat: 'Under 2.5 uV (-99.0 dBm) for 52 dBA S/N; the rejection column order comes from garbled text (inferred). Noise figure derived (assumed).' }),
  senTx({ id: 'sennheiser-sk500g4', model: 'SK 500 G4', kind: 'bodypack', options: [PWR.low, PWR.std, PWR.high], ranges: G4_500_RANGES, rangesConf: I, windowMHz: 88, freqs: 3520, chPerBank: 32, userBanks: 6, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC2.g4500, caveat: '10 / 30 / 50 mW. The Bw range is printed as 526-698 MHz and read as 626-698 (inferred). Occupied bandwidth is a Carson estimate (assumed).' }),
  senTx({ id: 'sennheiser-skm500g4', model: 'SKM 500 G4', kind: 'handheld', options: [PWR.low, PWR.std, PWR.high], ranges: G4_500_RANGES, rangesConf: I, windowMHz: 88, freqs: 3520, chPerBank: 32, userBanks: 6, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC2.g4500, caveat: '10 / 30 / 50 mW. The Bw range is printed as 526-698 MHz and read as 626-698 (inferred). Occupied bandwidth is a Carson estimate (assumed).' }),
  senRx({ id: 'sennheiser-em300500g4', model: 'EM 300-500 G4', kind: 'receiver', uv: 2.5, ranges: G4_500_RANGES, rangesConf: I, windowMHz: 88, freqs: 3520, chPerBank: 32, userBanks: 6, acr: 75, im: 70, blk: 75, figConf: I, diversity: 'true',
    sources: SRC2.g4500, caveat: 'Under 2.5 uV (-99.0 dBm) for 52 dBA S/N; rejection column order inferred. No ew 300 G4 transmitter power was found, so only the receiver is listed for ew 300 G4. Bw range typo read as 626-698.' }),
  // ---- ew IEM G4 (one product; there is no separate 300 or 500 version) --------------------------------------------
  senTx({ id: 'sennheiser-sriemg4', model: 'SR IEM G4', kind: 'IEM transmitter', options: [PWR.low, PWR.std, PWR.high], ranges: G4_IEM_RANGES, windowMHz: 42, freqs: 1680, chPerBank: 16, userBanks: 6, devConf: S, powerConf: I, audioKhz: 15, ppm: 10,
    extra: { mpxPilotKhz: 19, pilotDeviationKhz: 5, antennaOutput: { connector: 'BNC', impedanceOhm: 50 } }, extraConf: { mpxPilotKhz: S, pilotDeviationKhz: S, antennaOutput: S },
    sources: SRC2.g4iem, caveat: '10 / 30 / 50 mW switchable; the data sheet front page says up to 30 mW (regulation dependent, inferred). 19 kHz pilot with +-5 kHz deviation.' }),
  senRx({ id: 'sennheiser-ekiemg4', model: 'EK IEM G4', kind: 'bodypack receiver', iem: true, uv: 4, typUv: 1.6, ranges: G4_IEM_RX_RANGES, windowMHz: 42, freqs: 1680, chPerBank: 16, userBanks: 6, acr: 65, im: 70, blk: 80, figConf: I, diversity: 'ratio', diversityConf: A,
    extra: { limiterRangeDb: { min: -18, max: -6 } }, extraConf: { limiterRangeDb: A },
    sources: SRC2.g4iem, caveat: 'Under 4 uV (-95 dBm), typically 1.6 uV (-103 dBm); adaptive diversity is mapped to ratio combining (assumed). The limiter range is assumed (the data sheet lists a limiter without figures here).' }),
  // ---- 3000 series (SK 3063, SKM 3072, SKP 3000; EM 3031 / EM 3032) and 5000 series ---------------------------------
  senTx({ id: 'sennheiser-sk3063', model: 'SK 3063', kind: 'bodypack', dev: 40, peak: 56, options: [PWR.std], ranges: SPAN_450_960, rangesConf: I, windowMHz: 24, windowConf: I, stepKhz: 5, stepConf: A, freqs: 32, factoryBanks: null, pilotSq: false, devConf: S, powerConf: A, audioKhz: 20, audioConf: A, ppm: 10, ppmConf: A,
    sources: SRC2.s3000, caveat: 'Power, tuning and stability not found; the 30 mW of the SKP 3000 and the receiver 450-960 MHz / 24 MHz window are assumed. Deviation +-40 / +-56 kHz.' }),
  senTx({ id: 'sennheiser-skm3072', model: 'SKM 3072', kind: 'handheld', dev: 40, peak: 56, options: [PWR.std], ranges: SPAN_450_960, rangesConf: I, windowMHz: 24, windowConf: I, stepKhz: 5, stepConf: A, freqs: 32, factoryBanks: null, pilotSq: false, devConf: S, powerConf: A, audioKhz: 20, audioConf: A, ppm: 10, ppmConf: A,
    sources: SRC2.s3000, caveat: 'Power, tuning and stability not found; the 30 mW of the SKP 3000 and the receiver 450-960 MHz / 24 MHz window are assumed. Deviation +-40 / +-56 kHz.' }),
  senTx({ id: 'sennheiser-skp3000', model: 'SKP 3000', kind: 'plug-on', dev: 40, peak: 56, options: [PWR.std], ranges: SERIES3000_SKP_RANGES, rangesConf: I, windowMHz: 36, stepKhz: 5, freqs: undefined, factoryBanks: null, chPerBank: 20, pilotSq: false, devConf: S, powerConf: S, audioKhz: 20, audioConf: A, ppm: 10,
    sources: SRC2.s3000, caveat: '30 mW, 36 MHz switching bandwidth, 5 kHz steps; the range list on the source page is mixed with the G2 ranges (inferred). Occupied bandwidth is a Carson estimate (assumed).' }),
  senRx({ id: 'sennheiser-em3031-3032', model: 'EM 3031 / EM 3032', kind: 'single / dual receiver', uv: 2, uvConf: A, criterion: '52 dBA S/N (assumed)', dev: 40, peak: 56, ranges: SPAN_450_960, windowMHz: 24, stepKhz: 5, stepConf: A, freqs: 32, factoryBanks: null, pilotSq: false, diversity: 'true', diversityConf: I,
    squelchOptions: { minUv: 0, maxUv: 100, unit: 'uV' }, bias: undefined,
    sources: SRC2.s3000, caveat: 'Sensitivity is not printed; 2 uV (-101 dBm) is a class value (assumed), a service note quoting 1 uV is unverified. RF squelch 0-100 uV adjustable; rejection figures not found.' }),
  senTx({ id: 'sennheiser-skm5000', model: 'SKM 5000', kind: 'handheld', dev: 40, peak: 56, options: [mwId(50, 'std-50mw', '50 mW')], ranges: SKM5000_RANGES, windowMHz: 24, stepKhz: 5, stepConf: A, freqs: 16, factoryBanks: null, pilotSq: false, devConf: S, powerConf: S, audioKhz: 18, audioConf: A, ppm: undefined,
    extra: { sensitivityAdjustSteps: { steps: 5, stepDb: 10 } }, extraConf: { sensitivityAdjustSteps: S },
    sources: SRC2.s5000, caveat: '50 mW, 24 MHz switching bandwidth, 16 frequencies. The receiver is the existing EM 3732-II preset; the SK 5212-II and SKM 5200 successors are covered by the SKM 5200-II preset.' }),
  // ---- Older IEM: SR 3254 / SR 3256 with EK 3253; SR 300 / 350 IEM G2 with EK 300 IEM G2 --------------------------------
  senTx({ id: 'sennheiser-sr3254', model: 'SR 3254', kind: 'IEM transmitter', options: [mwId(50, 'std-50mw', '50 mW (delivery setting)'), mwId(100, 'max-100mw', '100 mW (maximum)')], defaultPowerId: 'std-50mw', ranges: G2_RANGES, windowMHz: 36, stepKhz: 5, freqs: undefined, factoryBanks: 1, chPerBank: 16, userBanks: 1, devConf: S, powerConf: S, audioKhz: 15, audioConf: A, ppm: 10,
    extra: { mpxPilotKhz: 19, pilotDeviationKhz: 5 }, extraConf: { mpxPilotKhz: S, pilotDeviationKhz: S },
    sources: SRC2.sr3254, caveat: 'Maximum 100 mW, 50 mW +-2 dB on delivery. The SR 3256 is the twin-channel version.' }),
  senTx({ id: 'sennheiser-sr3256', model: 'SR 3256', kind: 'IEM transmitter (twin)', options: [mwId(50, 'std-50mw', '50 mW (delivery setting)'), mwId(100, 'max-100mw', '100 mW (maximum)')], defaultPowerId: 'std-50mw', ranges: G2_RANGES, windowMHz: 36, stepKhz: 5, freqs: undefined, factoryBanks: 1, chPerBank: 16, userBanks: 1, devConf: S, powerConf: S, audioKhz: 15, audioConf: A, ppm: 10,
    extra: { mpxPilotKhz: 19, pilotDeviationKhz: 5 }, extraConf: { mpxPilotKhz: S, pilotDeviationKhz: S },
    sources: SRC2.sr3254, caveat: 'Twin-channel version of the SR 3254, same figures. Maximum 100 mW, 50 mW +-2 dB on delivery.' }),
  senRx({ id: 'sennheiser-ek3253', model: 'EK 3253', kind: 'bodypack receiver', iem: true, uv: 1.5, uvConf: S, ranges: G2_RANGES, windowMHz: 36, stepKhz: 5, freqs: undefined, factoryBanks: 1, chPerBank: 16, userBanks: 1, diversity: 'none', diversityConf: A,
    squelchOptions: { min: 0, max: 25, steps: 4, unit: 'dBuV' }, squelchConf: I, pilotSq: false,
    sources: SRC2.sr3254, caveat: 'Typical 1.5 uV (-103.5 dBm) for 52 dBA S/N used as the planner value; diversity not stated (assumed non-diversity); rejection figures not read.' }),
  senTx({ id: 'sennheiser-sr300iemg2', model: 'SR 300 IEM G2', kind: 'IEM transmitter', options: [mwId(20, 'std-20mw', '20 mW')], ranges: G2_IEM_RANGES, windowMHz: 36, freqs: 1440, factoryBanks: 8, chPerBank: 12, userBanks: 1, devConf: S, powerConf: S, audioKhz: 15, audioConf: A, ppm: undefined,
    extra: { mpxPilotKhz: 19, pilotDeviationKhz: 4 }, extraConf: { mpxPilotKhz: S, pilotDeviationKhz: S },
    sources: SRC2.iemg2, caveat: '20 mW. G2 pilot deviation is +-4 kHz (+-5 kHz on the G3 and later).' }),
  senTx({ id: 'sennheiser-sr350iemg2', model: 'SR 350 IEM G2', kind: 'IEM transmitter (twin)', options: [mwId(100, 'high-100mw', '100 mW'), mwId(15, 'low-15mw', '15 mW')], defaultPowerId: 'high-100mw', ranges: G2_IEM_RANGES, windowMHz: 36, freqs: 1440, factoryBanks: 8, chPerBank: 12, userBanks: 1, devConf: S, powerConf: S, audioKhz: 15, audioConf: A, ppm: undefined,
    extra: { mpxPilotKhz: 19, pilotDeviationKhz: 4 }, extraConf: { mpxPilotKhz: S, pilotDeviationKhz: S },
    sources: SRC2.iemg2, caveat: '100 mW switchable to 15 mW. G2 pilot deviation is +-4 kHz.' }),
  senRx({ id: 'sennheiser-ek300iemg2', model: 'EK 300 IEM G2', kind: 'bodypack receiver', iem: true, uv: 2.5, ranges: G2_IEM_RANGES, windowMHz: 36, freqs: 1440, factoryBanks: 8, chPerBank: 12, userBanks: 1, acr: 70, im: 70, blk: 80, diversity: 'none',
    squelchOptions: { values: [5, 15, 25], names: ['Low', 'Middle', 'High'] },
    sources: SRC2.iemg2, caveat: 'Under 2.5 uV (-99.0 dBm) for 52 dBA S/N; non-diversity.' }),
  // ---- Shure PSM 900 and PSM 1000 -----------------------------------------------------------------------------------
  psmTx({ id: 'shure-p9t', model: 'PSM 900 P9T', ranges: PSM900_RANGES, windowMHz: 36, perBank: 20, sources: SRC2.psm900,
    caveat: '10 / 50 / 100 mW depending on region and band (two data sheet editions differ, inferred); tuning window 36-40 MHz (lower bound used); step size not published (25 kHz assumed). Companded, +-34 kHz at 1 kHz.' }),
  senRx({ id: 'shure-p9ra', mfr: 'Shure', model: 'PSM 900 P9RA', kind: 'bodypack receiver', iem: true, uv: 2.2, criterion: '20 dB SINAD', cnr: 10.2, ranges: PSM900_RANGES, windowMHz: 36, windowConf: I, stepKhz: 25, stepConf: A, freqs: undefined, factoryBanks: null, pilotSq: false,
    acr: 70, im: 70, blk: 80, diversity: 'none', diversityConf: A, squelchOptions: null, squelchDbm: -99.6, dev: 34, peak: 34, noAntenna: true,
    extra: { sinadDb: 20, squelchSinadDb: 22, squelchSinadToleranceDb: 3, volumeLimiterSteps: { min: 3, max: 9 }, imageRejectionDb: 90, activeRfGainDb: 31, compander: 'Audio Reference Companding', compatibleFrequenciesPerBand: 20 },
    extraConf: { sinadDb: S, squelchSinadDb: S, squelchSinadToleranceDb: S, volumeLimiterSteps: S, imageRejectionDb: S, activeRfGainDb: S, compander: S, compatibleFrequenciesPerBand: S }, uvConf: S, devConf: S,
    sources: SRC2.psm900, caveat: `${PSM_SINAD_NOTE} Squelch default 22 dB SINAD mapped to -99.6 dBm (assumed). Diversity not stated (assumed none).` }),
  psmTx({ id: 'shure-p10t', model: 'PSM 1000 P10T', ranges: PSM1000_RANGES, windowMHz: 72, perBank: 39, sources: SRC2.psm1000,
    caveat: '10 / 50 / 100 mW depending on region and band; tuning window 72-80 MHz (lower bound used); step size not published (25 kHz assumed). Shure lists the P10T as discontinued. Companded, +-34 kHz at 1 kHz.' }),
  senRx({ id: 'shure-p10r', mfr: 'Shure', model: 'PSM 1000 P10R+', kind: 'bodypack receiver', iem: true, uv: 2.2, criterion: '20 dB SINAD', cnr: 10.2, ranges: PSM1000_RANGES, windowMHz: 72, windowConf: I, stepKhz: 25, stepConf: A, freqs: undefined, factoryBanks: null, pilotSq: false,
    acr: 70, im: 70, blk: 80, diversity: 'none', diversityConf: A, squelchOptions: null, squelchDbm: -99.6, dev: 34, peak: 34, noAntenna: true,
    extra: { sinadDb: 20, squelchSinadDb: 22, squelchSinadToleranceDb: 3, volumeLimiterSteps: { min: 3, max: 9 }, imageRejectionDb: 90, activeRfGainDb: 31, compander: 'Audio Reference Companding', compatibleFrequenciesPerBand: 39 },
    extraConf: { sinadDb: S, squelchSinadDb: S, squelchSinadToleranceDb: S, volumeLimiterSteps: S, imageRejectionDb: S, activeRfGainDb: S, compander: S, compatibleFrequenciesPerBand: S }, uvConf: S, devConf: S,
    sources: SRC2.psm1000, caveat: `${PSM_SINAD_NOTE} Squelch default 22 dB SINAD mapped to -99.6 dBm (assumed). Diversity not stated (assumed none). The limiter and processing detail were not found.` }),
];

const FM_PRESET_LIST = [
  // ---- Sennheiser SKM 5200-II class handheld transmitter ----------------------------------------------------------
  {
    id: 'sennheiser-skm5200ii', label: 'Sennheiser SKM 5200-II class handheld (FM)', manufacturer: 'Sennheiser', model: 'SKM 5200-II', role: 'tx',
    params: {
      powerOptions: [
        { id: 'std-10mw', label: '10 mW', powerDbm: 10, lowIntermod: false },
        { id: 'loi-10mw', label: '10 mW low-intermod mode', powerDbm: 10, lowIntermod: true },
        { id: 'hi-50mw', label: '50 mW', powerDbm: 16.99, lowIntermod: false },
      ],
      defaultPowerOptionId: 'std-10mw',
      deviationKhz: 40, peakDeviationKhz: 56,
      occupiedBwKhz: 400,
      tuningStepKhz: 5,
      tuningWindows: [
        { id: 'L', label: 'L 470-638 MHz', fromMHz: 470, toMHz: 638 },
        { id: 'N-US', label: 'N-US 614-698 MHz', fromMHz: 614, toMHz: 698 },
        { id: 'N', label: 'N 614-798 MHz', fromMHz: 614, toMHz: 798 },
      ],
      switchingBandwidthMHz: 184,
      paConversionDb: 20,          // class-AB class value, standard mode
      lowIntermod: { available: true, extraConversionDb: 6, claimedExtraChannelsPct: 30 },
    },
    confidence: {
      powerOptions: S, defaultPowerOptionId: A, deviationKhz: I, peakDeviationKhz: I, occupiedBwKhz: A, tuningStepKhz: S, tuningWindows: S,
      switchingBandwidthMHz: S, paConversionDb: A, lowIntermod: A,
    },
    sources: ['TVTech trade report on the SKM 5200-II', 'Sennheiser SKM 5200 and EM 3732 manuals (original generation)', 'live-production.tv product listing'],
    caveat: 'Deviation is from the original SKM 5200 and assumed to carry over; occupied bandwidth and the size of the low-intermod benefit (about 30 % more channels is a trade-report claim) are assumed.',
  },
  // ---- Sennheiser EM 3732-II class receiver ------------------------------------------------------------------------
  {
    id: 'sennheiser-em3732ii', label: 'Sennheiser EM 3732-II class receiver (FM)', manufacturer: 'Sennheiser', model: 'EM 3732-II', role: 'rx',
    params: {
      sensitivityDbm: -99, thresholdSensitivityDbm: -102,
      channelBwKhz: 200, requiredCnrDb: 13, noiseFigureDb: 9,
      agcRangeDb: 65, p1dBDbm: -18, iip3Dbm: -8, maxInputDbm: -10, overloadHysteresisDb: 3, hotMarginDb: 10,
      squelch: { thresholdDbm: -92, hysteresisDb: 3 },
      diversityMode: 'true',
      typicalSensitivityUv: 1.5, typicalSensitivityDbm: -103.5,   // 1.5 uV typ. for 52 dBA S/N (EM 3732-II data sheet), -107 + 20 log10(1.5)
      deviationKhz: 40,
      tuningStepKhz: 5,
      tuningWindows: [
        { id: 'L', label: 'L 470-638 MHz', fromMHz: 470, toMHz: 638 },
        { id: 'N-US', label: 'N-US 614-698 MHz', fromMHz: 614, toMHz: 698 },
        { id: 'N', label: 'N 614-798 MHz', fromMHz: 614, toMHz: 798 },
      ],
      adjacentChannelRejectionDb: [{ offsetKhz: 400, db: 75 }, { offsetKhz: 800, db: 80 }],
      intermodRejectionMinDb: 80, blockingRejectionMinDb: 80,
    },
    confidence: {
      sensitivityDbm: A, thresholdSensitivityDbm: A, channelBwKhz: A, requiredCnrDb: I, noiseFigureDb: A,
      agcRangeDb: A, p1dBDbm: A, iip3Dbm: A, maxInputDbm: A, overloadHysteresisDb: A, hotMarginDb: A,
      typicalSensitivityUv: S, typicalSensitivityDbm: I, squelch: A, diversityMode: A, deviationKhz: I, tuningStepKhz: S, tuningWindows: S,
      adjacentChannelRejectionDb: S, intermodRejectionMinDb: S, blockingRejectionMinDb: S,
    },
    sources: ['Sennheiser SKM 5200 and EM 3732 manuals (original generation)', 'live-production.tv product listing'],
    caveat: 'The planner sensitivity stays a derived class value (kTB(200 kHz) + NF 9 dB + 13 dB CNR, assumed); the data sheet typical of 1.5 uV (-103.5 dBm) for 52 dBA S/N is stored as typicalSensitivityDbm. The 80 dB intermod and blocking figures are recorded but not mapped to an IIP3.',
  },
  // ---- Shure UR2 handheld transmitter ------------------------------------------------------------------------------
  {
    id: 'shure-ur2', label: 'Shure UR2 class handheld (FM)', manufacturer: 'Shure', model: 'UR2', role: 'tx',
    params: {
      powerOptions: [
        { id: 'std-10mw', label: '10 mW', powerDbm: 10, lowIntermod: false },
        { id: 'hi-50mw', label: '50 mW (band dependent)', powerDbm: 16.99, lowIntermod: false },
        { id: 'hi-100mw', label: '100 mW (band dependent)', powerDbm: 20, lowIntermod: false },
      ],
      defaultPowerOptionId: 'std-10mw',
      deviationKhz: 45, peakDeviationKhz: 45,
      occupiedBwKhz: 200,
      tuningStepKhz: 25,
      tuningWindows: [{ id: 'span', label: '518-865 MHz in 60 MHz windows', fromMHz: 518, toMHz: 865 }],
      tuningWindowMaxMHz: 60,
      paConversionDb: 20,
      lowIntermod: { available: false },
    },
    confidence: {
      powerOptions: A, defaultPowerOptionId: A, deviationKhz: S, peakDeviationKhz: A, occupiedBwKhz: A, tuningStepKhz: S, tuningWindows: S, tuningWindowMaxMHz: S,
      paConversionDb: A, lowIntermod: A,
    },
    sources: ['Shure UHF-R user guide (mirror)', 'Shure UHF-R specification sheet (retailer copy)'],
    caveat: 'The 10 / 50 / 100 mW choice depends on the band and which band gets which is uncertain; occupied bandwidth is not published (200 kHz assumed). 45 kHz is the quoted maximum deviation.',
  },
  // ---- Shure UR1 bodypack transmitter ------------------------------------------------------------------------------
  {
    id: 'shure-ur1', label: 'Shure UR1 class bodypack (FM)', manufacturer: 'Shure', model: 'UR1', role: 'tx',
    params: {
      powerOptions: [
        { id: 'std-10mw', label: '10 mW', powerDbm: 10, lowIntermod: false },
        { id: 'hi-50mw', label: '50 mW (band dependent)', powerDbm: 16.99, lowIntermod: false },
        { id: 'hi-100mw', label: '100 mW (band dependent)', powerDbm: 20, lowIntermod: false },
      ],
      defaultPowerOptionId: 'std-10mw',
      deviationKhz: 45, peakDeviationKhz: 45,
      occupiedBwKhz: 200,
      tuningStepKhz: 25,
      tuningWindows: [{ id: 'span', label: '518-865 MHz in 60 MHz windows', fromMHz: 518, toMHz: 865 }],
      tuningWindowMaxMHz: 60,
      paConversionDb: 20,
      lowIntermod: { available: false },
    },
    confidence: {
      powerOptions: A, defaultPowerOptionId: A, deviationKhz: S, peakDeviationKhz: A, occupiedBwKhz: A, tuningStepKhz: S, tuningWindows: S, tuningWindowMaxMHz: S,
      paConversionDb: A, lowIntermod: A,
    },
    sources: ['Shure UHF-R user guide (mirror)', 'Shure UHF-R specification sheet (retailer copy)'],
    caveat: 'The 10 / 50 / 100 mW choice depends on the band and which band gets which is uncertain; occupied bandwidth is not published (200 kHz assumed).',
  },
  // ---- Shure UR4D dual receiver ------------------------------------------------------------------------------------
  {
    id: 'shure-ur4d', label: 'Shure UR4D class dual receiver (FM)', manufacturer: 'Shure', model: 'UR4D', role: 'rx',
    params: {
      // Sensitivity -107 dBm at 12 dB SINAD (threshold) and -102 dBm at 30 dB SINAD (usable audio): planner value is the 30 dB SINAD one.
      sensitivityDbm: -102, thresholdSensitivityDbm: -107,
      channelBwKhz: 200, noiseFigureDb: 6, requiredCnrDb: 13,   // -102 - (-174 + 53.0 + 6) = 13.0 dB; at -107 the same receiver needs 8.0 dB (FM threshold)
      // Overload: rated input -95 to -30 dBm, absolute max -20 dBm, overload LED above -25 dBm.
      ratedInputRangeDbm: { min: -95, max: -30 },
      p1dBDbm: -25, maxInputDbm: -20, hotMarginDb: 5,           // hot from -30 dBm (top of the rated range)
      agcRangeDb: 72,                                            // sensitivity + 72 = -30 dBm: AGC ceiling at the rated top
      iip3Dbm: -15, overloadHysteresisDb: 3,
      squelch: { thresholdDbm: -100, hysteresisDb: 3 },          // noise squelch plus Tonekey; threshold not published
      diversityMode: 'switching',                                // MARCAD dual diversity (selects the better antenna)
      deviationKhz: 45,
      tuningStepKhz: 25,
      tuningWindows: [
        { id: 'span', label: '518-865 MHz in 60 MHz windows', fromMHz: 518, toMHz: 865 },
        { id: 'H4', label: 'H4 518-578 MHz', fromMHz: 518, toMHz: 578 },
        { id: 'J5a', label: 'J5 578-608 MHz', fromMHz: 578, toMHz: 608 },
        { id: 'J5b', label: 'J5 614-638 MHz', fromMHz: 614, toMHz: 638 },
        { id: 'L3', label: 'L3 638-698 MHz', fromMHz: 638, toMHz: 698 },
        { id: 'R9', label: 'R9 790-865 MHz', fromMHz: 790, toMHz: 865 },
      ],
      tuningWindowMaxMHz: 60,
      imageRejectionDb: 110, spuriousRejectionDb: 90,
      antennaInput: { connector: 'BNC', impedanceOhm: 50, dcBiasV: 12.2 },
      separationGuidanceM: 6,
    },
    confidence: {
      sensitivityDbm: I, thresholdSensitivityDbm: S, channelBwKhz: A, noiseFigureDb: A, requiredCnrDb: I,
      ratedInputRangeDbm: S, p1dBDbm: I, maxInputDbm: S, hotMarginDb: A, agcRangeDb: I, iip3Dbm: I, overloadHysteresisDb: A,
      squelch: A, diversityMode: A, deviationKhz: S, tuningStepKhz: S, tuningWindows: A, tuningWindowMaxMHz: S,
      imageRejectionDb: S, spuriousRejectionDb: S, antennaInput: S, separationGuidanceM: A,
    },
    sources: ['Shure UHF-R user guide (mirror)', 'Shure UHF-R specification sheet (retailer copy)', 'Shure UR4D+ product page'],
    caveat: 'The 30 dB SINAD figure is used as the planner sensitivity; band names and edges (H4, J5, L3, R9) are assumed, only the 518-865 MHz span and 60 MHz window are sourced. Noise figure, noise squelch threshold and the diversity mapping are assumed. Keep transmitters at least 6 m away (overload guidance, assumed).',
  },
  ...SENNHEISER_G3_2000,
  ...SENNHEISER_MORE,
];

// ---- Registry ------------------------------------------------------------------------------------------------------
export const FM_PRESETS = deepFreeze(Object.fromEntries(FM_PRESET_LIST.map((p) => [p.id, {
  ...p, illustrative: false, basedOnPublishedSpecs: true, disclaimer: FM_PRESET_DISCLAIMER,
}])));
export const FM_PRESET_IDS = Object.freeze(Object.keys(FM_PRESETS));
export const FM_TX_PRESET_IDS = Object.freeze(FM_PRESET_IDS.filter((id) => FM_PRESETS[id].role === 'tx'));
export const FM_RX_PRESET_IDS = Object.freeze(FM_PRESET_IDS.filter((id) => FM_PRESETS[id].role === 'rx'));

const RX_KEYS = ['sensitivityDbm', 'channelBwKhz', 'requiredCnrDb', 'noiseFigureDb', 'agcRangeDb', 'p1dBDbm', 'iip3Dbm', 'maxInputDbm', 'overloadHysteresisDb', 'hotMarginDb'];

/** Receiver presets in the RX_PRESETS shape (one per rx entry); rx-params.js merges these into RX_PRESETS. */
export const FM_RX_PRESETS = Object.freeze(Object.fromEntries(FM_RX_PRESET_IDS.map((id) => {
  const p = FM_PRESETS[id];
  const o = { id, label: `${p.label} (assumed figures)`, illustrative: true, fmPreset: true };
  for (const k of RX_KEYS) o[k] = p.params[k];
  return [id, Object.freeze(o)];
})));

/** listFmPresets({ role? }) -> array of presets (role 'tx' | 'rx'; omit for all), in definition order. */
export function listFmPresets({ role } = {}) {
  return FM_PRESET_IDS.map((id) => FM_PRESETS[id]).filter((p) => !role || p.role === role || p.role === 'system');
}

/** getFmPreset(id) -> preset or null. */
export const getFmPreset = (id) => FM_PRESETS[id] || null;

/** True when the named parameter of a preset is not 'sourced' (the UI must show an "assumed" badge for it). */
export function isAssumed(presetId, param) {
  const p = FM_PRESETS[presetId];
  return !p || (p.confidence[param] ?? 'assumed') !== 'sourced';
}

/** Tuning check: { inWindow, window: id | null, onGrid } for a carrier frequency (grid = tuningStepKhz from the window start). */
export function fmTuningCheck(presetId, freqMHz) {
  const p = FM_PRESETS[presetId];
  if (!p || !Array.isArray(p.params.tuningWindows)) return { inWindow: false, window: null, onGrid: false };
  const w = p.params.tuningWindows.find((x) => freqMHz >= x.fromMHz - 1e-9 && freqMHz <= x.toMHz + 1e-9);
  if (!w) return { inWindow: false, window: null, onGrid: false };
  const steps = ((freqMHz - w.fromMHz) * 1000) / p.params.tuningStepKhz;
  return { inWindow: true, window: w.id, onGrid: Math.abs(steps - Math.round(steps)) < 1e-6 };
}

/** Planner noise floor of an rx entry at its own bandwidth and NF, dBm (kTB + NF). */
export function fmNoiseFloorDbm(presetId) {
  const p = FM_PRESETS[presetId];
  return p && p.role === 'rx' ? noiseDbm(p.params.channelBwKhz, p.params.noiseFigureDb) : NaN;
}

/** Power option of a tx entry: by id, else the default. null for unknown preset. */
export function fmPowerOption(presetId, optionId) {
  const p = FM_PRESETS[presetId];
  if (!p || p.role !== 'tx') return null;
  return p.params.powerOptions.find((o) => o.id === optionId) || p.params.powerOptions.find((o) => o.id === p.params.defaultPowerOptionId) || p.params.powerOptions[0];
}

/** Extra transmitter-side reverse-IM conversion loss in dB (>= 0) for a tx entry in low-intermod mode; 0 otherwise. */
export function fmLowIntermodDb(presetId, lowIntermod) {
  const p = FM_PRESETS[presetId];
  if (!lowIntermod || !p || p.role !== 'tx' || !p.params.lowIntermod || !p.params.lowIntermod.available) return 0;
  return p.params.lowIntermod.extraConversionDb;
}

/**
 * applyFmPreset(link, presetId, { powerOptionId?, lowIntermod? }) -> a NEW link (input untouched); unknown id returns the link unchanged.
 *  tx entry: tx.fmPreset, tx.powerDbm (the chosen option), tx.lowIntermod (only where the model offers it).
 *  rx entry: rx.rxPreset (so overload, cascade bandwidth and required SNR read the preset), rx.sensitivityDbm, rx.squelch (enabled),
 *            rx.overload cleared (preset values apply) and diversity enabled with the preset mode.
 */
export function applyFmPreset(link, presetId, opts = {}) {
  const p = FM_PRESETS[presetId];
  const out = JSON.parse(JSON.stringify(link));
  if (!p) return out;
  if (p.role === 'tx') {
    const o = fmPowerOption(presetId, opts.powerOptionId);
    out.tx.fmPreset = presetId;
    out.tx.powerDbm = o.powerDbm;
    const li = opts.lowIntermod !== undefined ? !!opts.lowIntermod : !!o.lowIntermod;
    if (p.params.lowIntermod && p.params.lowIntermod.available) out.tx.lowIntermod = li; else delete out.tx.lowIntermod;
  } else if (p.role === 'rx') {
    out.rx.rxPreset = presetId;
    out.rx.sensitivityDbm = p.params.sensitivityDbm;
    delete out.rx.requiredSnrDb;
    out.rx.squelch = { enabled: true, thresholdDbm: p.params.squelch.thresholdDbm, hysteresisDb: p.params.squelch.hysteresisDb };
    out.rx.overload = {};
    if (out.rx.diversity) {
      if (p.params.diversityMode === 'none') out.rx.diversity.enabled = false;   // non-diversity receiver
      else { out.rx.diversity.enabled = true; out.rx.diversity.mode = p.params.diversityMode; }
    }
  }
  return out;
}
