// Example scenes: each builds a complete scene plus a short explanation. Pure (no DOM).
//   EXAMPLES: [{ id, title, note, build() -> { scene, walk?: { to, speedMps, pingPong }, select? } }]
//   getExample(id), buildExample(id) -> { id, title, note, scene, walk, selectId }
import { applyFmPreset } from './model/fm-presets.js';
import { createDefaultScene, createDefaultLink, createChainItem, createReflector, createBranch, createZone, createDefaultImd, createImdTransmitter, createPlatform, newId, syncScene } from './model/scene.js';

const omni = (el = 90) => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el } });

/** Base scene with a single link of the given kind; `fn(scene, link)` customises it. */
function make(kind, fn) {
  const scene = createDefaultScene();
  scene.environment.externalNoise = 0; // examples quote margins without external noise; a note or fn may set it on purpose
  scene.links = [createDefaultLink(kind)];
  fn(scene, scene.links[0]);
  if (scene.stage.heightM === undefined) scene.stage.heightM = 0;
  return syncScene(scene);
}

/** Two-ray geometry used by several examples: omni antennas over a hard floor, horizontal polarisation. */
function twoRay(scene, link) {
  scene.environment.floor = 'concrete';
  scene.environment.polarisation = 'horizontal';
  link.name = 'Mic 1';
  link.tx.antenna = omni();
  link.rx.antenna = omni();
  link.rx.pos = { x: 11, y: 6.5, z: 1.0 };
  link.tx.pos = { x: 8, y: 6.5, z: 1.75 };
  link.rx.squelch = { enabled: true, thresholdDbm: -42, hysteresisDb: 2 };
  link.rx.diversity.antennaB = { pos: { x: 11, y: 6.5, z: 1.4 }, antenna: null, chain: null, orientation: null }; // antenna null = same as antenna A, chain null = same cable run as A
}


/** Same stage, same 10 m link, same omni antennas and 5 m of RG58 on the receive side: only the carrier frequency differs. */
function sameStage(scene, link, freqMHz) {
  scene.environment.floor = 'wood';
  scene.environment.polarisation = 'vertical';
  link.freqMHz = freqMHz;
  link.tx.antenna = omni();
  link.rx.antenna = omni();
  link.tx.pos = { x: 1, y: 4, z: 1.5 };
  link.rx.pos = { x: 11, y: 4, z: 1.0 };
  link.rx.diversity.antennaB.pos = { x: 11, y: 3.4, z: 1.0 };
  link.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
}

const SAME_STAGE_WALK = { to: { x: 1, y: 4, z: 1.5 }, speedMps: 0.8, pingPong: true };

const ACROSS = { to: { x: 0.5, y: 6.5, z: 1.75 }, speedMps: 0.8, pingPong: true };

function outdoorIem(scene, link) {
  scene.stage = { width: 120, depth: 80 };
  link.tx.pos = { x: 115, y: 5, z: 1.2 };
  link.rx.pos = { x: 113, y: 6, z: 1.0 };
  link.rx.diversity.antennaB.pos = { x: 112.4, y: 6, z: 1.0 };
  link.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 }), createChainItem('attenuator', { lossDb: 35 })];
  link.rx.squelch = { enabled: true, thresholdDbm: -125, hysteresisDb: 3 };
}

function outdoorMic(scene, link) {
  scene.stage = { width: 120, depth: 80 };
  link.rx.pos = { x: 115, y: 5, z: 2.5 };
  link.rx.diversity.antennaB.pos = { x: 114.4, y: 5, z: 2.5 };
  link.tx.pos = { x: 113, y: 6, z: 1.5 };
  link.chain = [createChainItem('attenuator', { lossDb: 40 }), createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
  link.rx.squelch = { enabled: true, thresholdDbm: -104, hysteresisDb: 3 };
}

/** IEM combiner examples: a 30 x 20 m hall, transmitters together at the left, the bodypack far down the hall. */
function iemHall(s, l, m) {
  s.stage = { width: 30, depth: 20 };
  l.rx.pos = { x: 22, y: 12, z: 1.2 };
  m.rxAntennaPos = { x: 22, y: 12, z: 1.2 };
  m.rxAntenna = { type: 'omni', gainDbi: -3, orientation: { az: 0, el: 90 } };
  m.transmitters.forEach((t, i) => { t.pos = { x: 3 + i * 0.2, y: 10, z: 1.5 }; });
}

const OMNI_IMD = () => ({ type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } });

/** Intermodulation example: the link under test sits on `wantedMHz`, transmitters are [name, MHz, dBm, x, y, z]. */
function imdScene(kind, wantedMHz, txs, imdExtra, fn) {
  return make(kind, (s, l) => {
    l.freqMHz = wantedMHz;
    const m = createDefaultImd();
    m.enabled = true;
    m.rxAntennaPos = { ...l.rx.pos };
    m.rxAntenna = structuredClone(l.rx.antenna);
    m.transmitters = txs.map(([name, f, p, x, y, z]) => createImdTransmitter({ name, freqMHz: f, powerDbm: p, pos: { x, y, z }, ...(kind === 'iem' ? { antenna: OMNI_IMD() } : {}) }));
    Object.assign(m, imdExtra);
    s.imd = m;
    if (fn) fn(s, l, m);
  });
}

