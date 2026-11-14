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
function senTx(o) {
  const peak = 48;
  return {
    id: o.id, label: `Sennheiser ${o.model} class ${o.kind} (FM)`, manufacturer: 'Sennheiser', model: o.model, role: 'tx',
    params: {
      powerOptions: o.options, defaultPowerOptionId: o.options.length > 1 ? 'std-30mw' : o.options[0].id,
      deviationKhz: 24, peakDeviationKhz: peak, audioBwKhz: o.audioKhz,
      occupiedBwKhz: 2 * (peak + o.audioKhz),     // Carson at peak deviation, ASSUMED (not published)
      tuningStepKhz: 25, tuningWindows: o.ranges, tuningWindowMaxMHz: o.windowMHz, frequencies: o.freqs,
      factoryBanks: 20, channelsPerBank: o.chPerBank, userBanks: o.userBanks, stabilityPpm: o.ppm,
      pilotSquelchSwitchable: true,
      paConversionDb: 20, lowIntermod: { available: false },
      ...(o.extra || {}),
    },
    confidence: {
      powerOptions: o.powerConf, defaultPowerOptionId: A, deviationKhz: o.devConf, peakDeviationKhz: o.devConf, audioBwKhz: S,
      occupiedBwKhz: A, tuningStepKhz: S, tuningWindows: o.rangesConf || S, tuningWindowMaxMHz: S, frequencies: S,
      factoryBanks: S, channelsPerBank: S, userBanks: o.userBanksConf || S, stabilityPpm: S, pilotSquelchSwitchable: S,
      paConversionDb: A, lowIntermod: A, ...(o.extraConf || {}),
    },
    sources: o.sources, caveat: o.caveat,
  };
}

