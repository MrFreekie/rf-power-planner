// Regional wireless microphone / IEM band presets for the frequency coordination planner (coordination.js).
//
// PLANNING ESTIMATES ONLY. Band edges, power limits and licensing differ by country, change over time (spectrum auctions,
// digital-dividend clearances) and by venue and event. Every figure below is approximate. Check the national regulator and your
// licence (or licensing body) before using any frequency. Nothing in this table is legal advice or a licence.
//
// Pure data and helpers, no DOM. Units: MHz, kHz, milliwatts (maxPowerMw, ERP/EIRP as stated in powerBasis).

export const BANDS_DISCLAIMER =
  'Planning estimates only. Band edges, power limits and licensing differ by country and change over time. '
  + 'Check your national regulator and licence before using any frequency. '
  + 'UK figures follow Ofcom PMSE pages (licence-exempt page 16 Mar 2023, licensing updates 29 May 2026, statement 27 Oct 2025, SI 2026/396 of 29 Apr 2026) '
  + 'and the DRAFT UK IR 2030 (published 11 Dec 2025, Table 3.14; the final as-made IR was not read). Items marked verified:\'draft\' come from that draft only; '
  + 'items marked verified:false (UHF power defaults, 694-703 MHz, 960-1154 MHz, shared-licence VHF and others) are inferred or from search snippets and still need checking.';

/**
 * Sources cited by the data. `urlPath` is the Ofcom page path (null = not recorded yet: fill in with a one-line edit once the research
 * agent has the exact path). asOf = the page date. Every range's power model names one of these ids, so the UI can cite it.
 */
export const BAND_SOURCES = Object.freeze({
  'ofcom-licence-exempt': Object.freeze({ id: 'ofcom-licence-exempt', title: 'Ofcom: licence-exempt use of wireless microphones', publisher: 'Ofcom', urlPath: null, asOf: '2023-03-16' }),
  'ofcom-licensing-updates': Object.freeze({ id: 'ofcom-licensing-updates', title: 'Ofcom: PMSE licensing updates', publisher: 'Ofcom', urlPath: null, asOf: '2026-05-29' }),
  'ofcom-statement': Object.freeze({ id: 'ofcom-statement', title: 'Ofcom: PMSE statement', publisher: 'Ofcom', urlPath: null, asOf: '2025-10-27' }),
  'ir2030-draft': Object.freeze({ id: 'ir2030-draft', title: 'Ofcom draft UK Interface Requirement 2030 (Table 3.14); the final as-made IR has not been read', publisher: 'Ofcom', urlPath: null, asOf: '2025-12-11' }),
  'si-2026-396': Object.freeze({ id: 'si-2026-396', title: 'SI 2026/396 (audio PMSE licence exemption, in force 29 Apr 2026)', publisher: 'UK Government', urlPath: null, asOf: '2026-04-29' }),
  'planner-estimate': Object.freeze({ id: 'planner-estimate', title: 'Planner estimate (no regulator source recorded)', publisher: null, urlPath: null, asOf: null }),
});

/** Licence classes: 'exempt' (no licence), 'shared' (UK shared mic licence, uncoordinated), 'coordinated', 'high-power' (coordinated, up to 1 W). */
export const LICENCE_CLASSES = Object.freeze(['exempt', 'shared', 'coordinated', 'high-power']);

/**
 * Power model of a range: { handheldMw, bodyWornMw, unit: 'ERP'|'EIRP', verified: true | 'draft' | false, confidence: 'verified'|'draft'|'semi'|'unverified', source: BAND_SOURCES id, note, irRef?, highPowerMw? }.
 * 'draft' = read from the draft UK IR 2030 (11 Dec 2025) only.
 * To change a figure (for example after the IR2030 research lands) edit the one line that builds the range below.
 */
const pw = (handheldMw, bodyWornMw, unit, confidence, source, note, extra = {}) =>
  Object.freeze({ handheldMw, bodyWornMw, unit, verified: confidence === 'verified' ? true : confidence === 'draft' ? 'draft' : false, confidence, source, note, ...extra });

