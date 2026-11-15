// Spectrum map model (item 21, docs/research/SPECTRUM-MAP.md): a compressed frequency axis from VHF to 5.8 GHz, a band catalogue, TV channel lists,
// DAB blocks, Wi-Fi channels, an ILLUSTRATIVE occupancy generator, a simulated noise floor and the frequencies used by the project. Pure functions.
// Imports only rx-params.js (the external noise model).
//
// Confidence flags on band entries: S = a definition or a figure read from a page, I = recalled from regulation and consistent with other sources
// but not read from the primary page, U = unverified or likely to have changed. Regulator figures are mostly I: confirm on the regulator page before
// showing as fact (the list is in the research doc section 6). NOTHING here is real occupancy data: simulatedOccupancy is a seeded illustration.
//
// Axis: 15 kept segments (research section 5, rows A to M), each linear in MHz with its own px per MHz, separated by a break glyph of BREAK_PX
// pixels where frequencies are removed. freqToX / xToFreq are exact inverses inside a segment.

import { externalNoiseFigureDb } from './rx-params.js';

export const BREAK_PX = 14;
/** The 15 kept segments, left to right. px = (endMHz - startMHz) x pxPerMHz. */
export const AXIS_SEGMENTS = Object.freeze([
  { id: 'A', startMHz: 87.5, endMHz: 108, pxPerMHz: 3, label: 'FM broadcast' },
  { id: 'B', startMHz: 108, endMHz: 137, pxPerMHz: 1.5, label: 'Airband' },
  { id: 'C', startMHz: 169, endMHz: 240, pxPerMHz: 5, label: 'VHF mics, band III, DAB' },
  { id: 'D', startMHz: 430, endMHz: 450, pxPerMHz: 4, label: '433 ISM, PMR446' },
  { id: 'E', startMHz: 470, endMHz: 698, pxPerMHz: 4.2, label: 'UHF TV and PMSE 470-698' },
  { id: 'F', startMHz: 698, endMHz: 790, pxPerMHz: 2, label: '700 MHz mobile' },
  { id: 'G1', startMHz: 791, endMHz: 863, pxPerMHz: 3.5, label: '800 MHz band' },
  { id: 'G2', startMHz: 863, endMHz: 870, pxPerMHz: 10, label: '863-865 audio, 868 SRD' },
  { id: 'H', startMHz: 880, endMHz: 960, pxPerMHz: 3, label: 'GSM 900, 902-928 ISM' },
  { id: 'I', startMHz: 1164, endMHz: 1300, pxPerMHz: 0.7, label: 'L5, L2, 23 cm' },
  { id: 'L1', startMHz: 1559, endMHz: 1610, pxPerMHz: 1.5, label: 'GNSS L1' },
  { id: 'J', startMHz: 1770, endMHz: 1820, pxPerMHz: 6, label: 'LTE B3 gap 1785-1805' },
  { id: 'K', startMHz: 1875, endMHz: 1935, pxPerMHz: 4, label: 'DECT' },
  { id: 'L', startMHz: 2400, endMHz: 2500, pxPerMHz: 4, label: 'Wi-Fi 2.4 GHz, Bluetooth' },
  { id: 'M', startMHz: 5725, endMHz: 5875, pxPerMHz: 2, label: '5.8 GHz ISM, Wi-Fi 149-177' },
]);

/** axisLayout() -> { segments: [{ ...segment, x0, x1, widthPx }], breaks: [{ x0, x1, fromMHz, toMHz }], totalPx } (x from 0). */
export function axisLayout() {
  let x = 0;
  const segments = [], breaks = [];
  AXIS_SEGMENTS.forEach((s, i) => {
    const w = (s.endMHz - s.startMHz) * s.pxPerMHz;
    segments.push({ ...s, x0: x, x1: x + w, widthPx: w });
    x += w;
    if (i < AXIS_SEGMENTS.length - 1) { breaks.push({ x0: x, x1: x + BREAK_PX, fromMHz: s.endMHz, toMHz: AXIS_SEGMENTS[i + 1].startMHz }); x += BREAK_PX; }
  });
  return { segments, breaks, totalPx: x };
}
const LAYOUT = axisLayout();
export const AXIS_TOTAL_PX = LAYOUT.totalPx;

/**
 * freqToX(freqMHz, { clamp = false }) -> x in px, or null when the frequency is in a removed gap (or outside the axis). With clamp true a frequency in a
 * gap returns the centre of the break glyph that replaces it (the nearest end for a frequency outside the whole axis).
 */
