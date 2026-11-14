// Regional wireless microphone / IEM band presets for the frequency coordination planner (coordination.js).
//
// PLANNING ESTIMATES ONLY. Band edges, power limits and licensing differ by country, change over time (spectrum auctions,
// digital-dividend clearances) and by venue and event. Every figure below is approximate. Check the national regulator and your
// licence (or licensing body) before using any frequency. Nothing in this table is legal advice or a licence.
//
// Pure data and helpers, no DOM. Units: MHz, kHz, milliwatts (maxPowerMw, ERP/EIRP as stated in powerBasis).

export const BANDS_DISCLAIMER =
  'Planning estimates only. Band edges, power limits and licensing differ by country and change over time. '
  + 'Check your national regulator and licence before using any frequency.';

/**
 * range = { id, fromMHz, toMHz, use: ['mic'|'iem'...], maxPowerMw, powerBasis: 'ERP'|'EIRP', licence: 'licensed'|'exempt'|'varies', note }
 * region = { id, name, tvChannelWidthMHz, tvChannelOneMHz: { channel, lowerMHz }, rasterKHz, minSpacingKHz, ranges[], blocked[], notes[] }
 *   blocked: ranges inside the listed bands that a planner should normally avoid ({ fromMHz, toMHz, label }).
 */
export const REGIONS = Object.freeze({
  uk: Object.freeze({
    id: 'uk',
    name: 'United Kingdom (approx)',
    tvChannelWidthMHz: 8,
    tvChannelOneMHz: Object.freeze({ channel: 21, lowerMHz: 470 }),
    rasterKHz: 25,
    minSpacingKHz: 300,
    ranges: Object.freeze([
      Object.freeze({ id: 'uk-uhf-470-694', fromMHz: 470, toMHz: 694, use: ['mic', 'iem'], maxPowerMw: 50, powerBasis: 'ERP', licence: 'licensed', note: 'UHF TV band (PMSE, interleaved spectrum); channels in use for TV at a venue must be avoided.' }),
      Object.freeze({ id: 'uk-823-832', fromMHz: 823, toMHz: 832, use: ['mic', 'iem'], maxPowerMw: 20, powerBasis: 'EIRP', licence: 'licensed', note: 'Duplex gap, often shared with IEM; local conditions vary.' }),
      Object.freeze({ id: 'uk-863-865', fromMHz: 863, toMHz: 865, use: ['mic', 'iem'], maxPowerMw: 10, powerBasis: 'ERP', licence: 'exempt', note: 'Licence-exempt band, very little room.' }),
      Object.freeze({ id: 'uk-vhf-174-216', group: 'vhf', fromMHz: 174, toMHz: 216, use: ['mic', 'iem'], maxPowerMw: 10, powerBasis: 'ERP', licence: 'varies', note: 'VHF is TV Band III (174-216 MHz); DAB and digital TV occupy most of it in many countries, so use bandIIIChannelsToBlocked / dabBlocksToBlocked to exclude what is on air at the venue. UK PMSE VHF use is mostly limited to channel 70 (173.8-175.0 MHz).' }),
      Object.freeze({ id: 'uk-2g4', group: '2g4', fromMHz: 2400, toMHz: 2483.5, use: ['mic', 'iem'], maxPowerMw: 100, powerBasis: 'EIRP', licence: 'exempt', hopping: true, note: '2.4 GHz ISM, shared with Wi-Fi and Bluetooth; systems hop on their own (EN 300 328 class).' }),
      Object.freeze({ id: 'uk-5g8', group: '5g8', fromMHz: 5725, toMHz: 5875, use: ['mic', 'iem'], maxPowerMw: 25, powerBasis: 'EIRP', licence: 'exempt', hopping: true, note: '5.8 GHz ISM / short-range device band, shared with Wi-Fi 5 GHz channels 149-165.' }),
    ]),
    blocked: Object.freeze([]),
    notes: Object.freeze(['The 700 MHz band (694-791 MHz) is not available for wireless microphones in the UK.']),
  }),
  eu: Object.freeze({
    id: 'eu',
    name: 'European Union / CEPT (approx)',
    tvChannelWidthMHz: 8,
    tvChannelOneMHz: Object.freeze({ channel: 21, lowerMHz: 470 }),
    rasterKHz: 25,
    minSpacingKHz: 300,
    ranges: Object.freeze([
      Object.freeze({ id: 'eu-uhf-470-694', fromMHz: 470, toMHz: 694, use: ['mic', 'iem'], maxPowerMw: 50, powerBasis: 'ERP', licence: 'varies', note: 'UHF TV band; national licensing rules vary a lot between countries.' }),
      Object.freeze({ id: 'eu-823-832', fromMHz: 823, toMHz: 832, use: ['mic', 'iem'], maxPowerMw: 20, powerBasis: 'EIRP', licence: 'varies', note: 'Duplex gap; availability depends on the country.' }),
      Object.freeze({ id: 'eu-863-865', fromMHz: 863, toMHz: 865, use: ['mic', 'iem'], maxPowerMw: 10, powerBasis: 'ERP', licence: 'exempt', note: 'Short-range device band, usually licence-exempt.' }),
      Object.freeze({ id: 'eu-1785-1805', fromMHz: 1785, toMHz: 1805, use: ['mic', 'iem'], maxPowerMw: 20, powerBasis: 'EIRP', licence: 'varies', note: 'Higher band used by some digital systems.' }),
      Object.freeze({ id: 'eu-vhf-174-216', group: 'vhf', fromMHz: 174, toMHz: 216, use: ['mic', 'iem'], maxPowerMw: 10, powerBasis: 'ERP', licence: 'varies', note: 'VHF is TV Band III (174-216 MHz); DAB and digital TV occupy most of it in many countries, so use bandIIIChannelsToBlocked / dabBlocksToBlocked to exclude what is on air at the venue. National rules differ.' }),
      Object.freeze({ id: 'eu-2g4', group: '2g4', fromMHz: 2400, toMHz: 2483.5, use: ['mic', 'iem'], maxPowerMw: 100, powerBasis: 'EIRP', licence: 'exempt', hopping: true, note: '2.4 GHz ISM, shared with Wi-Fi and Bluetooth; systems hop on their own (EN 300 328 class).' }),
      Object.freeze({ id: 'eu-5g8', group: '5g8', fromMHz: 5725, toMHz: 5875, use: ['mic', 'iem'], maxPowerMw: 25, powerBasis: 'EIRP', licence: 'exempt', hopping: true, note: '5.8 GHz short-range device band, shared with Wi-Fi 5 GHz channels 149-165.' }),
    ]),
    blocked: Object.freeze([]),
    notes: Object.freeze(['694-703 MHz was PMSE in some countries only for a transition period; it is not included here.']),
  }),
  us: Object.freeze({
    id: 'us',
    name: 'United States (approx)',
    tvChannelWidthMHz: 6,
    tvChannelOneMHz: Object.freeze({ channel: 14, lowerMHz: 470 }),
    rasterKHz: 25,
    minSpacingKHz: 300,
    ranges: Object.freeze([
      Object.freeze({ id: 'us-uhf-470-608', fromMHz: 470, toMHz: 608, use: ['mic', 'iem'], maxPowerMw: 250, powerBasis: 'EIRP', licence: 'varies', note: 'TV channels 14-36 (Part 74 style); licensing eligibility and the TV-band database rules apply.' }),
      Object.freeze({ id: 'us-uhf-614-698', fromMHz: 614, toMHz: 698, use: ['mic', 'iem'], maxPowerMw: 250, powerBasis: 'EIRP', licence: 'varies', note: 'Legacy extent of the old TV band. Most of it is now cellular (600 MHz); only small gaps remain usable.' }),
      Object.freeze({ id: 'us-902-928', fromMHz: 902, toMHz: 928, use: ['mic', 'iem'], maxPowerMw: 50, powerBasis: 'EIRP', licence: 'exempt', note: 'ISM band, shared with many other users.' }),
      Object.freeze({ id: 'us-vhf-169-172', group: 'vhf', fromMHz: 169, toMHz: 172, use: ['mic', 'iem'], maxPowerMw: 50, powerBasis: 'EIRP', licence: 'varies', note: 'Part 74 style VHF low segment (approx); check the current rules.' }),
      Object.freeze({ id: 'us-vhf-174-216', group: 'vhf', fromMHz: 174, toMHz: 216, use: ['mic', 'iem'], maxPowerMw: 50, powerBasis: 'EIRP', licence: 'varies', note: 'VHF is TV Band III (174-216 MHz); DAB and digital TV occupy most of it in many countries, so use bandIIIChannelsToBlocked / dabBlocksToBlocked to exclude what is on air at the venue. VHF high band, TV channels 7-13 (6 MHz each).' }),
      Object.freeze({ id: 'us-2g4', group: '2g4', fromMHz: 2400, toMHz: 2483.5, use: ['mic', 'iem'], maxPowerMw: 1000, powerBasis: 'EIRP', licence: 'exempt', hopping: true, note: '2.4 GHz ISM (Part 15), shared with Wi-Fi and Bluetooth; higher EIRP is possible with directional antennas. Systems hop on their own.' }),
      Object.freeze({ id: 'us-5g8', group: '5g8', fromMHz: 5725, toMHz: 5850, use: ['mic', 'iem'], maxPowerMw: 1000, powerBasis: 'EIRP', licence: 'exempt', hopping: true, note: '5.8 GHz ISM / U-NII-3 (Part 15), shared with Wi-Fi channels 149-165.' }),
    ]),
    blocked: Object.freeze([
      Object.freeze({ fromMHz: 608, toMHz: 614, label: 'Radio astronomy / medical telemetry (TV channel 37)' }),
      Object.freeze({ fromMHz: 617, toMHz: 652, label: '600 MHz downlink (cellular), approx' }),
      Object.freeze({ fromMHz: 663, toMHz: 698, label: '600 MHz uplink (cellular), approx' }),
    ]),
    notes: Object.freeze(['614-698 MHz entries keep the old TV-band extent the planner may expect; the default blocked list removes the cellular parts.']),
  }),
});