/** UK range builder: planner default power (maxPowerMw / powerBasis) = the handheld figure unless `maxPowerMw` is given. */
const ukRange = (id, fromMHz, toMHz, licenceClass, power, note, extra = {}) => Object.freeze({
  id, fromMHz, toMHz, use: ['mic', 'iem'], licenceClass,
  licence: licenceClass === 'exempt' ? 'exempt' : 'licensed',
  maxPowerMw: power.handheldMw, powerBasis: power.unit, power, note, ...extra,
});

/**
 * Channel 38 (606.5-613.5 MHz), UK shared mic licence: non-protected and uncoordinated. `uncoordinated` is the suggested 10-channel plan,
 * `coordinated` the only two spot frequencies available when ch38 is coordinated. Use as a coordination preset:
 * coordinateFrequencies({ regionId: 'uk', channelPlan: 'uk-ch38-uncoordinated' | 'uk-ch38-coordinated' | CHANNEL_38_PLAN.uncoordinated.freqsMHz }).
 */
export const CHANNEL_38_PLAN = Object.freeze({
  rangeId: 'uk-ch38', fromMHz: 606.5, toMHz: 613.5, licenceClass: 'shared', source: 'ofcom-licensing-updates', asOf: '2026-05-29',
  uncoordinated: Object.freeze({ id: 'uk-ch38-uncoordinated', label: 'Channel 38 suggested 10-channel plan (shared licence)', freqsMHz: Object.freeze([606.6, 607.5, 608.15, 609.15, 609.95, 610.55, 611.25, 612.3, 613.15, 613.5]), verified: false, confidence: 'semi',
    intermodFreeMHz: Object.freeze([607.5, 609.15, 609.95, 613.5]),
    note: 'Only 4 of the 10 channels (607.5, 609.15, 609.95 and 613.5 MHz) are free of third-order intermod when used together; run all 10 and the coordination tool reports conflicts. Use the 10 as a pool of candidates, not as 10 simultaneous channels.' }),
  coordinated: Object.freeze({ id: 'uk-ch38-coordinated', label: 'Channel 38 coordinated spot frequencies', freqsMHz: Object.freeze([606.7, 607.0]), verified: false, confidence: 'semi' }),
});