export function freqToX(freqMHz, { clamp = false } = {}) {
  if (!Number.isFinite(freqMHz)) return null;
  for (const s of LAYOUT.segments) if (freqMHz >= s.startMHz && freqMHz <= s.endMHz) return s.x0 + (freqMHz - s.startMHz) * s.pxPerMHz;
  if (!clamp) return null;
  if (freqMHz < LAYOUT.segments[0].startMHz) return 0;
  if (freqMHz > LAYOUT.segments[LAYOUT.segments.length - 1].endMHz) return LAYOUT.totalPx;
  const b = LAYOUT.breaks.find((k) => freqMHz > k.fromMHz && freqMHz < k.toMHz);
  return b ? (b.x0 + b.x1) / 2 : null;
}
/** xToFreq(x) -> MHz, or null when x lies on a break glyph or outside the axis. Exact inverse of freqToX inside a segment. */
export function xToFreq(x) {
  if (!Number.isFinite(x) || x < 0 || x > LAYOUT.totalPx) return null;
  for (const s of LAYOUT.segments) if (x >= s.x0 && x <= s.x1) return s.startMHz + (x - s.x0) / s.pxPerMHz;
  return null;
}
/** segmentAt(freqMHz) -> the segment id ('A'...'M') containing the frequency, or null. */
export const segmentAt = (freqMHz) => { const s = AXIS_SEGMENTS.find((q) => freqMHz >= q.startMHz && freqMHz <= q.endMHz); return s ? s.id : null; };

// ------------------------------------------------------------------------------------------------ band catalogue
// region: 'uk' | 'eu' | 'us' | 'au' | 'any'. group: 'pmse' | 'tv' | 'broadcast' | 'srd' | 'mobile' | 'wifi' | 'other'.
const B = (id, label, loMHz, hiMHz, group, region, flag, note = '') => Object.freeze({ id, label, loMHz, hiMHz, group, region, flag, note });
export const BAND_CATALOGUE = Object.freeze([
  B('vhf-uk-exempt', 'VHF mics and IEM 173.7-175.1 (UK, 10 mW)', 173.7, 175.1, 'pmse', 'uk', 'I', 'Licence-exempt, IR 2030 family.'),
  B('vhf-pmse', 'VHF audio PMSE 174.5-209', 174.5, 209, 'pmse', 'uk', 'U', 'Licensed; approximate.'),
  B('uhf-pmse-470-606', 'UHF PMSE / DTT 470-606', 470, 606, 'pmse', 'uk', 'I', 'Main UHF mic and IEM spectrum, interleaved with DTT, licensed per channel.'),
  B('uhf-ch38', 'Channel 38 606-614 (UK shared with radio astronomy)', 606, 614, 'pmse', 'uk', 'I', 'UK-specific; mics and IEM under licence.'),
  B('uhf-pmse-614-694', 'UHF PMSE / DTT 614-694', 614, 694, 'pmse', 'uk', 'I'),
  B('uhf-us-470-608', 'US TV ch 14-36 mics 470-608', 470, 608, 'pmse', 'us', 'I', 'Part 74 and Part 15.236 after the repack.'),
  B('us-ch37', 'US channel 37 608-614 (radio astronomy, protected)', 608, 614, 'other', 'us', 'I', 'Never available for mics.'),
  B('us-600-guard', 'US 600 MHz guard band 614-616', 614, 616, 'pmse', 'us', 'I'),
  B('us-600-gap', 'US 600 MHz duplex gap 653-663', 653, 663, 'pmse', 'us', 'I'),
  B('eu-694-703', '694-703 (EU PMSE in many states)', 694, 703, 'pmse', 'eu', 'I', 'UK PMSE status unverified.'),
  B('mobile-700', '700 MHz mobile (no mics)', 703, 788, 'mobile', 'any', 'I', 'Duplex gap 733-758.'),
  B('lte-800-dl', 'LTE 800 downlink 791-821', 791, 821, 'mobile', 'eu', 'S'),
  B('pmse-823-832', '823-832 duplex gap, audio PMSE', 823, 832, 'pmse', 'eu', 'I', 'UK exempt split unverified.'),
  B('lte-800-ul', 'LTE 800 uplink 832-862', 832, 862, 'mobile', 'eu', 'S'),
  B('audio-863-865', '863-865 wireless audio (10 mW, licence-exempt)', 863, 865, 'pmse', 'eu', 'I', 'EN 300 422 / EN 301 357.'),
  B('srd-868', '868 SRD', 868, 868.6, 'srd', 'eu', 'I'),
  B('gsm-900', 'GSM 900 uplink 880-915 and downlink 925-960', 880, 960, 'mobile', 'any', 'I'),
  B('ism-902', 'ISM 902-928 (Americas)', 902, 928, 'srd', 'us', 'S'),
  B('us-lpas-941', 'US Part 74 LPAS 941.5-944 and 952.85-959.85', 941.5, 959.85, 'pmse', 'us', 'S'),
  B('pmse-1785', 'Audio PMSE 1785-1805 (LTE B3 gap)', 1785, 1805, 'pmse', 'eu', 'I'),
  B('dect-eu', 'DECT 1880-1900', 1880, 1900, 'srd', 'eu', 'S'),
  B('dect-us', 'DECT 6.0 1920-1930', 1920, 1930, 'srd', 'us', 'I'),
  B('ism-433', '433 ISM SRD 433.05-434.79 (10 mW)', 433.05, 434.79, 'srd', 'eu', 'I'),
  B('pmr446', 'PMR446 446.0-446.2 (0.5 W ERP)', 446, 446.2, 'srd', 'eu', 'I', '8 analogue channels at 12.5 kHz (446.00625 + 0.0125 (n - 1)), 16 digital at 6.25 kHz.'),
  B('wifi-24', 'Wi-Fi / Bluetooth 2400-2483.5 (100 mW EIRP)', 2400, 2483.5, 'wifi', 'any', 'I'),
  B('ism-58', '5.8 GHz ISM / Wi-Fi 5725-5875', 5725, 5875, 'wifi', 'any', 'I', 'UK upper edge 5850 or 5875 unverified.'),
]);
/** bandsAt(freqMHz, region?) -> catalogue entries containing the frequency (region 'any' entries always match). */
export const bandsAt = (freqMHz, region) => BAND_CATALOGUE.filter((b) => freqMHz >= b.loMHz && freqMHz <= b.hiMHz && (!region || b.region === 'any' || b.region === region));

