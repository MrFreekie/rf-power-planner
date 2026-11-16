// Example scenes: each builds a complete scene plus a short explanation. Pure (no DOM).
//   EXAMPLES: [{ id, title, note, build() -> { scene, walk?: { to, speedMps, pingPong }, select? } }]
//   getExample(id), buildExample(id) -> { id, title, note, scene, walk, selectId }
// Layout: js/examples/helpers.js (shared scene helpers), js/examples/scenes-*.js (scene builders and report helpers by topic), js/examples/entries-*.js (the EXAMPLES entries, in display order).
// This file is the public API: re-exports, EXAMPLES (the entry arrays concatenated in order), exampleKeywords, getExample, buildExample.

export { BAND_EXAMPLE_FREQ_MHZ, bandScene, audienceScene, ceilingScene, rofScene, rofBranchScene, p2pScene } from './examples/scenes-venue.js';
export { sosScene, sosReport, fohScene, fohReport, videoWallScene, videoWallReport } from './examples/scenes-foh.js';
export { evenScene, TONE_MPX_EXAMPLES, toneMpxScene, toneMpxExampleReport, IEM8_PLAN_MHZ, iem8Scene } from './examples/scenes-imd.js';
export { reviewScene, noiseSourceScene } from './examples/scenes-review.js';
export { WEAK_TV_BLOCK_DBM, WEAK_TV_FREQ_MHZ, WEAK_TV_US_CHANNEL, weakTvScene, weakTvReport, boosterOverloadScene, boosterOverloadReport, MODE_CONTRAST_LEVELS, modeContrastScene, modeContrastReport, bodyWornScene, bodyWornReport, diversityCombiningScene, diversityCombiningReport, WEAK_TV_SECOND_MIC_MHZ, weakTvTwoMicScene, TV_LEVELS_DBM, tvLevelsScene } from './examples/scenes-signal.js';
export { MEASUREMENT_WALK_X, MEASUREMENT_FEW_X, measurementsScene, TWO_WALLS, TWO_WALLS_TRUTH_DB, TWO_WALLS_X, ONE_WALL, ONE_WALL_TRUTH_DB, ONE_WALL_X, twoWallsScene } from './examples/scenes-measure.js';
export { BAND_PEOPLE, bandPeopleScene, movePersonInScene, linkMargins, BAND_WALK_TO, bandWalkEndScene, PRESENTER_PLAN_MHZ, presenterScene, BAND_SPARE_PACK_POS, bandSwapScene } from './examples/scenes-people.js';
export { squelchBurstScene, squelchBurstReport, COORD_PLANS_MHZ, coordScene, squelchPilotScene, squelchPilotReport } from './examples/scenes-squelch-coord.js';
export { SR2050_LEGACY_MHZ, sr2050Scene, compareChangeScene } from './examples/scenes-misc.js';

import { CORE_EXAMPLES } from './examples/entries-core.js';
import { VENUE_EXAMPLES } from './examples/entries-venue.js';
import { LINKS_EXAMPLES } from './examples/entries-links.js';
import { CHAIN_EXAMPLES } from './examples/entries-chain.js';
import { NOISE_TV_EXAMPLES } from './examples/entries-noise-tv.js';
import { LATE_EXAMPLES } from './examples/entries-late.js';

export const EXAMPLES = [
  ...CORE_EXAMPLES,
  ...VENUE_EXAMPLES,
  ...LINKS_EXAMPLES,
  ...CHAIN_EXAMPLES,
  ...NOISE_TV_EXAMPLES,
  ...LATE_EXAMPLES,
];

// Search keywords for the command palette: every entry carries `keywords` (a plain lower-case string, never shown), so 'measure', 'measurement', 'walk' and 'noise'
// find the right examples even when the title does not say so. The palette should read `ex.keywords` (an empty string when absent) next to the category.
const WALK_IDS = new Set(['dropout-two-ray', 'diversity-null', 'diversity-modes', 'iem-stereo-mono', 'pilot-vs-carrier-squelch', 'reflective-wall', 'telemetry-before-audio', 'digital-vs-analog', 'adaptive-modulation', 'digital-cuts-out', 'constellation-noise', 'diversity-cable-runs', 'raised-stage-null', 'band-vhf', 'band-uhf', 'band-2g4', 'wifi-busy-2g4', 'ur4d-style-link', 'diversity-correlated-antennas', 'diversity-spaced-antennas', 'band-four-piece-walk']); // the examples whose build() returns a walk
export function exampleKeywords(ex) {
  const k = [];
  if (WALK_IDS.has(ex.id)) k.push('walk walking path moving');
  if (/^measurements-/.test(ex.id)) k.push('measure measurement measurements readings walk walk-test calibrate calibration fit wall material fit');
  if (/^noise-|^video-wall|^squelch-noise|^squelch-pilot|^generator-|^external-noise|^tv-|radio$|^stray-carrier|^wifi-busy|^even-/.test(ex.id)) k.push('noise interference');
  if (/^generator-/.test(ex.id)) k.push('generator inverter power continuous');
  if (/^squelch-pilot/.test(ex.id)) k.push('squelch pilot gate flash pulse flicker');
  if (/^booster-/.test(ex.id)) k.push('booster compression p1db overload');
  if (/^iem-sr2050/.test(ex.id)) k.push('sennheiser sr 2050 ek 2000 iem legacy range power');
  if (/^band-four-piece-swap/.test(ex.id)) k.push('people person assign spare pack jump');
  if (/^compare-/.test(ex.id)) k.push('compare snapshot diff change');
  if (/^noise-/.test(ex.id)) k.push('noise source emitter timing pulse flicker');
  if (/^squelch-noise/.test(ex.id)) k.push('pulse flicker');
  if (/^tv-/.test(ex.id)) k.push('tv level channel per channel');
  if (/^coord-|^imd-/.test(ex.id)) k.push('coordination frequency plan intermod');
  return k.join(' ');
}
for (const ex of EXAMPLES) ex.keywords = exampleKeywords(ex);

export const getExample = (id) => EXAMPLES.find((e) => e.id === id) || null;

/** buildExample(id) -> { id, title, note, scene, walk, selectId } or null for an unknown id. */
export function buildExample(id) {
  const ex = getExample(id);
  if (!ex) return null;
  const { scene, walk = null } = ex.build();
  return { id: ex.id, title: ex.title, note: ex.note, scene, walk, selectId: scene.links[0] ? scene.links[0].tx.id : null };
}