// Receiver entry. o: { id, model, kind, uv, typUv?, ranges, windowMHz, freqs, chPerBank, userBanks, acr, im, blk, diversity, ... }
function senRx(o) {
  const sens = uvToDbm(o.uv);
  const nf = Math.round(sens + 120.99 - 13);    // NF = sensitivity - kTB(200 kHz) - 13 dB CNR
  const iem = o.iem === true;
  return {
    id: o.id, label: `Sennheiser ${o.model} class ${o.kind} (FM)`, manufacturer: 'Sennheiser', model: o.model, role: 'rx',
    params: {
      sensitivityDbm: sens, sensitivityUv: o.uv, sensitivityCriterion: '52 dBA rms S/N',
      ...(o.typUv ? { typicalSensitivityDbm: uvToDbm(o.typUv), typicalSensitivityUv: o.typUv } : {}),
      channelBwKhz: 200, requiredCnrDb: 13, noiseFigureDb: nf,
      agcRangeDb: iem ? 60 : 65, p1dBDbm: iem ? -22 : -18, iip3Dbm: iem ? -12 : -8, maxInputDbm: iem ? -15 : -10, overloadHysteresisDb: 3, hotMarginDb: 10,
      squelch: { thresholdDbm: dbuvToDbm(SQUELCH_DEFAULT_DBUV), hysteresisDb: 3 },
      squelchOptionsDbuv: o.squelchOptions || { min: 5, max: 25, stepDb: 2 },
      diversityMode: o.diversity, deviationKhz: 24, peakDeviationKhz: 48,
      tuningStepKhz: 25, tuningWindows: o.ranges, tuningWindowMaxMHz: o.windowMHz, frequencies: o.freqs,
      factoryBanks: 20, channelsPerBank: o.chPerBank, userBanks: o.userBanks,
      adjacentChannelRejectionMinDb: o.acr, intermodRejectionMinDb: o.im, blockingRejectionMinDb: o.blk,
      pilotSquelchSwitchable: true, antennaInput: { connector: 'BNC', impedanceOhm: 50, ...(o.bias ? { dcBiasV: o.bias } : {}) },
      ...(o.extra || {}),
    },
    confidence: {
      sensitivityDbm: I, sensitivityUv: o.uvConf || S, sensitivityCriterion: S, ...(o.typUv ? { typicalSensitivityDbm: I, typicalSensitivityUv: S } : {}),
      channelBwKhz: A, requiredCnrDb: A, noiseFigureDb: I,
      agcRangeDb: A, p1dBDbm: A, iip3Dbm: A, maxInputDbm: A, overloadHysteresisDb: A, hotMarginDb: A,
      squelch: A, squelchOptionsDbuv: o.squelchConf || S, diversityMode: o.diversityConf || S, deviationKhz: o.devConf || S, peakDeviationKhz: o.devConf || S,
      tuningStepKhz: S, tuningWindows: o.rangesConf || S, tuningWindowMaxMHz: S, frequencies: S,
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
    sources: SRC_G3[2000], caveat: '10 / 30 / 50 mW. Occupied bandwidth is a Carson estimate (assumed). There is no SK 2050.' }),
  senTx({ id: 'sennheiser-skm2000', model: 'SKM 2000', kind: 'handheld', options: [PWR.low, PWR.std, PWR.high], ranges: S2000_RANGES, windowMHz: 75, freqs: 3000, chPerBank: 64, userBanks: 6, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC_G3[2000], caveat: '10 / 30 / 50 mW. Occupied bandwidth is a Carson estimate (assumed). There is no SKM 2050.' }),
  senTx({ id: 'sennheiser-skp2000', model: 'SKP 2000', kind: 'plug-on', options: [PWR.low, PWR.std, PWR.high], ranges: S2000_RANGES, windowMHz: 75, freqs: 3000, chPerBank: 64, userBanks: 6, devConf: S, powerConf: S, audioKhz: 18, ppm: 15,
    sources: SRC_G3[2000], caveat: '10 / 30 / 50 mW. Occupied bandwidth is a Carson estimate (assumed).' }),
  senTx({ id: 'sennheiser-sr2050iem', model: 'SR 2050 IEM', kind: 'IEM transmitter (dual stereo)', options: [PWR.low, PWR.std, PWR.high, PWR.xp], ranges: S2000_IEM_RANGES, windowMHz: 75, freqs: 3000, chPerBank: 32, userBanks: 6, devConf: S, powerConf: I, audioKhz: 15, ppm: 10,
    extra: { mpxPilotKhz: 19, pilotDeviationKhz: 5, antennaOutput: { connector: 'BNC', impedanceOhm: 50 } },
    extraConf: { mpxPilotKhz: S, pilotDeviationKhz: S, antennaOutput: S },
    sources: SRC_G3['2000.5'], caveat: '10 / 30 / 50 mW; the 100 mW option belongs to the SR 2050XP version and is flagged assumed. 19 kHz pilot with +-5 kHz deviation is sourced.' }),
  senRx({ id: 'sennheiser-ek2000iem', model: 'EK 2000 IEM', kind: 'bodypack receiver', iem: true, uv: 4, typUv: 1.6, ranges: S2000_IEM_RANGES, windowMHz: 75, freqs: 3000, chPerBank: 32, userBanks: 6, acr: 80, im: 78, blk: 80, diversity: 'ratio', diversityConf: A,
    sources: SRC_G3['2000.5'], caveat: 'Under 4 uV (-95 dBm), typically 1.6 uV (-103 dBm) for 52 dBA S/N; the planner uses the guaranteed figure. Adaptive diversity is mapped to ratio combining (assumed).' }),
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
      squelch: A, diversityMode: A, deviationKhz: I, tuningStepKhz: S, tuningWindows: S,
      adjacentChannelRejectionDb: S, intermodRejectionMinDb: S, blockingRejectionMinDb: S,
    },
    sources: ['Sennheiser SKM 5200 and EM 3732 manuals (original generation)', 'live-production.tv product listing'],
    caveat: 'Sensitivity is not published: derived here as kTB(200 kHz) + NF 9 dB + 13 dB CNR (FM threshold plus margin), all assumed. The 80 dB intermod and blocking rejection figures are recorded but not mapped to an IIP3.',
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
    if (out.rx.diversity) { out.rx.diversity.enabled = true; out.rx.diversity.mode = p.params.diversityMode; }
  }
  return out;
}