/** Named channel plans for coordinateFrequencies({ channelPlan }): id -> { id, label, freqsMHz, verified }. */
const r3 = (x) => Math.round(x * 1000) / 1000;
export const CHANNEL_PLANS = Object.freeze({
  [CHANNEL_38_PLAN.uncoordinated.id]: CHANNEL_38_PLAN.uncoordinated,
  [CHANNEL_38_PLAN.coordinated.id]: CHANNEL_38_PLAN.coordinated,
  // Draft IR 2030 VHF channels: IR2030/24/2 centre = 173.6 + 0.2 n MHz (n 1-7), IR2030/24/1 centre = 173.3 + 0.05 n MHz (n 10-35).
  'uk-vhf-200k': Object.freeze({ id: 'uk-vhf-200k', label: 'UK VHF licence-exempt, 200 kHz channels 1-7 (173.8-175.0 MHz)', freqsMHz: Object.freeze(Array.from({ length: 7 }, (_, i) => r3(173.6 + 0.2 * (i + 1)))), verified: 'draft', confidence: 'draft' }),
  'uk-vhf-50k': Object.freeze({ id: 'uk-vhf-50k', label: 'UK VHF licence-exempt, 50 kHz channels 10-35 (173.8-175.05 MHz)', freqsMHz: Object.freeze(Array.from({ length: 26 }, (_, i) => r3(173.3 + 0.05 * (i + 10)))), verified: 'draft', confidence: 'draft' }),
});

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
      // Order matters: rangeAt() returns the first range containing a frequency, so ch38 precedes the whole UHF TV band.
      ukRange('uk-ch38', 606.5, 613.5, 'shared', pw(10, 10, 'ERP', 'unverified', 'ofcom-licensing-updates', 'Shared UK mic licence, non-protected, uncoordinated; 10 mW is the low-power mic figure, not stated for ch38 itself.'),
        'TV channel 38 (606.5-613.5 MHz): shared licence, no protection from other users. Suggested plan and the coordinated spot frequencies are in CHANNEL_38_PLAN.', { optional: true, plans: ['uk-ch38-uncoordinated', 'uk-ch38-coordinated'] }),
      ukRange('uk-uhf-470-694', 470, 694, 'coordinated', pw(50, 50, 'ERP', 'unverified', 'ofcom-statement', 'Low-power mic 10 mW; high-power coordinated up to 1 W. The 50 mW planner default is neither: it is kept from the earlier table.', { highPowerMw: 1000, lowPowerMw: 10 }),
        'UHF TV band (interleaved spectrum). TV channels are 8 MHz and the top or bottom 500 kHz of a channel is not always usable. Coordinated use up to 1 W (high power); shared-licence low power 10 mW; channels in use for TV at a venue must be avoided.', { highPower: true }),
      ukRange('uk-821-826', 821.5, 826, 'exempt', pw(20, 100, 'EIRP', 'draft', 'ir2030-draft', '100 mW EIRP body-worn, 20 mW EIRP other (draft IR 2030, IR2030/35/1).', { irRef: 'IR2030/35/1' }),
        'Licence-exempt UK-wide from 29 Apr 2026 (SI 2026/396, which carries no limits). Limits from the draft IR 2030.'),
      ukRange('uk-826-832', 826, 832, 'exempt', pw(100, 100, 'EIRP', 'draft', 'ir2030-draft', 'Draft IR shows 100 mW EIRP with no body-worn split (IR2030/35/2); draft IR 2030 figure used for every use (earlier statement text that suggested 20 mW is not used). Draft, check final IR 2030.', { irRef: 'IR2030/35/2' }),
        'Licence-exempt UK-wide from 29 Apr 2026 (SI 2026/396, which carries no limits). Draft IR shows 100 mW; check final IR 2030.'),
      ukRange('uk-863-865', 863, 865, 'exempt', pw(10, 10, 'ERP', 'verified', 'ofcom-licence-exempt', '10 mW ERP. The draft IR 2030 agrees: radio mics IR2030/24/3, wireless audio 26/3; 864.8-865.0 MHz is a separate row, also 10 mW ERP, not airborne.', { irRef: 'IR2030/24/3, 26/3' }),
        'Licence-exempt, usable 863.1-864.9 MHz, at default spacing the coordination tool places up to 3 intermod-free channels at once (4 or more fail).', { segments: Object.freeze([Object.freeze({ fromMHz: 863.1, toMHz: 864.9 })]) }),
      ukRange('uk-1785-1805', 1785, 1805, 'exempt', pw(20, 50, 'EIRP', 'draft', 'ir2030-draft', '50 mW EIRP body-worn OR devices using the Spectrum Scanning Procedure (SSP), 20 mW EIRP other (draft IR 2030, IR2030/35/3). Channel bandwidth 10 MHz (inferred).', { sspMw: 50, irRef: 'IR2030/35/3', channelBwMHz: 10 }),
        'Licence-exempt UK-wide from 29 Apr 2026 (SI 2026/396), 1785-1805 MHz. The draft IR says 1785-1804.8 MHz, the Ofcom statement 1785-1805: 1785-1805 is used here.'),
      ukRange('uk-960-1154', 960, 1154, 'coordinated', pw(50, 50, 'ERP', 'unverified', 'ofcom-licensing-updates', 'Coordinated only, under 50 mW; ERP/EIRP basis not stated. 976.5-979.5 MHz: indoors 50 mW, not available outdoors since 11 Mar 2025.'),
        'Coordinated use only. New slots 1015-1016, 1044-1045, 1075-1076 and 1104-1105 MHz; the segments list is these slots.',
        { optional: true, segments: Object.freeze([[1015, 1016], [1044, 1045], [1075, 1076], [1104, 1105]].map(([fromMHz, toMHz]) => Object.freeze({ fromMHz, toMHz }))) }),
      ukRange('uk-vhf-173-175', 173.7, 175.1, 'exempt', pw(10, 50, 'ERP', 'draft', 'ir2030-draft', '10 mW ERP, 50 mW ERP body-worn (draft IR 2030, IR2030/24/2: 173.7-175.1 MHz, 200 kHz spacing, channels 1-7). IR2030/24/1 (173.775-175.075 MHz, 50 kHz spacing, channels 10-35) gives 10 mW ERP only.', { irRef: 'IR2030/24/1, 24/2' }),
        'VHF licence-exempt: 200 kHz channels at 173.6 + 0.2 n MHz (173.8 ... 175.0, about 3 simultaneous) or 50 kHz channels at 173.3 + 0.05 n MHz (n 10-35); see CHANNEL_PLANS uk-vhf-200k and uk-vhf-50k.', { group: 'vhf' }),
      ukRange('uk-vhf-175-176', 175.25, 176.6, 'shared', pw(10, 50, 'ERP', 'unverified', 'ofcom-licence-exempt', 'Shared UK mic licence VHF: 10 mW handheld / 50 mW body-worn, 200 kHz maximum bandwidth; ERP/EIRP not stated.'),
        'Shared-licence VHF, 3 spots.', { group: 'vhf' }),
      ukRange('uk-vhf-191-210', 191.9, 209.8, 'shared', pw(10, 50, 'ERP', 'unverified', 'ofcom-licence-exempt', 'Shared UK mic licence VHF: 10 mW handheld / 50 mW body-worn, 200 kHz maximum bandwidth; ERP/EIRP not stated.'),
        'Shared-licence VHF inside TV Band III / DAB: use bandIIIChannelsToBlocked / dabBlocksToBlocked to exclude what is on air at the venue.', { group: 'vhf' }),
      ukRange('uk-2g4', 2400, 2483.5, 'exempt', pw(10, 10, 'EIRP', 'draft', 'ir2030-draft', 'Audio PMSE 10 mW EIRP (IR2030/26/5, EN 300 422, not airborne). 100 mW EIRP applies only to the wideband-data rows (IR2030/7/1), not audio microphones; many commercial 2.4 GHz mic systems may use that wideband-data route, which this planner does not assume.', { genericSrdMw: 100, irRef: 'IR2030/26/5' }),
        '2.4 GHz ISM, shared with Wi-Fi and Bluetooth; systems hop on their own. Audio PMSE limit 10 mW EIRP; 100 mW is the wideband-data limit.', { group: '2g4', hopping: true }),
      ukRange('uk-5g8', 5725, 5875, 'exempt', pw(25, 25, 'EIRP', 'draft', 'ir2030-draft', 'Generic short-range-device 25 mW EIRP (IR2030/1/23); digitised speech/music is allowed on short-range indoor data links (IR2030/9/2). Generic SRD, not audio-PMSE specific: there is no audio-PMSE row for 5.8 GHz.', { irRef: 'IR2030/1/23, 9/2' }),
        '5.8 GHz ISM / short-range device band, shared with Wi-Fi 5 GHz channels 149-165. Generic SRD limit, not audio-PMSE specific.', { group: '5g8', hopping: true }),
    ]),
    blocked: Object.freeze([
      Object.freeze({ fromMHz: 694, toMHz: 703, label: '694-703 MHz guard band (availability UNVERIFIED)', verified: false }),
      Object.freeze({ fromMHz: 703, toMHz: 790, label: '703-790 MHz: not available for PMSE since 1 May 2020', verified: true }),
      Object.freeze({ fromMHz: 976.5, toMHz: 979.5, label: '976.5-979.5 MHz: not available outdoors since 11 Mar 2025 (indoors 50 mW); applies when the request says outdoor', onlyOutdoor: true, verified: false }),
    ]),
    notes: Object.freeze([
      'Audio PMSE became licence-exempt UK-wide on 29 Apr 2026 (SI 2026/396) for 821.5-826, 826-832 and 1785-1805 MHz.',
      '703-790 MHz is not available for PMSE (since 1 May 2020); 694-703 MHz is a guard band (availability unverified).',
    ]),
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
export function typicalTxDbm(kind, freqMHz, regionId) {
  const p = bandProfileAt(freqMHz);
  if (!p) return null;
  const t = p.typicalTxDbm[kind === 'iem' ? 'iem' : 'mic'];
  const l = regionId ? bandLimitDbm(regionId, freqMHz) : null;
  return l ? Math.min(t, l.maxDbm) : t; // with a region: never above that region's limit (UK 2.4 GHz audio PMSE: 10 dBm)
}

