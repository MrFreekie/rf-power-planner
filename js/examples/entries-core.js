// EXAMPLES entries: core propagation, overload, digital and coverage-zone examples.
import { createChainItem, createReflector, createBranch, createZone, newId } from '../model/scene.js';
import { make, twoRay, ACROSS, outdoorIem, outdoorMic } from './helpers.js';

export const CORE_EXAMPLES = [
  {
    id: 'dropout-two-ray',
    title: 'Dropout at 7 m (two-ray null)',
    note: 'Problem: the direct ray and the floor reflection arrive half a wavelength apart at about 7 m, so they partly cancel and the level falls about 9 dB below what the direct ray alone would give. The squelch closes in the dip and the audio cuts out, then returns a metre or so further on.',
    build: () => ({ scene: make('mic', twoRay), walk: ACROSS }),
  },
  {
    id: 'diversity-null',
    title: 'Diversity: walking through a null',
    note: 'Best practice: the second antenna is 0.4 m higher, so its null falls at a different distance. Whenever one antenna is in a fade the receiver uses the other, and the squelch stays open where a single antenna would drop out.',
    build: () => ({
      scene: make('mic', (s, l) => { twoRay(s, l); l.rx.diversity.enabled = true; l.rx.diversity.mode = 'true'; l.rx.diversity.hysteresisDb = 2; }),
      walk: ACROSS,
    }),
  },
  {
    id: 'diversity-modes',
    title: 'Diversity modes compared (switching vs true vs ratio)',
    note: 'Compare: switching diversity changes antenna only after a hysteresis margin, true diversity always follows the stronger antenna, and ratio combining adds both signals and gains up to 3 dB. Change the mode in the diversity panel while the mic walks to compare.',
    build: () => ({
      scene: make('mic', (s, l) => { twoRay(s, l); l.rx.diversity.enabled = true; l.rx.diversity.mode = 'switching'; l.rx.diversity.hysteresisDb = 3; }),
      walk: ACROSS,
    }),
  },
  {
    id: 'overload-at-antenna',
    title: 'RF overload: mic held at the antenna',
    note: 'Problem: a handheld transmitter 30 cm from the receive antenna delivers far more power than the receiver front end can take. Compression and intermodulation distortion appear, and the receiver can lose the signal even though it is strong.',
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
    note: 'Best practice: a 10 dB attenuator at the receiver input and two metres of separation bring the input level back inside the linear range. The same mic now sounds clean; compare the headroom with the previous example.',
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
    note: 'Compare: as the bodypack walks away the carrier-to-noise ratio falls. The stereo difference signal sits higher in the noise than the sum, so the receiver blends towards mono first, and finally loses the stereo pilot.',
    build: () => ({
      scene: make('iem', (s, l) => { outdoorIem(s, l); }),
      walk: { to: { x: 10, y: 70, z: 1.0 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'pilot-vs-carrier-squelch',
    title: 'Pilot-tone squelch vs carrier squelch',
    note: 'Compare: the carrier squelch only looks at signal strength, so a weak but present carrier still opens it and you hear hiss. With pilot squelch on, the receiver also needs a locked 19 kHz pilot and mutes as soon as the pilot is lost.',
    build: () => ({
      scene: make('iem', (s, l) => { outdoorIem(s, l); l.mpx.pilotSquelch = true; }),
      walk: { to: { x: 10, y: 70, z: 1.0 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'long-cable',
    title: 'Long cable run loss',
    note: 'Problem: a 90 m run of thin coax costs over forty decibels at UHF (44.3 dB for this RG58 run), which leaves only about 4.5 dB of margin. Try LMR-400 instead, or put a booster near the antenna: loss before the first gain stage hurts most.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.units = { power: 'dBm', length: 'ft' };
        l.tx.pos = { x: 1, y: 1, z: 1.5 };
        l.tx.powerDbm = 10;
        l.chain = [createChainItem('cable', { cableType: 'rg58', lengthM: 90 }), createChainItem('connector', { lossDb: 0.3 })];
        l.rx.squelch = { enabled: true, thresholdDbm: -100, hysteresisDb: 3 };
      }),
    }),
  },
  {
    id: 'reflective-wall',
    title: 'Reflective wall multipath',
    note: 'Problem: a metal wall behind the receiver adds extra reflected paths. They add and cancel with the direct ray, so the level ripples as the mic moves. A dip appears each time a reflected path changes by one wavelength (0.5 m), but walking across the room changes the path difference only slowly, so along this walk the deep dips are about 2.5 m apart rather than a fraction of a wavelength.',
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
    note: 'Problem: as the transmitter batteries run down their voltage falls below the regulator limit and the output power sags. The received level drops with it until the squelch closes, even though nothing has moved. Time is sped up here; pause or reset the battery in the toolbar.',
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
    note: 'Compare: the telemetry data channel needs a cleaner signal than the audio does, so battery and status readings go stale first while the audio is still usable. Walk the mic away and watch the telemetry panel before the squelch closes.',
    build: () => ({
      scene: make('mic', (s, l) => { outdoorMic(s, l); l.telemetry.preset = 'rds-like'; }),
      walk: { to: { x: 10, y: 70, z: 1.5 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'digital-vs-analog',
    title: 'Digital vs analog: graceful vs cliff',
    note: 'Compare: walk away with the link in digital mode: quality stays perfect, then drops off a cliff within a few decibels. Switch the modulation to analog FM in the toolbar and repeat: the analog audio only gets gradually noisier before it finally closes.',
    build: () => ({
      scene: make('iem', (s, l) => { outdoorIem(s, l); l.modulation.type = 'digital'; l.rx.squelch.thresholdDbm = -120; }),
      walk: { to: { x: 10, y: 70, z: 1.0 }, speedMps: 6, pingPong: false },
    }),
  },
  {
    id: 'adaptive-modulation',
    title: 'Adaptive modulation: 256-QAM down to QPSK',
    note: 'Compare: close to the transmitter the link runs 256-QAM for maximum data rate. As the signal weakens the receiver steps down through 64-QAM and 16-QAM to QPSK, trading rate for robustness, and only then drops out.',
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
    note: 'Compare: error correction hides bit errors completely until there are too many to fix, then it fails abruptly. The receiver repeats the last frame for a moment to hide the gap and then mutes. Compare this with the slow noise build-up of the analog example.',
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
    note: 'Problem: with the constellation order held at 64-QAM, the cloud of received symbols around each ideal point grows as the mic moves away. When the clouds start to overlap the error rate climbs and the link falls over.',
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
    note: 'Problem: a heavy wall splits the venue in two. With one transmit antenna the room behind the wall is a dead spot; a second antenna on the far side, fed through a splitter from the same transmitter, covers it. The zone needs -75 dBm (the -85 dBm squelch threshold plus 10 dB of margin): with antenna 2 its worst spot is about -61 dBm and every cell passes; with one antenna it averages about -97 dBm and none pass. Antenna 2 pays for the splitter loss and a 30 m cable and still wins by a wide margin. Remove antenna 2, or drag it to the near side of the wall, and watch the zone fail.',
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
    note: 'Best practice: a long cable to a far antenna loses more than the antenna can make up, so the far end of the hall is weak. A 24 dB booster after the cable on that branch brings the far zone up to its required level (with only 18 dB, about half of the zone still falls short). Compare the map with and without the booster in the branch chain.',
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
    note: 'Problem: two antennas fed from one transmitter carry the same signal. Where their waves arrive in opposite phase they cancel, giving a pattern of dead stripes. Spacing the antennas apart, or adding a small attenuator to one, reduces the depth of the nulls.',
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
    note: 'Compare: a brick wall (40 dB) shuts the backstage corridor off from the stage, and the corridor needs -75 dBm (the -85 dBm squelch threshold plus 10 dB of margin). With antenna 2 inside the corridor its worst spot is about -68 dBm and every cell passes; with one antenna the corridor averages about -83 dBm and none pass. Remove antenna 2 in the inspector and the zone table lists what would help most, such as moving an antenna or adding gain.',
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
];