/** The strip above the axis for context bands (AM, FM, DAB): { id, label, loMHz, hiMHz, flag }. AM is below the axis and is label-only. */
export const STRIP_BANDS = Object.freeze([
  Object.freeze({ id: 'lw', label: 'LW 0.1485-0.2835', loMHz: 0.1485, hiMHz: 0.2835, flag: 'S' }),
  Object.freeze({ id: 'mw', label: 'MW AM 0.531-1.602 (EU), 0.535-1.705 (US)', loMHz: 0.531, hiMHz: 1.705, flag: 'S' }),
  Object.freeze({ id: 'fm', label: 'FM 87.5-108', loMHz: 87.5, hiMHz: 108, flag: 'S' }),
  Object.freeze({ id: 'dab3', label: 'DAB band III 174-240', loMHz: 174, hiMHz: 240, flag: 'S' }),
]);

// ------------------------------------------------------------------------------------------------ DAB, Wi-Fi, PMR446
// DAB band III blocks (S): pitch 1.712 MHz inside a channel number, occupied 1.536 MHz. First block A of each number, then offsets.
const DAB_A = { 5: 174.928, 6: 181.936, 7: 188.928, 8: 195.936, 9: 202.928, 10: 209.936, 11: 216.928, 12: 223.936, 13: 230.784 };
const DAB_OFFSETS = (n) => (n === 13 ? [0, 1.712, 3.424, 4.992, 6.704, 8.416] : [0, 1.712, 3.424, 5.136]);
/** dabBlocks() -> [{ id: '5A', centreMHz, loMHz, hiMHz }] for 5A ... 13F (occupied width 1.536 MHz). */
export function dabBlocks() {
  const out = [];
  for (const n of Object.keys(DAB_A).map(Number)) DAB_OFFSETS(n).forEach((o, i) => { const c = DAB_A[n] + o; out.push({ id: `${n}${'ABCDEF'[i]}`, centreMHz: c, loMHz: c - 0.768, hiMHz: c + 0.768 }); });
  return out;
}
/** wifi24Channels() -> channels 1-14: centre 2407 + 5 n (n 1-13), 14 = 2484; 20 MHz wide. */
export const wifi24Channels = () => Array.from({ length: 14 }, (_, i) => { const n = i + 1, c = n === 14 ? 2484 : 2407 + 5 * n; return { n, centreMHz: c, loMHz: c - 10, hiMHz: c + 10 }; });
/** wifi5Channels() -> the 20 MHz channels 149-177 in the 5.8 GHz segment (centre 5000 + 5 n): 149, 153, ... 177. */
export const wifi5Channels = () => { const out = []; for (let n = 149; n <= 177; n += 4) out.push({ n, centreMHz: 5000 + 5 * n, loMHz: 5000 + 5 * n - 10, hiMHz: 5000 + 5 * n + 10 }); return out; };
/** pmr446Channels(digital = false) -> 8 analogue channels at 12.5 kHz from 446.00625, or 16 digital at 6.25 kHz from 446.003125. */
export const pmr446Channels = (digital = false) => Array.from({ length: digital ? 16 : 8 }, (_, i) => ({ n: i + 1, centreMHz: digital ? 446.003125 + 0.00625 * i : 446.00625 + 0.0125 * i }));

