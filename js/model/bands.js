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
    ]),
    blocked: Object.freeze([
      Object.freeze({ fromMHz: 608, toMHz: 614, label: 'Radio astronomy / medical telemetry (TV channel 37)' }),
      Object.freeze({ fromMHz: 617, toMHz: 652, label: '600 MHz downlink (cellular), approx' }),
      Object.freeze({ fromMHz: 663, toMHz: 698, label: '600 MHz uplink (cellular), approx' }),
    ]),
    notes: Object.freeze(['614-698 MHz entries keep the old TV-band extent the planner may expect; the default blocked list removes the cellular parts.']),
  }),
});

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
 * regionBand(regionId, rangeIds?, use?) -> segments [{ startMHz, endMHz, rasterKHz, rangeId }] for coordinateFrequencies({ band }).
 * rangeIds omitted = every range of the region (filtered by `use` when given).
 */
export function regionBand(regionId, rangeIds, use) {
  const r = REGIONS[regionId];
  if (!r) return [];
  return r.ranges
    .filter((x) => (!rangeIds || rangeIds.includes(x.id)) && (!use || x.use.includes(use)))
    .map((x) => ({ startMHz: x.fromMHz, endMHz: x.toMHz, rasterKHz: r.rasterKHz, rangeId: x.id }));
}