/** Regional power limit in dBm (transmitter-output basis of the profile) for the VHF / 2.4 / 5.8 GHz bands: { maxDbm, basis } or null. Planning estimate. */
export function bandLimitDbm(regionId, freqMHz) {
  const x = rangeAt(regionId, freqMHz);
  if (x && x.power) return { maxDbm: mwToDbm(Math.max(x.power.handheldMw, x.power.bodyWornMw)), basis: `${x.power.unit}, ${x.power.confidence}: ${x.power.note}` }; // the region's own power model (UK)
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
 * powerLimitFor(regionId, freqMHz) -> { maxPowerMw, maxPowerDbm, powerBasis, licence, licenceClass, rangeId, note, verified } | null.
 * The planner default (one number per range, the handheld figure). null when the region is unknown or the frequency lies outside every
 * range of the region (nothing is assumed allowed there). Use powerLimitDetailFor for handheld / body-worn figures and the source.
 */
export function powerLimitFor(regionId, freqMHz) {
  const x = rangeAt(regionId, freqMHz);
  if (!x) return null;
  return { maxPowerMw: x.maxPowerMw, maxPowerDbm: mwToDbm(x.maxPowerMw), powerBasis: x.powerBasis, licence: x.licence, licenceClass: x.licenceClass || null, rangeId: x.id, note: x.note, verified: x.power ? x.power.verified : false };
}

/**
 * powerLimitDetailFor(regionId, freqMHz) -> { handheldMw, bodyWornMw, unit: 'ERP'|'EIRP', verified, confidence, source, sourceTitle, urlPath, asOf, note,
 *   rangeId, licenceClass, highPowerMw? , ...extras } | null. Ranges without a power model (EU / US tables) report maxPowerMw for both, verified false, source
 * 'planner-estimate'.
 */
export function powerLimitDetailFor(regionId, freqMHz) {
  const x = rangeAt(regionId, freqMHz);
  if (!x) return null;
  const p = x.power || { handheldMw: x.maxPowerMw, bodyWornMw: x.maxPowerMw, unit: x.powerBasis, verified: false, confidence: 'unverified', source: 'planner-estimate', note: x.note };
  const src = BAND_SOURCES[p.source] || BAND_SOURCES['planner-estimate'];
  return { ...p, sourceTitle: src.title, urlPath: src.urlPath, asOf: src.asOf, rangeId: x.id, licenceClass: x.licenceClass || null };
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
 * rangeIds omitted = every non-`optional` range of the region in `group` (default 'uhf', the original behaviour), filtered by `use` when given.
 * With rangeIds the group is not applied (the ids decide) and optional ranges can be named. A range with `segments` (usable sub-bands, for
 * example 863.1-864.9 MHz or the 960-1154 MHz slots) yields one segment per entry instead of the whole range.
 */
export function regionBand(regionId, rangeIds, use, group = 'uhf') {
  const r = REGIONS[regionId];
  if (!r) return [];
  return r.ranges
    .filter((x) => (rangeIds ? rangeIds.includes(x.id) : rangeGroup(x) === group && !x.optional) && (!use || x.use.includes(use)))
    .flatMap((x) => (x.segments || [{ fromMHz: x.fromMHz, toMHz: x.toMHz }])
      .map((sg) => ({ startMHz: sg.fromMHz, endMHz: sg.toMHz, rasterKHz: r.rasterKHz, rangeId: x.id })));
}