export const EXAMPLES = [
  {
    id: 'dropout-two-ray',
    title: 'Dropout at 7 m (two-ray null)',
    note: 'The direct ray and the floor reflection arrive half a wavelength apart at about 7 m, so they partly cancel and the level falls about 9 dB below what the direct ray alone would give. The squelch closes in the dip and the audio cuts out, then returns a metre or so further on.',
    build: () => ({ scene: make('mic', twoRay), walk: ACROSS }),
  },
  {
    id: 'diversity-null',
    title: 'Diversity: walking through a null',
    note: 'The second antenna is 0.4 m higher, so its null falls at a different distance. Whenever one antenna is in a fade the receiver uses the other, and the squelch stays open where a single antenna would drop out.',
    build: () => ({
      scene: make('mic', (s, l) => { twoRay(s, l); l.rx.diversity.enabled = true; l.rx.diversity.mode = 'true'; l.rx.diversity.hysteresisDb = 2; }),
      walk: ACROSS,
    }),
  },
  {
    id: 'diversity-modes',
    title: 'Diversity modes compared (switching vs true vs ratio)',
    note: 'Switching diversity changes antenna only after a hysteresis margin, true diversity always follows the stronger antenna, and ratio combining adds both signals and gains up to 3 dB. Change the mode in the diversity panel while the mic walks to compare.',
    build: () => ({
      scene: make('mic', (s, l) => { twoRay(s, l); l.rx.diversity.enabled = true; l.rx.diversity.mode = 'switching'; l.rx.diversity.hysteresisDb = 3; }),
      walk: ACROSS,
    }),
  },
  {
    id: 'overload-at-antenna',
    title: 'RF overload: mic held at the antenna',
    note: 'A handheld transmitter 30 cm from the receive antenna delivers far more power than the receiver front end can take. Compression and intermodulation distortion appear, and the receiver can lose the signal even though it is strong.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.powerDbm = 17;
        l.rx.pos = { x: 10, y: 6.5, z: 2.5 };
        l.tx.pos = { x: 9.7, y: 6.5, z: 2.5 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
      }),
    }),
  },
  {
    id: 'overload-fix',
    title: 'Overload fix: pad and distance',
    note: 'A 10 dB attenuator at the receiver input and two metres of separation bring the input level back inside the linear range. The same mic now sounds clean; compare the headroom with the previous example.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.powerDbm = 17;
        l.rx.pos = { x: 10, y: 6.5, z: 2.5 };
        l.tx.pos = { x: 8, y: 6.5, z: 2.5 };
        l.chain = [createChainItem('attenuator', { lossDb: 10 }), createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
      }),
    }),
  },
  {
    id: 'iem-stereo-mono',
    title: 'IEM: stereo to mono',
    note: 'As the bodypack walks away the carrier-to-noise ratio falls. The stereo difference signal sits higher in the noise than the sum, so the receiver blends towards mono first, and finally loses the stereo pilot.',
    build: () => ({
      scene: make('iem', (s, l) => { outdoorIem(s, l); }),
      walk: { to: { x: 10, y: 70, z: 1.0 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'pilot-vs-carrier-squelch',
    title: 'Pilot-tone squelch vs carrier squelch',
    note: 'The carrier squelch only looks at signal strength, so a weak but present carrier still opens it and you hear hiss. With pilot squelch on, the receiver also needs a locked 19 kHz pilot and mutes as soon as the pilot is lost.',
    build: () => ({
      scene: make('iem', (s, l) => { outdoorIem(s, l); l.mpx.pilotSquelch = true; }),
      walk: { to: { x: 10, y: 70, z: 1.0 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'long-cable',
    title: 'Long cable run loss',
    note: 'A 100 m run of thin coax costs over forty decibels at UHF (42.5 dB for this RG58 run), which leaves only about 5 dB of margin. Try LMR-400 instead, or put a booster near the antenna: loss before the first gain stage hurts most.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.units = { power: 'dBm', length: 'ft' };
        l.tx.pos = { x: 1, y: 1, z: 1.5 };
        l.tx.powerDbm = 10;
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 100 }), createChainItem('connector', { lossDb: 0.3 })];
        l.rx.squelch = { enabled: true, thresholdDbm: -100, hysteresisDb: 3 };
      }),
    }),
  },
  {
    id: 'reflective-wall',
    title: 'Reflective wall multipath',
    note: 'A metal wall behind the receiver adds extra reflected paths. They add and cancel with the direct ray, so the level ripples as the mic moves. A dip appears each time a reflected path changes by one wavelength (0.5 m), but walking across the room changes the path difference only slowly, so along this walk the deep dips are about 2.5 m apart rather than a fraction of a wavelength.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.reflectors = [createReflector({ id: newId('refl'), name: 'Metal wall', material: 'metal', p1: { x: 0.5, y: 7.9 }, p2: { x: 11.5, y: 7.9 }, zMin: 0, zMax: 4 })];
        l.tx.pos = { x: 1, y: 3, z: 1.5 };
        l.rx.pos = { x: 10, y: 6.5, z: 2.5 };
      }),
      walk: { to: { x: 9, y: 2, z: 1.5 }, speedMps: 0.5, pingPong: true },
    }),
  },
  {
    id: 'battery-fade',
    title: 'Battery fade: TX power sag mutes the link',
    note: 'As the transmitter batteries run down their voltage falls below the regulator limit and the output power sags. The received level drops with it until the squelch closes, even though nothing has moved. Time is sped up here; pause or reset the battery in the toolbar.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.pos = { x: 4, y: 3, z: 1.5 };
        l.rx.squelch = { enabled: true, thresholdDbm: -55, hysteresisDb: 3 };
        l.telemetry.battery = { chemistry: 'alkaline-aa-x2', startPercent: 40, timeScale: 1200, running: true };
      }),
    }),
  },
  {
    id: 'telemetry-before-audio',
    title: 'Telemetry drops before audio',
    note: 'The telemetry data channel needs a cleaner signal than the audio does, so battery and status readings go stale first while the audio is still usable. Walk the mic away and watch the telemetry panel before the squelch closes.',
    build: () => ({
      scene: make('mic', (s, l) => { outdoorMic(s, l); l.telemetry.preset = 'rds-like'; }),
      walk: { to: { x: 10, y: 70, z: 1.5 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'digital-vs-analog',
    title: 'Digital vs analog: graceful vs cliff',
    note: 'Walk away with the link in digital mode: quality stays perfect, then drops off a cliff within a few decibels. Switch the modulation to analog FM in the toolbar and repeat: the analog audio only gets gradually noisier before it finally closes.',
    build: () => ({
      scene: make('iem', (s, l) => { outdoorIem(s, l); l.modulation.type = 'digital'; l.rx.squelch.thresholdDbm = -120; }),
      walk: { to: { x: 10, y: 70, z: 1.0 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'adaptive-modulation',
    title: 'Adaptive modulation: 256-QAM down to QPSK',
    note: 'Close to the transmitter the link runs 256-QAM for maximum data rate. As the signal weakens the receiver steps down through 64-QAM and 16-QAM to QPSK, trading rate for robustness, and only then drops out.',
    build: () => ({
      scene: make('iem', (s, l) => {
        outdoorIem(s, l);
        l.modulation = { type: 'digital', digital: { preset: 'wideband-adaptive', fixedOrder: null, overrides: {} } };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 }), createChainItem('attenuator', { lossDb: 25 })];
        l.rx.squelch = { enabled: true, thresholdDbm: -120, hysteresisDb: 3 };
      }),
      walk: { to: { x: 10, y: 70, z: 1.0 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'digital-cuts-out',
    title: 'Why digital cuts out instead of getting noisy',
    note: 'Error correction hides bit errors completely until there are too many to fix, then it fails abruptly. The receiver repeats the last frame for a moment to hide the gap and then mutes. Compare this with the slow noise build-up of the analog example.',
    build: () => ({
      scene: make('mic', (s, l) => {
        outdoorMic(s, l);
        l.modulation = { type: 'digital', digital: { preset: 'mic-qpsk-fixed', fixedOrder: null, overrides: {} } };
        l.rx.squelch = { enabled: true, thresholdDbm: -120, hysteresisDb: 3 };
      }),
      walk: { to: { x: 10, y: 70, z: 1.5 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'constellation-noise',
    title: 'Constellation noise: moving the mic',
    note: 'With the constellation order held at 64-QAM, the cloud of received symbols around each ideal point grows as the mic moves away. When the clouds start to overlap the error rate climbs and the link falls over.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.modulation = { type: 'digital', digital: { preset: 'wideband-adaptive', fixedOrder: 64, overrides: {} } };
        l.tx.pos = { x: 9, y: 6, z: 1.5 };
        l.chain = [createChainItem('attenuator', { lossDb: 46 }), createChainItem('cable', { cableType: 'rg58', lengthM: 10 })];
        l.rx.squelch = { enabled: true, thresholdDbm: -120, hysteresisDb: 3 };
      }),
      walk: { to: { x: 0.5, y: 0.5, z: 1.5 }, speedMps: 0.6, pingPong: true },
    }),
  },
  {
    id: 'zones-dead-spot',
    title: 'Two antennas: covering a dead spot behind a wall',
    note: 'A heavy wall splits the venue in two. With one transmit antenna the room behind the wall is a dead spot; a second antenna on the far side, fed through a splitter from the same transmitter, covers it. Remove or move antenna 2 and watch the zone fail.',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 24, depth: 12 };
        s.reflectors = [createReflector({ id: newId('refl'), name: 'Dividing wall', material: 'concrete', p1: { x: 12, y: 0 }, p2: { x: 12, y: 12 }, zMin: 0, zMax: 4, transmissionLossDb: 55 })];
        l.tx.pos = { x: 3, y: 6, z: 2.5 };
        l.rx.pos = { x: 6, y: 6, z: 1.5 };
        l.chain = [createChainItem('cable', { cableType: 'lmr-400', lengthM: 10 })];
        s.zones = [createZone({ id: newId('zone'), name: 'Room behind the wall', polygon: [{ x: 14, y: 2 }, { x: 22, y: 2 }, { x: 22, y: 10 }, { x: 14, y: 10 }], zMin: 0, zMax: 2, requiredMarginDb: 10 })];
        l.branches = [{}, createBranch({ name: 'Antenna 2', pos: { x: 20, y: 6, z: 2.5 }, chain: [createChainItem('cable', { cableType: 'lmr-400', lengthM: 30 })] })];
      }),
    }),
  },
  {
    id: 'zones-long-hall',
    title: 'Long distance: antenna at the far end of a hall with a booster',
    note: 'A long cable to a far antenna loses more than the antenna can make up, so the far end of the hall is weak. A 24 dB booster after the cable on that branch brings the far zone up to its required level (with only 20 dB, about a third of the zone still falls short). Compare the map with and without the booster in the branch chain.',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 60, depth: 20 };
        l.tx.pos = { x: 3, y: 10, z: 2.5 };
        l.tx.powerDbm = -14;
        l.rx.pos = { x: 30, y: 10, z: 1.5 };
        l.chain = [createChainItem('cable', { cableType: 'lmr-400', lengthM: 5 })];
        s.zones = [createZone({ id: newId('zone'), name: 'Far end', polygon: [{ x: 44, y: 4 }, { x: 58, y: 4 }, { x: 58, y: 16 }, { x: 44, y: 16 }], zMin: 0, zMax: 2, requiredMarginDb: 10 })];
        l.branches = [{}, createBranch({ name: 'Far antenna', pos: { x: 56, y: 10, z: 2.5 },
          chain: [createChainItem('cable', { cableType: 'lmr-400', lengthM: 80 }), createChainItem('booster', { gainDb: 24 })] })];
      }),
    }),
  },
  {
    id: 'zones-coherent-nulls',
    title: 'Coherent overlap nulls: two antennas too close together',
    note: 'Two antennas fed from one transmitter carry the same signal. Where their waves arrive in opposite phase they cancel, giving a pattern of dead stripes. Spacing the antennas apart, or adding a small attenuator to one, reduces the depth of the nulls.',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 16, depth: 10 };
        s.coverage = { mode: 'coherent' };
        l.tx.pos = { x: 7, y: 2, z: 2.5 };
        l.rx.pos = { x: 8, y: 6, z: 1.5 };
        l.tx.antenna = { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 10 })];
        l.branches = [{}, createBranch({ name: 'Antenna 2', pos: { x: 8.5, y: 2, z: 2.5 }, antenna: { type: 'omni', gainDbi: 0, orientation: { az: 0, el: 90 } },
          chain: [createChainItem('cable', { cableType: 'rg58', lengthM: 10 })] })];
      }),
    }),
  },
  {
    id: 'zones-backstage-corridor',
    title: 'Zone check: backstage corridor',
    note: 'The backstage corridor needs reliable IEM coverage with 10 dB of margin. The zone table shows the worst point and the share of the corridor that passes; the suggestions list what would help most, such as moving an antenna or adding gain.',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 24, depth: 12 };
        s.reflectors = [createReflector({ id: newId('refl'), name: 'Backstage wall', material: 'brick', p1: { x: 0, y: 8 }, p2: { x: 24, y: 8 }, zMin: 0, zMax: 4, transmissionLossDb: 40 })];
        l.tx.pos = { x: 4, y: 4, z: 2.5 };
        l.rx.pos = { x: 12, y: 3, z: 1.5 };
        l.chain = [createChainItem('cable', { cableType: 'lmr-400', lengthM: 10 })];
        s.zones = [createZone({ id: newId('zone'), name: 'Backstage corridor', polygon: [{ x: 1, y: 9.5 }, { x: 23, y: 9.5 }, { x: 23, y: 11 }, { x: 1, y: 11 }], zMin: 0, zMax: 2, requiredMarginDb: 10 })];
        l.branches = [{}, createBranch({ name: 'Antenna 2', pos: { x: 12, y: 9, z: 2.5 }, chain: [createChainItem('cable', { cableType: 'lmr-400', lengthM: 20 })] })];
      }),
    }),
  },
  {
    id: 'imd-too-close',
    title: 'Two mics too close to the receive antenna',
    note: 'Mics B and C are held next to the receive antenna, so each arrives far stronger than the wanted mic A. The level meter shows the own transmitter of the link (about -46 dBm); in the intermod panel mic A is about -40 dBm at the antenna. The receiver front end is not perfectly linear and mixes them: twice B minus C lands exactly on the channel of mic A and buries it. The squelch closes with the reason intermod.',
    build: () => ({
      scene: imdScene('mic', 605.6, [
        ['Mic A (wanted)', 605.6, 14, 2, 3, 1.5], ['Mic B', 606.0, 14, 9.5, 6.5, 2.0], ['Mic C', 606.4, 14, 9.3, 6.0, 2.0], ['Mic D', 607.2, 14, 6, 2, 1.5],
      ], {}),
    }),
  },
  {
    id: 'imd-iem-no-isolation',
    title: 'IEM combiner with no isolation',
    note: 'Three IEM transmitters share a simple passive combiner with only 15 dB of isolation. Each one leaks a little of the others back into its own output stage, where the amplifier mixes them. Twice 606.0 minus 606.4 lands on 605.6, the channel of the third transmitter, as a spurious signal radiated from the antenna.',
    build: () => ({
      scene: imdScene('iem', 605.6, [
        ['IEM A (wanted)', 605.6, 10, 1.0, 1.0, 1.5], ['IEM B', 606.0, 10, 1.2, 1.0, 1.5], ['IEM C', 606.4, 10, 1.4, 1.0, 1.5],
      ], { preset: 'iem-combiner-no-isolation', iip3Dbm: 10, combiner: { type: 'hybrid', isolationDb: 15, lossDb: 3.5 } }, iemHall),
    }),
  },
  {
    id: 'imd-iem-isolators',
    title: 'IEM combiner with isolators: same transmitters',
    note: 'The same three transmitters, now through an isolated combiner with circulators. Each interferer is knocked down by 50 dB before it reaches the other amplifiers, so the reverse intermodulation falls by about the same amount.',
    build: () => ({
      scene: imdScene('iem', 605.6, [
        ['IEM A (wanted)', 605.6, 10, 1.0, 1.0, 1.5], ['IEM B', 606.0, 10, 1.2, 1.0, 1.5], ['IEM C', 606.4, 10, 1.4, 1.0, 1.5],
      ], { preset: 'iem-combiner-isolated', iip3Dbm: 10, combiner: { type: 'isolated', isolationDb: 50, lossDb: 2 } }, iemHall),
    }),
  },
  {
    id: 'imd-move-apart',
    title: 'Move them apart: intermods fall',
    note: 'Same four frequencies as the first intermod example, but the mics are now 8 to 9 metres from the receive antenna. The products fall three decibels for every decibel the carriers fall, so even this small increase in distance leaves the wanted channel clean. Drag a mic towards the antenna and watch it return.',
    build: () => ({
      scene: imdScene('mic', 605.6, [
        ['Mic A (wanted)', 605.6, 14, 2, 3, 1.5], ['Mic B', 606.0, 14, 2.0, 6.5, 1.5], ['Mic C', 606.4, 14, 2.5, 2.0, 1.5], ['Mic D', 607.2, 14, 3, 4, 1.5],
      ], {}),
    }),
  },
  {
    id: 'imd-pim',
    title: 'Rusty connector: PIM',
    note: 'Two 20 W transmitters sit side by side behind an isolated combiner and the receiver is linear, which holds active intermod at the wanted channel to about -114 dBm. The product made passively by the antenna-line connector is -118 dBm for a corroded connector and -153 dBm for a good one: 35 dB apart. At this power that product stays below the noise from the transmitters themselves (about -103 dBm), so the noise rise is the same for both; passive intermod only starts to matter at much higher power, where it grows three times faster than the carriers.',
    build: () => ({
      scene: imdScene('mic', 604.0, [
        ['Receiver mic (wanted)', 604.0, 0, 24, 12, 1.5], ['High-power TX 1', 606.0, 43, 2, 10, 2.5], ['High-power TX 2', 608.0, 43, 3, 10, 2.5],
      ], { preset: 'pim-corroded-connector', iip3Dbm: 30, combiner: { type: 'isolated', isolationDb: 70, lossDb: 2 }, pim: { preset: 'corroded', levelDbc: null } }, (s, l, m) => {
        s.stage = { width: 40, depth: 20 };
        l.rx.pos = { x: 27, y: 10, z: 2.5 };
        m.rxAntennaPos = { x: 27, y: 10, z: 2.5 };
      }),
    }),
  },
  {
    id: 'imd-plan-bad',
    title: 'Intermod-free frequency plan vs a bad plan',
    note: 'Four transmitters equally spaced by 400 kHz: nearly every third-order product lands on the channel of another transmitter. Retune them to 606.000, 606.500, 610.200 and 611.700 MHz: no third- or fifth-order product then lands within 500 kHz of any channel centre, so the coordination check clears and the 400 kHz clearance rule is met.',
    build: () => ({
      scene: imdScene('mic', 606.4, [
        ['Mic A', 606.0, 14, 9.0, 6.0, 1.5], ['Mic B', 606.4, 14, 9.2, 7.2, 1.5], ['Mic C', 606.8, 14, 8.8, 5.2, 1.5], ['Mic D', 607.2, 14, 9.4, 5.6, 1.5],
      ], {}),
    }),
  },
  {
    id: 'cascade-booster-antenna',
    title: 'Cascaded noise figure: booster at the antenna',
    note: 'A 20 dB booster at the antenna comes first in the chain, so the 25.5 dB of cable loss after it adds little noise: the system noise figure is 13.9 dB and the link has 12 dB of margin. Compare with the same parts the other way round in the next example.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.pos = { x: 1, y: 1, z: 1.5 };
        l.tx.powerDbm = -20;
        l.chain = [createChainItem('booster', { gainDb: 20, nfDb: 3 }), createChainItem('cable', { cableType: 'rg58', lengthM: 60 })];
        l.rx.squelch = { enabled: true, thresholdDbm: -100, hysteresisDb: 3 };
      }),
    }),
  },
  {
    id: 'cascade-booster-rack',
    title: 'Cascaded noise figure: booster at the rack',
    note: 'The same booster and cable, but the booster sits at the rack after the long cable. The cable loss now comes first and adds its full 25.5 dB to the noise figure, giving 28.6 dB overall. The received power is identical, but the link margin falls to about -3 dB and the link fails.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.pos = { x: 1, y: 1, z: 1.5 };
        l.tx.powerDbm = -20;
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 60 }), createChainItem('booster', { gainDb: 20, nfDb: 3 })];
        l.rx.squelch = { enabled: true, thresholdDbm: -100, hysteresisDb: 3 };
      }),
    }),
  },
  {
    id: 'stray-carrier-pilot',
    title: 'Stray carrier: pilot squelch rejects it',
    note: 'An unmodulated stray carrier arrives 8 dB stronger than the wanted signal. A carrier squelch only looks at signal strength, so it opens on the stray carrier and the wanted audio is lost to capture. With pilot squelch on, the receiver also needs the wanted 19 kHz pilot, which the stray carrier does not have, so the gate stays shut.',
    build: () => ({
      scene: make('iem', (s, l) => {
        outdoorIem(s, l);
        l.rx.squelch = { enabled: true, thresholdDbm: -100, hysteresisDb: 3 };
        l.mpx.pilotSquelch = true;
        l.rx.pos = { x: 105, y: 6, z: 1.0 };
        l.interferer = { enabled: true, levelDbm: -81.5, hasPilot: false, offsetKHz: 0 };
      }),
    }),
  },
  {
    id: 'battery-gauge',
    title: 'Battery gauge: reported vs true',
    note: 'The transmitter estimates its battery from the voltage under load. With two alkaline cells that is a poor guide: at 50 % true charge the gauge reads 22 %, and at 30 % it already shows empty while the transmitter still runs at full power. Press Battery: Start to watch the reading fall long before the output power sags.',
    build: () => ({
      scene: make('mic', (s, l) => {
        l.tx.pos = { x: 4, y: 3, z: 1.5 };
        l.telemetry.battery = { chemistry: 'alkaline-aa-x2', startPercent: 50, timeScale: 600, running: false };
      }),
    }),
  },
  {
    id: 'wall-thickness',
    title: 'Wall thickness: thin vs thick concrete',
    note: 'The dividing wall is concrete, 0.1 m thick in its upper half and 0.4 m in its lower half. Wall loss grows with thickness (concrete costs 8 dB per 0.1 m), so the room behind the thin part is covered (weakest point -70 dBm against -75 dBm required) and the room behind the thick part is not (weakest -94 dBm). Change the thickness of a wall segment to see the zone result change.',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 24, depth: 12 };
        s.reflectors = [
          createReflector({ id: newId('refl'), name: 'Wall, thin section', material: 'concrete', p1: { x: 12, y: 6 }, p2: { x: 12, y: 12 }, zMin: 0, zMax: 4, thicknessM: 0.1 }),
          createReflector({ id: newId('refl'), name: 'Wall, thick section', material: 'concrete', p1: { x: 12, y: 0 }, p2: { x: 12, y: 6 }, zMin: 0, zMax: 4, thicknessM: 0.4 }),
        ];
        l.tx.pos = { x: 3, y: 6, z: 2.5 };
        l.rx.pos = { x: 6, y: 6, z: 1.5 };
        l.tx.powerDbm = 0;
        l.chain = [createChainItem('cable', { cableType: 'lmr-400', lengthM: 10 })];
        s.zones = [
          createZone({ id: newId('zone'), name: 'Behind the thin wall', polygon: [{ x: 14, y: 7 }, { x: 22, y: 7 }, { x: 22, y: 11 }, { x: 14, y: 11 }], zMin: 0, zMax: 2, requiredMarginDb: 10 }),
          createZone({ id: newId('zone'), name: 'Behind the thick wall', polygon: [{ x: 14, y: 1 }, { x: 22, y: 1 }, { x: 22, y: 5 }, { x: 14, y: 5 }], zMin: 0, zMax: 2, requiredMarginDb: 10 }),
        ];
      }),
    }),
  },
  {
    id: 'diversity-cable-runs',
    title: 'Diversity with different cable runs',
    note: 'Antenna A has a short 5 m cable run (2.1 dB loss); antenna B is on a 40 m run of RG58 with a 6 dB booster at the antenna end (11.0 dB net loss). B therefore arrives about 9 dB below A, and with switching diversity the receiver stays on A and moves to B only while A is in its fade, around 7 m (A -41 dBm, B -38 dBm). Remove the booster and B is rarely chosen.',
    build: () => ({
      scene: make('mic', (s, l) => {
        twoRay(s, l);
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
        l.rx.diversity.enabled = true;
        l.rx.diversity.mode = 'switching';
        l.rx.diversity.hysteresisDb = 3;
        l.rx.diversity.antennaB.chain = [createChainItem('booster', { gainDb: 6, nfDb: 3 }), createChainItem('cable', { cableType: 'rg58', lengthM: 40 })];
      }),
      walk: ACROSS,
    }),
  },
  {
    id: 'raised-stage-null',
    title: 'Raised stage: deck 1.2 m changes the dropout positions',
    note: 'The receiver antenna stands on the floor in front of the stage and the mic walks on a deck 1.2 m high. The mic is now nearly 3 m above the reflecting floor instead of 1.75 m, so the cancellation moves: the dip that sits at 6.8 m with a ground-level stage (-46 dBm) falls at about 5.1 m on the deck and is shallower (-41 dBm), so the squelch that closes at 6.8 m on the ground stays open here. Set the deck height to 0 to compare.',
    build: () => ({
      scene: make('mic', (s, l) => {
        twoRay(s, l);
        s.stage.heightM = 1.2;
        l.rx.pos = { x: 6, y: 12, z: 1.0 };
        l.tx.pos = { x: 6, y: 7.5, z: 1.75 };
        l.rx.squelch = { enabled: true, thresholdDbm: -42, hysteresisDb: 1 };
        l.rx.diversity.antennaB.pos = { x: 6, y: 12, z: 1.4 };
      }),
      walk: { to: { x: 6, y: 1, z: 1.75 }, speedMps: 0.8, pingPong: true },
    }),
  },
  {
    id: 'drum-riser',
    title: 'Drum riser on a stage: a stage on a stage',
    note: 'A 1.2 m deck carries a 0.4 m drum riser, and the IEM bodypack is worn on the riser while the transmit antenna stands on the deck. Heights are measured from the local floor, so the bodypack is 1.0 m above the riser top. The floor bounce now reflects from the riser instead of the deck: that ray is about 16.3 dB weaker than over a bare deck (-43.2 dB against -27.0 dB relative to the direct ray), while the total level barely moves (-36.0 dBm against -36.1 dBm).',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 12, depth: 8, heightM: 1.2 };
        s.environment.floor = 'wood';
        s.environment.polarisation = 'vertical';
        l.tx.antenna = OMNI_IMD();
        l.tx.pos = { x: 1, y: 1, z: 2.5 };
        l.rx.antenna = { type: 'omni', gainDbi: -3, orientation: { az: 0, el: 90 } };
        l.rx.pos = { x: 8, y: 4, z: 1.0 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 10 })];
        s.platforms = [createPlatform({ id: newId('plat'), name: 'Drum riser', x: 7, y: 3, width: 2.5, depth: 2, topM: 1.6, material: 'wood' })];
      }),
    }),
  },
  {
    id: 'audience-vs-stage',
    title: 'Audience level receiver vs raised stage',
    note: 'The receiver antenna is on the floor in front of the audience and the mic is on a 1.5 m stage. The raised stage changes the geometry: the level falls from -36.6 dBm for a ground-level stage to -38.5 dBm. A 1.4 m tall, 0.6 m deep wooden riser in front of the mic then blocks part of the direct ray and costs another 3.6 dB (-42.1 dBm); a metal one would cost 5.8 dB.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.stage = { width: 12, depth: 8, heightM: 1.5 };
        s.environment.floor = 'concrete';
        s.environment.polarisation = 'vertical';
        l.tx.antenna = omni();
        l.rx.antenna = omni();
        l.tx.pos = { x: 6, y: 4, z: 1.5 };
        l.rx.pos = { x: 6, y: 14, z: 1.0 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 10 })];
        s.platforms = [createPlatform({ id: newId('plat'), name: 'Front-of-house riser', x: 4.5, y: 5.4, width: 3, depth: 0.6, topM: 2.9, material: 'wood' })];
      }),
    }),
  },
  {
    id: 'band-vhf',
    title: 'Same stage at VHF (200 MHz)',
    note: 'The same 10 m link, with the same omni antennas and 5 m of RG58, at 200 MHz. Free-space loss is 38.5 dB (effective 39.0 dB with the floor bounce) and the cable costs only 1.1 dB, so the margin is 68.9 dB. Compare the UHF and 2.4 GHz versions of this stage.',
    build: () => ({ scene: make('mic', (s, l) => sameStage(s, l, 200)), walk: SAME_STAGE_WALK }),
  },
  {
    id: 'band-uhf',
    title: 'Same stage at UHF (600 MHz)',
    note: 'The same link at 600 MHz: free-space loss rises to 48.0 dB (effective 46.0 dB) and the cable costs 2.1 dB, so the margin is 60.8 dB. Doubling the frequency twice more would add another 12 dB of free-space loss, with antennas of equal gain.',
    build: () => ({ scene: make('mic', (s, l) => sameStage(s, l, 600)), walk: SAME_STAGE_WALK }),
  },
  {
    id: 'band-2g4',
    title: 'Same stage at 2.4 GHz',
    note: 'The same link at 2.4 GHz: free-space loss is 60.1 dB (effective 58.4 dB), 21.6 dB more than at 200 MHz, and the cable costs 5.4 dB, so the margin is 45.2 dB. The shorter wavelength also makes the multipath pattern finer as the mic moves, and the transmit power is 14 dBm in all three versions so only frequency differs; a UK audio PMSE 2.4 GHz system is limited to 10 mW EIRP (draft IR 2030), about 4 dB less.',
    build: () => ({ scene: make('mic', (s, l) => sameStage(s, l, 2400)), walk: SAME_STAGE_WALK }),
  },
  {
    id: 'wifi-busy-2g4',
    title: '2.4 GHz link in a busy Wi-Fi venue',
    note: 'A 2.4 GHz link 104 m across a venue with busy Wi-Fi, 10 dB fade margin and a 10 dBm (10 mW) transmitter, the UK audio PMSE limit (draft IR 2030). Busy Wi-Fi raises the noise floor by about 20 dB at 2.4 GHz (to -87.6 dBm), which turns an 11.2 dB margin into -8.8 dB: a fail. At 5.8 GHz the same venue would add only about 12 dB. Set the interference option to None and the same link passes; the signal level has not changed, only the noise floor.',
    build: () => ({
      scene: make('mic', (s, l) => {
        sameStage(s, l, 2400);
        s.stage = { width: 120, depth: 24 };
        l.tx.powerDbm = 10;
        l.tx.pos = { x: 8, y: 12, z: 1.5 };
        l.rx.pos = { x: 112, y: 12, z: 1.0 };
        l.rx.diversity.antennaB.pos = { x: 112, y: 11.4, z: 1.0 };
        s.environment.fadeMarginDb = 10;
        s.environment.interference = 'busy';
      }),
      walk: { to: { x: 8, y: 12, z: 1.5 }, speedMps: 2, pingPong: true },
    }),
  },
  {
    id: 'ur4d-style-link',
    title: 'Analogue FM link, UR4D-style receiver (assumed figures)',
    note: 'A 50 mW handheld at 590 MHz feeds a receiver set up from published UR4D-class figures; the quoted -102 dBm at 30 dB SINAD is used as the sensitivity, so the margin is 65.5 dB across 15 m. Walk the transmitter towards the receiver: the input reaches -30 dBm (hot, the top of the rated range) at about 8 m and passes the -25 dBm overload level at about 3.5 m (multipath ripples move both points), where the front end is flagged overloaded even though the margin is highest. Keep transmitters well away from the receiver antennas. Based on published specs, some figures (noise figure, squelch threshold, band edges) are assumed.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.stage = { width: 20, depth: 12 };
        s.environment.floor = 'wood';
        l.freqMHz = 590;
        l.tx.antenna = omni();
        l.rx.antenna = omni();
        l.tx.pos = { x: 2, y: 6, z: 1.5 };
        l.rx.pos = { x: 17, y: 6, z: 2 };
        l.rx.diversity.antennaB.pos = { x: 17, y: 5.4, z: 2 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
        Object.assign(l, applyFmPreset(l, 'shure-ur2', { powerOptionId: 'hi-50mw' }));
        Object.assign(l, applyFmPreset(l, 'shure-ur4d'));
      }),
      walk: { to: { x: 15, y: 6, z: 1.5 }, speedMps: 1.2, pingPong: true },
    }),
  },
  {
    id: 'skm-low-intermod',
    title: 'Four analogue FM mics, standard mode (SKM 5200-II class, assumed figures)',
    note: 'Four 10 mW handhelds share a hybrid combiner with 25 dB isolation, and Mic A and Mic B beat to a product at 605.7 MHz, exactly on Mic C: the worst channel sees its noise floor rise by 20.3 dB. Switching all four to the low-intermod mode lowers the transmitter-side product by an assumed 6 dB and the worst rise to 14.8 dB. The 6 dB is an assumption standing in for a trade-report claim of about 30 percent more compatible channels. Based on published specs, some figures assumed.',
    build: () => ({
      scene: make('mic', (s) => {
        s.stage = { width: 16, depth: 10 };
        const ant = { type: 'body', gainDbi: -3, orientation: { az: 0, el: 90 } };
        const plan = [[606.1, 'Mic A', 3, 3], [606.5, 'Mic B', 5, 6], [605.7, 'Mic C', 9, 4], [607.4, 'Mic D', 6, 8]];
        s.imd = {
          enabled: true, preset: 'iem-combiner-no-isolation',
          transmitters: plan.map(([f, name, x, y]) => createImdTransmitter({ name, freqMHz: f, powerDbm: 10, pos: { x, y, z: 1.5 }, antenna: ant, fmPreset: 'sennheiser-skm5200ii', lowIntermod: false })),
          rxAntennaPos: { x: 14, y: 5, z: 2.5 }, rxAntenna: { type: 'paddle', gainDbi: 2, orientation: { az: 270, el: 0 } },
          combiner: { type: 'hybrid', isolationDb: 25, lossDb: 3.5 }, pim: { preset: 'none', levelDbc: null },
          channelBwKHz: 200, wantedFreqMHz: null,
        };
      }),
    }),
  },
  {
    id: 'fm-deviation-compare',
    title: 'FM deviation compared: +-40, +-45, +-75 and +-12.5 kHz (assumed figures)',
    note: 'The same link and the same 15 kHz audio at a -80 dBm input: Carson bandwidth is 110 kHz at +-40 kHz (SKM 5200-II class), 120 kHz at +-45 kHz (UR4D class), 180 kHz for +-75 kHz broadcast FM and 31 kHz for +-12.5 kHz narrowband two-way (3 kHz audio, so not directly comparable). Above threshold the audio SNR rises 20 log10 of the deviation ratio, 1.0 dB for +-45 and 5.5 dB for +-75 kHz against +-40 kHz, while the threshold CNR stays near 10 dB and the threshold input level rises from -107.6 to -105.4 dBm. All fit a 200 kHz channel (broadcast uses 90 percent) and leave a 220 to 290 kHz gap to a neighbour 400 kHz away, where the receiver rejection is 75 dB. Deviation of the broadcast and narrowband systems, the audio bandwidths, the receiver noise figure and the absence of a tone-key above the audio are assumed.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.stage = { width: 20, depth: 12 };
        s.environment.floor = 'wood';
        l.freqMHz = 600;
        l.tx.antenna = omni();
        l.rx.antenna = omni();
        l.tx.pos = { x: 2, y: 6, z: 1.5 };
        l.rx.pos = { x: 17, y: 6, z: 2 };
        l.rx.diversity.antennaB.pos = { x: 17, y: 5.4, z: 2 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
        Object.assign(l, applyFmPreset(l, 'sennheiser-skm5200ii'));
        Object.assign(l, applyFmPreset(l, 'sennheiser-em3732ii'));
      }),
    }),
  },
  {
    id: 'fm-deviation-g3-vs-skm',
    title: 'Deviation compared: +-24 (G3 / 2000 class), +-40 and +-45 kHz (assumed figures)',
    note: 'Three analogue FM systems carry the same 15 kHz audio at a -80 dBm input, compared at nominal deviation: the Sennheiser G3 / 2000 class at +-24 kHz needs 78 kHz of Carson bandwidth, the SKM 5200-II class at +-40 kHz needs 110 kHz and the UR4D class at +-45 kHz needs 120 kHz. Above threshold the audio SNR is 4.4 dB better at +-40 kHz and 5.5 dB better at +-45 kHz than at +-24 kHz (20 log10 of the deviation ratio), at the price of a threshold input level that rises from -109.1 to -107.6 and -107.2 dBm. All three use at most 60 percent of a 200 kHz channel and leave 322, 290 and 280 kHz to a neighbour 400 kHz away. Peak deviation of the G3 is twice its nominal figure, so its real occupied bandwidth is wider than this nominal estimate; the 15 kHz audio bandwidth, the receiver noise figure and the nominal-deviation reading are assumed.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.stage = { width: 20, depth: 12 };
        s.environment.floor = 'wood';
        l.freqMHz = 590;
        l.tx.antenna = omni();
        l.rx.antenna = omni();
        l.tx.pos = { x: 2, y: 6, z: 1.5 };
        l.rx.pos = { x: 17, y: 6, z: 2 };
        l.rx.diversity.antennaB.pos = { x: 17, y: 5.4, z: 2 };
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 5 })];
        Object.assign(l, applyFmPreset(l, 'sennheiser-sk300g3'));
        Object.assign(l, applyFmPreset(l, 'sennheiser-em300g3'));
      }),
    }),
  },
];

export const getExample = (id) => EXAMPLES.find((e) => e.id === id) || null;

/** buildExample(id) -> { id, title, note, scene, walk, selectId } or null for an unknown id. */
export function buildExample(id) {
  const ex = getExample(id);
  if (!ex) return null;
  const { scene, walk = null } = ex.build();
  return { id: ex.id, title: ex.title, note: ex.note, scene, walk, selectId: scene.links[0] ? scene.links[0].tx.id : null };
}