/**
 * Band groups. 'uhf' (default, the original behaviour) and 'vhf' are intermod-coordinated: each system has a fixed carrier, so
 * coordination.js finds an intermod-free set. '2g4' and '5g8' systems hop on their own inside the shared ISM band, so
 * there are no fixed frequencies to assign: coordination reports channel occupancy and Wi-Fi overlap instead.
 */
export const BAND_GROUPS = Object.freeze({
  uhf: Object.freeze({ id: 'uhf', name: 'UHF', fromMHz: 470, toMHz: 1000, hopping: false }),
  vhf: Object.freeze({ id: 'vhf', name: 'VHF (TV Band III)', fromMHz: 169, toMHz: 216, hopping: false }),
  '2g4': Object.freeze({ id: '2g4', name: '2.4 GHz ISM', fromMHz: 2400, toMHz: 2483.5, hopping: true }),
  '5g8': Object.freeze({ id: '5g8', name: '5.8 GHz ISM', fromMHz: 5725, toMHz: 5875, hopping: true }),
});
export const BAND_GROUP_IDS = Object.freeze(Object.keys(BAND_GROUPS));

/** Group of a range (ranges without `group` are UHF). */
export const rangeGroup = (range) => (range && range.group) || 'uhf';

/** Band group a carrier frequency belongs to: 'vhf' (below 300 MHz), 'uhf' (below 2000), '2g4' (below 4000), '5g8' (above). */
export function groupOfFreq(freqMHz) {
  if (!(freqMHz > 0)) return 'uhf';
  return freqMHz < 300 ? 'vhf' : freqMHz < 2000 ? 'uhf' : freqMHz < 4000 ? '2g4' : '5g8';
}