// ------------------------------------------------------------------------------------------------ TV channels
export const TV_WIDTHS_MHZ = Object.freeze([6, 8]);
export const DEFAULT_TV_WIDTH_MHZ = 8;
/** tvWidthOf(scene) -> 6 or 8: the scene field `tvChannelWidthMHz` (optional, default 8, anything else gives 8). */
export const tvWidthOf = (scene) => (scene && scene.tvChannelWidthMHz === 6 ? 6 : DEFAULT_TV_WIDTH_MHZ);
/**
 * tvChannelList(widthMHz = 8) -> [{ n, loMHz, hiMHz, centreMHz, status }].
 *  8 MHz (Europe, UK, Australia): channels 21-69, lo = 470 + 8 (n - 21); status 'dtt' for 21-48 (UK DTT), 'eu-only' for 49-60, 'cleared' for 61-69.
 *  6 MHz (North America): channels 14-36 (lo = 470 + 6 (n - 14)), 37 = 608-614 (status 'protected'), 38-51 (lo = 614 + 6 (n - 38), 'legacy-600').
 */
export function tvChannelList(widthMHz = DEFAULT_TV_WIDTH_MHZ) {
  const out = [];
  if (widthMHz === 6) {
    for (let n = 14; n <= 51; n++) {
      const lo = n <= 36 ? 470 + 6 * (n - 14) : n === 37 ? 608 : 614 + 6 * (n - 38);
      out.push({ n, loMHz: lo, hiMHz: lo + 6, centreMHz: lo + 3, status: n <= 36 ? 'tv' : n === 37 ? 'protected' : 'legacy-600' });
    }
  } else {
    for (let n = 21; n <= 69; n++) { const lo = 470 + 8 * (n - 21); out.push({ n, loMHz: lo, hiMHz: lo + 8, centreMHz: lo + 4, status: n <= 48 ? 'dtt' : n <= 60 ? 'eu-only' : 'cleared' }); }
  }
  return out;
}
/** tvChannelOf(freqMHz, widthMHz = 8) -> the channel containing the frequency (lo inclusive, hi exclusive) or null. */
export const tvChannelOf = (freqMHz, widthMHz = DEFAULT_TV_WIDTH_MHZ) => tvChannelList(widthMHz).find((c) => freqMHz >= c.loMHz && freqMHz < c.hiMHz) || null;

