// Example scene builders: measurement walks and per-material wall calibration.
import { solveLink } from '../model/rf.js';
import { suggestCalibration } from '../model/measurements.js';
import { createReflector } from '../model/scene.js';
import { omni, make } from './helpers.js';

/**
 * Walk-test calibration (measurements.js): measurementsScene(variant) -> a mic link (free space, 10 m stage line) with 12 readings taken along a walk away from the
 * transmitter (receiver at 8 to 68 m). The readings are SYNTHETIC: solved with the true body loss plus a fixed, deterministic scatter of up to +-0.4 dB.
 * 'body-loss-high': the scene assumes 3 dB of body loss, the readings were made with 10 dB. 'clean-match': the scene assumes 6 dB and so did the readings.
 */
export const MEASUREMENT_WALK_X = Object.freeze([8, 13, 19, 26, 33, 40, 46, 52, 57, 62, 66, 70]);
export const MEASUREMENT_FEW_X = Object.freeze([32, 33, 34]); // the too-few walk: three readings within 2 m of each other
const measScatter = (i) => { const v = Math.sin((i + 1) * 12.9898) * 43758.5453; return 0.4 * (2 * (v - Math.floor(v)) - 1); };
export function measurementsScene(variant = 'body-loss-high') {
  const assumed = variant === 'clean-match' ? 6 : 3, truth = variant === 'clean-match' ? 6 : 10; // 'too-few' is the same 3 -> 10 dB story with three clustered readings
  const sc = make('mic', (s, l) => {
    s.stage = { width: 120, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space'; s.environment.bodyLossDb = assumed;
    l.name = 'Bodypack walk test'; l.freqMHz = 606.1; l.tx.powerDbm = 10;
    l.tx.pos = { x: 3, y: 10, z: 1.2 }; l.tx.antenna = omni(); l.rx.antenna = omni(); l.rx.pos = { x: 40, y: 10, z: 1.5 }; l.rx.diversity.antennaB.pos = { x: 40, y: 9.4, z: 1.5 };
  });
  const truthScene = { ...sc, environment: { ...sc.environment, bodyLossDb: truth } }, l = sc.links[0];
  sc.measurements = (variant === 'too-few' ? MEASUREMENT_FEW_X : MEASUREMENT_WALK_X).map((x, i) => {
    const copy = JSON.parse(JSON.stringify(l)); copy.rx.pos = { x, y: 10, z: 1.5 };
    const dbm = solveLink(truthScene, copy).inputPowerDbm + measScatter(i);
    return { id: `meas${i + 1}`, linkId: l.id, x, y: 10, rxDbm: Math.round(dbm * 100) / 100 };
  });
  return sc;
}

/**
 * Walk test through walls (measurements.js): wallWalkScene({ walls, truthDb, xs, fit }) -> a 606.1 MHz mic link in free space with 3 dB of body loss (right) and walls across the
 * walk (each a full-width vertical wall at x). The 'truth' is the same scene with truthDb extra dB per wall material (what the real walls cost beyond the table value); the 14 or
 * 13 readings are SYNTHETIC: solved with the truth plus the deterministic scatter of up to +-0.4 dB. fit = true applies the best per-material fit the walk suggests (the scene after
 * the dialog's Apply).
 */
export const TWO_WALLS = Object.freeze([{ name: 'Brick wall', material: 'brick', x: 15 }, { name: 'Plasterboard partition', material: 'drywall', x: 30 }]);
export const TWO_WALLS_TRUTH_DB = Object.freeze({ brick: 8, drywall: 3 }); // extra loss beyond the table value (assumed for the example)
export const TWO_WALLS_X = Object.freeze([6, 10, 13, 18, 21, 24, 27, 33, 38, 43, 48, 53, 58, 63]); // 3 clear, 4 behind the brick only, 7 behind both
export const ONE_WALL = Object.freeze([{ name: 'Brick wall', material: 'brick', x: 30 }]);
export const ONE_WALL_TRUTH_DB = Object.freeze({ brick: 9 });
export const ONE_WALL_X = Object.freeze([8, 12, 16, 20, 24, 27, 33, 38, 43, 48, 53, 58, 63]); // 6 clear, 7 behind the wall
function wallWalkScene({ walls, truthDb, xs, fit = false }) {
  const sc = make('mic', (s, l) => {
    s.stage = { width: 80, depth: 20 }; s.environment.floor = 'wood'; s.environment.model = 'free-space'; s.environment.bodyLossDb = 3;
    l.name = 'Bodypack walk test'; l.freqMHz = 606.1; l.tx.powerDbm = 10;
    l.tx.pos = { x: 3, y: 10, z: 1.2 }; l.tx.antenna = omni(); l.rx.antenna = omni(); l.rx.pos = { x: 40, y: 10, z: 1.5 }; l.rx.diversity.antennaB.pos = { x: 40, y: 9.4, z: 1.5 };
    s.reflectors = walls.map((w) => createReflector({ name: w.name, material: w.material, p1: { x: w.x, y: 0 }, p2: { x: w.x, y: 20 }, zMin: 0, zMax: 4 }));
  });
  const truthScene = { ...sc, environment: { ...sc.environment, wallLossAdjustByMaterialDb: { ...truthDb } } }, l = sc.links[0];
  sc.measurements = xs.map((x, i) => {
    const copy = JSON.parse(JSON.stringify(l)); copy.rx.pos = { x, y: 10, z: 1.5 };
    const dbm = solveLink(truthScene, copy).inputPowerDbm + measScatter(i);
    return { id: `meas${i + 1}`, linkId: l.id, x, y: 10, rxDbm: Math.round(dbm * 100) / 100 };
  });
  if (fit) { const g = suggestCalibration(sc); if (g.best) sc.environment[g.best.field.split('.')[1]] = g.best.fitted; }
  return sc;
}
/** twoWallsScene(variant): 'uncalibrated' = brick and plasterboard walls with table losses (readings are lower), 'calibrated' = the same after applying the per-material fit; 'one-wall' = a single brick wall (the readings step at it). */
export function twoWallsScene(variant = 'uncalibrated') {
  if (variant === 'one-wall') return wallWalkScene({ walls: ONE_WALL, truthDb: ONE_WALL_TRUTH_DB, xs: ONE_WALL_X });
  return wallWalkScene({ walls: TWO_WALLS, truthDb: TWO_WALLS_TRUTH_DB, xs: TWO_WALLS_X, fit: variant === 'calibrated' });
}