/** Wi-Fi channel plans inside the hopping bands (20 MHz channels). 2.4 GHz: centre = 2407 + 5 n (n 1..13); 5.8 GHz: 5000 + 5 n (149..165). */
export const WIFI_CHANNELS = Object.freeze({
  '2g4': Object.freeze({ widthMHz: 20, channels: Object.freeze(Array.from({ length: 13 }, (_, i) => Object.freeze({ channel: i + 1, centerMHz: 2412 + 5 * i }))), nonOverlapping: Object.freeze([1, 6, 11]) }),
  '5g8': Object.freeze({ widthMHz: 20, channels: Object.freeze([149, 153, 157, 161, 165].map((n) => Object.freeze({ channel: n, centerMHz: 5000 + 5 * n }))), nonOverlapping: Object.freeze([149, 153, 157, 161, 165]) }),
});

/** TV Band III channel plan (VHF): UK/EU 7 MHz channels 5-12 from 174 MHz, US 6 MHz channels 7-13 from 174 MHz. */
export const BAND_III = Object.freeze({
  uk: Object.freeze({ widthMHz: 7, firstChannel: 5, lastChannel: 12, lowerMHz: 174 }),
  eu: Object.freeze({ widthMHz: 7, firstChannel: 5, lastChannel: 12, lowerMHz: 174 }),
  us: Object.freeze({ widthMHz: 6, firstChannel: 7, lastChannel: 13, lowerMHz: 174 }),
});