// ------------------------------------------------------------------------------------------------ illustrative occupancy
export const OCCUPANCY_SETTINGS = Object.freeze({
  'uk-city': { width: 8, from: 21, to: 48, lo: 8, hi: 10, free: [38], flag: 'I' },
  'uk-suburban': { width: 8, from: 21, to: 48, lo: 6, hi: 8, free: [38], flag: 'I' },
  'uk-rural': { width: 8, from: 21, to: 48, lo: 5, hi: 7, free: [38], flag: 'I' },
  'us-top10': { width: 6, from: 14, to: 36, fracLo: 0.7, fracHi: 0.85, flag: 'U' },
  'us-mid': { width: 6, from: 14, to: 36, fracLo: 0.4, fracHi: 0.6, flag: 'U' },
  'us-rural': { width: 6, from: 14, to: 36, fracLo: 0.15, fracHi: 0.3, flag: 'U' },
});
function rng(seed) { let t = (seed >>> 0) + 0x6D2B79F5; return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; };
/** hashSeed(text) -> unsigned 32-bit seed (FNV-1a), for a venue name or region. */
export function hashSeed(text) { let h = 2166136261; for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
/**
 * simulatedOccupancy(setting, seed) -> { setting, illustrative: true, flag, channels: [{ n, loMHz, hiMHz, occupied, status }], occupiedCount }.
 * ILLUSTRATIVE and deterministic: the same setting and seed give the same channels. UK settings occupy lo..hi channels of 21-48 (channel 38 always free,
 * clustered towards 22-34 for the main transmitter group), US settings occupy a fraction of 14-36 (channel 37 is protected and never occupied by TV).
 */
export function simulatedOccupancy(setting = 'uk-city', seed = 1) {
  const cfg = OCCUPANCY_SETTINGS[setting];
  if (!cfg) return null;
  const rnd = rng(typeof seed === 'string' ? hashSeed(seed) : seed);
  const list = tvChannelList(cfg.width).filter((c) => c.n >= cfg.from && c.n <= cfg.to);
  const eligible = list.filter((c) => !(cfg.free || []).includes(c.n));
  const count = cfg.lo !== undefined ? cfg.lo + Math.floor(rnd() * (cfg.hi - cfg.lo + 1)) : Math.round(list.length * (cfg.fracLo + rnd() * (cfg.fracHi - cfg.fracLo)));
  // weight: UK channels 22-34 are drawn first (clustered main group), others fall back to a shuffled remainder
  const pool = eligible.map((c) => ({ c, w: cfg.width === 8 && c.n >= 22 && c.n <= 34 ? 3 : 1, k: rnd() }));
  pool.sort((a, b) => b.k * b.w - a.k * a.w);
  const chosen = new Set(pool.slice(0, Math.min(count, pool.length)).map((p) => p.c.n));
  const channels = list.map((c) => ({ ...c, occupied: chosen.has(c.n), status: c.n === 37 && cfg.width === 6 ? 'protected' : c.status }));
  return { setting, seed, illustrative: true, flag: cfg.flag, channels, occupiedCount: chosen.size };
}

// ------------------------------------------------------------------------------------------------ simulated noise floor
/**
 * simulatedNoiseFloor({ environment = 'quiet', bwKHz = 200, freqsMHz, seed }) -> [{ freqMHz, x, dbm }] the thermal floor kTB plus the external noise figure of the
 * environment ('quiet' | 'outdoor' | 'urban' | 'noisy-venue', rx-params.js) in bwKHz: dBm = -174 + 10 log10(bw Hz) + NF_ext(f), plus a deterministic +-0.5 dB texture from
 * the seed so a drawn trace is not a ruler. Default sample points: every 5 px along the axis. ILLUSTRATIVE (no measurement).
 */
export function simulatedNoiseFloor({ environment = 'quiet', bwKHz = 200, freqsMHz, seed = 1 } = {}) {
  const pts = Array.isArray(freqsMHz) ? freqsMHz : (() => { const a = []; for (let x = 0; x <= LAYOUT.totalPx; x += 5) { const f = xToFreq(x); if (f !== null) a.push(f); } return a; })();
  const rnd = rng(typeof seed === 'string' ? hashSeed(seed) : seed);
  const kTB = -174 + 10 * Math.log10(bwKHz * 1000);
  return pts.map((f) => ({ freqMHz: f, x: freqToX(f), dbm: kTB + externalNoiseFigureDb(environment, f) + (rnd() - 0.5) }));
}

// ------------------------------------------------------------------------------------------------ TV carrier raising the floor
/**
 * ASSUMED (flag U, illustrative): a digital TV block that is on air arrives at a venue receiver at about TV_BLOCK_DBM total power across the block
 * (a moderate field, roughly 50 dB above kTB over the block), spread flat over the occupied bandwidth (7.6 MHz in an 8 MHz channel, 5.38 MHz in a
 * 6 MHz one). A receiver measuring in a 200 kHz window then sees the block power minus 10 log10(occupied / 200 kHz) added, power-wise, to the floor.
 * A small deterministic per-channel offset (+-3 dB) makes neighbouring blocks differ as they do in practice. Nothing here is measured.
 */
export const TV_BLOCK_DBM = -75;
export const TV_OCCUPIED_MHZ = Object.freeze({ 6: 5.38, 8: 7.6 });
/** tvBlockLevelDbm(n) -> assumed total in-block level (dBm) of TV channel n at the receiver: TV_BLOCK_DBM +- 3 dB, deterministic. */
export const tvBlockLevelDbm = (n) => TV_BLOCK_DBM + (((Math.imul(Math.round(n) + 7, 2654435761) >>> 0) % 601) / 100 - 3);
/** tvInBandDbm(blockDbm, widthMHz, bwKHz = 200) -> the part of the block that falls in the measurement window (dBm). */
export const tvInBandDbm = (blockDbm, widthMHz = DEFAULT_TV_WIDTH_MHZ, bwKHz = 200) => blockDbm - 10 * Math.log10(((TV_OCCUPIED_MHZ[widthMHz] || TV_OCCUPIED_MHZ[8]) * 1000) / bwKHz);
/** powerSumDb(a, b) -> 10 log10(10^(a/10) + 10^(b/10)). */
export const powerSumDb = (a, b) => 10 * Math.log10(10 ** (a / 10) + 10 ** (b / 10));
/**
 * tvNoiseRiseDb(floorDbm, blockDbm, widthMHz, bwKHz = 200) -> dB the effective floor rises in-block: powerSum(floor, in-band TV) - floor. Always above 0.
 */
export const tvNoiseRiseDb = (floorDbm, blockDbm, widthMHz = DEFAULT_TV_WIDTH_MHZ, bwKHz = 200) => powerSumDb(floorDbm, tvInBandDbm(blockDbm, widthMHz, bwKHz)) - floorDbm;
/**
 * applyTvNoiseRise(points, channels, { widthMHz, bwKHz }) -> a new point list: points inside an occupied channel (lo inclusive, hi exclusive; the full
 * 6 or 8 MHz block) get dbm raised and { tvChannel, riseDb, floorDbm }. points are { freqMHz, dbm, ... }; channels are { n, loMHz, hiMHz, occupied }.
 */
export function applyTvNoiseRise(points, channels, { widthMHz = DEFAULT_TV_WIDTH_MHZ, bwKHz = 200 } = {}) {
  const occ = (channels || []).filter((c) => c && c.occupied);
  return points.map((p) => {
    const c = occ.find((q) => p.freqMHz >= q.loMHz && p.freqMHz < q.hiMHz);
    if (!c) return p;
    const rise = tvNoiseRiseDb(p.dbm, tvBlockLevelDbm(c.n), widthMHz, bwKHz);
    return { ...p, floorDbm: p.dbm, dbm: p.dbm + rise, riseDb: rise, tvChannel: c.n };
  });
}

// ------------------------------------------------------------------------------------------------ project frequencies
/**
 * projectFrequencies(scene) -> [{ source: 'link' | 'imd' | 'noise', id, name, kind, freqMHz, bandwidthKHz, x, inGap, tvChannel, segment }] every frequency the project uses:
 * each link's carrier, each IMD transmitter and each narrowband noise source with a frequency. x is the position on the compressed axis (null in a gap, with
 * inGap true); tvChannel is the TV channel number it falls in (using the scene's channel width) or null.
 */
export function projectFrequencies(scene) {
  const w = tvWidthOf(scene), out = [];
  const add = (source, id, name, kind, freqMHz, bandwidthKHz) => {
    if (!Number.isFinite(freqMHz) || !(freqMHz > 0)) return;
    const x = freqToX(freqMHz), ch = tvChannelOf(freqMHz, w);
    out.push({ source, id, name: name || id, kind, freqMHz, bandwidthKHz, x, inGap: x === null, tvChannel: ch ? ch.n : null, segment: segmentAt(freqMHz) });
  };
  for (const l of (scene && scene.links) || []) add('link', l.id, l.name, l.kind, l.freqMHz, 200);
  for (const t of (scene && scene.imd && scene.imd.transmitters) || []) add('imd', t.id, t.name, 'imd', t.freqMHz, 200);
  for (const n of (scene && scene.noiseSources) || []) if (n && Number.isFinite(n.freqMHz) && n.enabled !== false) add('noise', n.id, n.name, n.kind, n.freqMHz, n.bwKHz);
  return out;
}
/** overlappingFrequencies(list, minSeparationKHz = 200) -> pairs of project frequencies closer than the separation (a coordination hint, not a check). */
export function overlappingFrequencies(list, minSeparationKHz = 200) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const d = Math.abs(list[i].freqMHz - list[j].freqMHz) * 1000;
    if (d < minSeparationKHz && list[i].source !== 'noise' && list[j].source !== 'noise') out.push({ a: list[i].id, b: list[j].id, separationKHz: d });
  }
  return out;
}