/** Band III TV channel to { channel, fromMHz, toMHz }, or null. */
export function bandIIIChannelRange(regionId, channel) {
  const b = BAND_III[regionId];
  if (!b || !Number.isInteger(channel) || channel < b.firstChannel || channel > b.lastChannel) return null;
  const from = b.lowerMHz + (channel - b.firstChannel) * b.widthMHz;
  return { channel, fromMHz: from, toMHz: from + b.widthMHz };
}

/** Blocked ranges for Band III TV channels in use at the venue (for coordinateFrequencies({ blocked })). */
export function bandIIIChannelsToBlocked(regionId, channels) {
  return (channels || []).map((c) => bandIIIChannelRange(regionId, c)).filter(Boolean)
    .map((b) => ({ fromMHz: b.fromMHz, toMHz: b.toMHz, label: `Band III TV channel ${b.channel}` }));
}

/** DAB Band III block centres, MHz (blocks 5A to 10D; an ensemble occupies about 1.536 MHz). */
export const DAB_BLOCKS = Object.freeze({
  '5A': 174.928, '5B': 176.640, '5C': 178.352, '5D': 180.064, '6A': 181.936, '6B': 183.648, '6C': 185.360, '6D': 187.072,
  '7A': 188.928, '7B': 190.640, '7C': 192.352, '7D': 194.064, '8A': 195.936, '8B': 197.648, '8C': 199.360, '8D': 201.072,
  '9A': 202.928, '9B': 204.640, '9C': 206.352, '9D': 208.064, '10A': 209.936, '10B': 211.648, '10C': 213.360, '10D': 215.072,
});
export const DAB_BLOCK_WIDTH_MHZ = 1.536;

/** Blocked ranges for the DAB blocks in use at the venue (ids like '5A'; unknown ids are ignored). */
export function dabBlocksToBlocked(blockIds) {
  return (blockIds || []).filter((id) => Object.prototype.hasOwnProperty.call(DAB_BLOCKS, id)).map((id) => ({
    fromMHz: DAB_BLOCKS[id] - DAB_BLOCK_WIDTH_MHZ / 2, toMHz: DAB_BLOCKS[id] + DAB_BLOCK_WIDTH_MHZ / 2, label: `DAB block ${id}`,
  }));
}

import { BAND_PROFILES } from './library.js';

const profileKey = (freqMHz) => (freqMHz >= 174 && freqMHz <= 240 ? 'vhf-174-216' : freqMHz >= 2400 && freqMHz <= 2500 ? 'ism-2400' : freqMHz >= 5725 && freqMHz <= 5875 ? 'ism-5800' : null);

/** library.js BAND_PROFILES entry for a carrier in the VHF, 2.4 GHz or 5.8 GHz bands (null elsewhere; UHF has the REGIONS table). */
export const bandProfileAt = (freqMHz) => { const k = profileKey(freqMHz); return k ? { key: k, ...BAND_PROFILES[k] } : null; };

/** Typical transmitter output (dBm) for a link kind at a carrier in the VHF / 2.4 / 5.8 GHz bands, else null. mic 15 / IEM 17 (VHF), 10 / 13 (2.4 GHz), 10 / 10 (5.8 GHz). */
export function typicalTxDbm(kind, freqMHz) {
  const p = bandProfileAt(freqMHz);
  return p ? p.typicalTxDbm[kind === 'iem' ? 'iem' : 'mic'] : null;
}

/** Regional power limit in dBm (transmitter-output basis of the profile) for the VHF / 2.4 / 5.8 GHz bands: { maxDbm, basis } or null. Planning estimate. */
export function bandLimitDbm(regionId, freqMHz) {
  const p = bandProfileAt(freqMHz);
  const l = p && p.limits.find((x) => x.region === regionId);
  return l ? { maxDbm: l.maxDbm, basis: l.basis } : null;
}

export const REGION_IDS = Object.freeze(Object.keys(REGIONS));

export const getRegion = (id) => REGIONS[id] || null;

/** mW to dBm (10 log10 mW). */
export const mwToDbm = (mw) => 10 * Math.log10(mw);

/** The range of a region that contains freqMHz (inclusive edges), or null. */
export function rangeAt(regionId, freqMHz) {
  const r = REGIONS[regionId];
  if (!r) return null;
  return r.ranges.find((x) => freqMHz >= x.fromMHz && freqMHz <= x.toMHz) || null;
}

/**
 * powerLimitFor(regionId, freqMHz) -> { maxPowerMw, maxPowerDbm, powerBasis, licence, rangeId, note } | null.
 * null when the region is unknown or the frequency lies outside every range of the region (nothing is assumed allowed there).
 */
export function powerLimitFor(regionId, freqMHz) {
  const x = rangeAt(regionId, freqMHz);
  if (!x) return null;
  return { maxPowerMw: x.maxPowerMw, maxPowerDbm: mwToDbm(x.maxPowerMw), powerBasis: x.powerBasis, licence: x.licence, rangeId: x.id, note: x.note };
}

/** TV channel number to its frequency block { channel, fromMHz, toMHz } for a region ('uk', 'eu' 8 MHz, 'us' 6 MHz). null when unknown. */
export function tvChannelRange(regionId, channel) {
  const r = REGIONS[regionId];
  if (!r || !Number.isInteger(channel)) return null;
  const from = r.tvChannelOneMHz.lowerMHz + (channel - r.tvChannelOneMHz.channel) * r.tvChannelWidthMHz;
  return { channel, fromMHz: from, toMHz: from + r.tvChannelWidthMHz };
}

/** Which TV channel contains freqMHz (the block it falls in), or null. */
export function tvChannelAt(regionId, freqMHz) {
  const r = REGIONS[regionId];
  if (!r || !(freqMHz >= r.tvChannelOneMHz.lowerMHz)) return null;
  return r.tvChannelOneMHz.channel + Math.floor((freqMHz - r.tvChannelOneMHz.lowerMHz) / r.tvChannelWidthMHz);
}

/** Blocked ranges for a list of occupied TV channels: [{ fromMHz, toMHz, label }] (for coordinateFrequencies({ blocked })). */
export function tvChannelsToBlocked(regionId, channels) {
  return (channels || []).map((c) => tvChannelRange(regionId, c)).filter(Boolean)
    .map((b) => ({ fromMHz: b.fromMHz, toMHz: b.toMHz, label: `TV channel ${b.channel}` }));
}

/**
 * regionBand(regionId, rangeIds?, use?, group?) -> segments [{ startMHz, endMHz, rasterKHz, rangeId }] for coordinateFrequencies({ band }).
 * rangeIds omitted = every range of the region in `group` (default 'uhf', the original behaviour), filtered by `use` when given.
 * With rangeIds the group is not applied (the ids decide).
 */
export function regionBand(regionId, rangeIds, use, group = 'uhf') {
  const r = REGIONS[regionId];
  if (!r) return [];
  return r.ranges
    .filter((x) => (rangeIds ? rangeIds.includes(x.id) : rangeGroup(x) === group) && (!use || x.use.includes(use)))
    .map((x) => ({ startMHz: x.fromMHz, endMHz: x.toMHz, rasterKHz: r.rasterKHz, rangeId: x.id }));
}
