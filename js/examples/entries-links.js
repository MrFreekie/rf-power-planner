// EXAMPLES entries: point-to-point links, cascades, walls, raised stage, bands and equipment presets (FM deviation).
import { applyFmPreset } from '../model/fm-presets.js';
import { createChainItem, createReflector, createZone, createImdTransmitter, createPlatform, newId } from '../model/scene.js';
import { omni, make, twoRay, sameStage, SAME_STAGE_WALK, ACROSS, outdoorIem } from './helpers.js';
import { p2pScene } from './scenes-venue.js';
import { OMNI_IMD, imdScene } from './scenes-imd.js';

export const LINKS_EXAMPLES = [
  {
    id: 'p2p-wireless-snake',
    title: 'Point to point: wireless snake send across a field',
    note: 'Less ideal: a 20 dBm send at 606 MHz crosses 1.2 km between two yagis on 6 m masts (assumed gain). The received power is -60.3 dBm with 30.5 dB of margin, but only 49 percent of the first Fresnel zone is clear at 0.6 km, so the earth costs 0.6 dB. On 2 m masts the clearance falls to 16 percent and the loss to 4.1 dB.',
    build: () => ({ scene: p2pScene('snake') }),
  },
  {
    id: 'p2p-delay-speaker',
    title: 'Point to point: FOH to a stage-left delay speaker',
    note: 'Best practice: a 17 dBm send at 606 MHz crosses 150 m between paddle antennas at 3 m. The received power is -50.6 dBm with 40.1 dB of margin and 70 percent of the first Fresnel zone is clear, so the 60 percent rule is met. Over a path this long the ground reflection is left off: switched on it only adds about 1.6 dB (see p2p-ground-reflection for a short path with a real ripple).',
    build: () => ({ scene: p2pScene('delay') }),
  },
  {
    id: 'p2p-truck-hill',
    title: 'Point to point: broadcast truck to a remote camera position',
    note: 'Less ideal: a 30 dBm send at 606 MHz covers 8 km between yagis at 12 m and 6 m with a 30 m hill 3 km from the truck. The hill is a single knife edge that costs 13.8 dB, leaving -80.0 dBm received and 10.8 dB of margin and the clearance is far below the 60 percent rule. Without the hill the earth alone costs 3.2 dB and the received power is -69.3 dBm.',
    build: () => ({ scene: p2pScene('truck') }),
  },
  {
    id: 'p2p-bodypack-line-feed',
    title: 'Point to point: two bodypacks as a wireless line feed',
    note: 'Less ideal: two bodypacks with whips at 1.5 m carry a line feed over 60 m at 606 MHz with 10 dBm and nobody wearing them, so there is no body loss. The received power is -78.7 dBm with 12.1 dB of margin. The path is under 100 m and only 55 percent of the first Fresnel zone is clear, so the model warns; a mic link is the better tool here.',
    build: () => ({ scene: p2pScene('bodypack') }),
  },
  {
    id: 'imd-pim',
    title: 'Rusty connector: PIM',
    note: 'Problem: two 20 W transmitters sit side by side behind an isolated combiner and the receiver is linear, which holds active intermod at the wanted channel to about -114 dBm. The product made passively by the antenna-line connector is -118 dBm for a corroded connector and -153 dBm for a good one: 35 dB apart. At this power that product stays below the noise from the transmitters themselves (about -103 dBm), so the noise rise is the same for both; passive intermod only starts to matter at much higher power, where it grows three times faster than the carriers.',
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
    note: 'Compare: four transmitters equally spaced by 400 kHz: nearly every third-order product lands on the channel of another transmitter. Retune them to 606.000, 606.500, 610.200 and 611.700 MHz: no third- or fifth-order product then lands within 500 kHz of any channel centre, so the coordination check clears and the 400 kHz clearance rule is met.',
    build: () => ({
      scene: imdScene('mic', 606.4, [
        ['Mic A', 606.0, 14, 9.0, 6.0, 1.5], ['Mic B', 606.4, 14, 9.2, 7.2, 1.5], ['Mic C', 606.8, 14, 8.8, 5.2, 1.5], ['Mic D', 607.2, 14, 9.4, 5.6, 1.5],
      ], {}),
    }),
  },
  {
    id: 'cascade-booster-antenna',
    title: 'Cascaded noise figure: booster at the antenna',
    note: 'Best practice: a 20 dB booster at the antenna comes first in the chain, so the 25.5 dB of cable loss after it adds little noise: the system noise figure is 13.9 dB and the link has 12 dB of margin. Compare with the same parts the other way round in the next example.',
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
    note: 'Less ideal: the same booster and cable, but the booster sits at the rack after the long cable. The cable loss now comes first and adds its full 25.5 dB to the noise figure, giving 28.6 dB overall. The received power is identical, but the link margin falls to about -3 dB and the link fails.',
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
    note: 'Compare: an unmodulated stray carrier arrives 8 dB stronger than the wanted signal. A carrier squelch only looks at signal strength, so it opens on the stray carrier and the wanted audio is lost to capture. With pilot squelch on, the receiver also needs the wanted 19 kHz pilot, which the stray carrier does not have, so the gate stays shut.',
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
    note: 'Problem: the transmitter estimates its battery from the voltage under load. With two alkaline cells that is a poor guide: at 50 % true charge the gauge reads 22 %, and at 30 % it already shows empty while the transmitter still runs at full power. Press Battery: Start to watch the reading fall long before the output power sags.',
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
    note: 'Compare: the dividing wall is concrete, 0.1 m thick in its upper half and 0.4 m in its lower half. Wall loss grows with thickness (concrete costs 8 dB per 0.1 m), so the room behind the thin part is covered (weakest point -70 dBm against -75 dBm required) and the room behind the thick part is not (weakest -94 dBm). Change the thickness of a wall segment to see the zone result change.',
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
    note: 'Less ideal: antenna A has a short 5 m cable run (2.1 dB loss); antenna B is on a 40 m run of RG58 with a 6 dB booster at the antenna end (11.0 dB net loss). B therefore arrives about 9 dB below A, and with switching diversity the receiver stays on A and moves to B only while A is in its fade, around 7 m (A -41 dBm, B -38 dBm). Remove the booster and B is rarely chosen.',
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
    note: 'Problem: the receiver antenna stands on the floor in front of the stage and the mic walks on a deck 1.2 m high. The mic is now nearly 3 m above the reflecting floor instead of 1.75 m, so the cancellation moves: the dip that sits at 6.8 m with a ground-level stage (-46 dBm) falls at about 5.1 m on the deck and is shallower (-41 dBm), so the squelch that closes at 6.8 m on the ground stays open here. Set the deck height to 0 to compare.',
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
    note: 'Less ideal: a 1.2 m deck carries a 0.4 m drum riser, and the IEM bodypack is worn on the riser while the transmit antenna stands on the deck. Heights are measured from the local floor, so the bodypack is 1.0 m above the riser top. The floor bounce now reflects from the riser instead of the deck: that ray is about 16.3 dB weaker than over a bare deck (-43.2 dB against -27.0 dB relative to the direct ray), while the total level barely moves (-36.0 dBm against -36.1 dBm).',
    build: () => ({
      scene: make('iem', (s, l) => {
        s.stage = { width: 12, depth: 8, heightM: 1.2 };
        s.environment.floor = 'wood';
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
    title: 'Receiver on the floor, mic on a raised stage with a riser',
    note: 'Compare: the receiver antenna is on the floor in front of the audience and the mic is on a 1.5 m stage. The raised stage changes the geometry: the level falls from -36.6 dBm for a ground-level stage to -38.5 dBm. A 1.4 m tall, 0.6 m deep wooden riser in front of the mic then blocks part of the direct ray and costs another 3.6 dB (-42.1 dBm); a metal one would cost 5.8 dB.',
    build: () => ({
      scene: make('mic', (s, l) => {
        s.stage = { width: 12, depth: 8, heightM: 1.5 };
        s.environment.floor = 'concrete';
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
    note: 'Compare: the same 10 m link, with the same omni antennas and 5 m of RG58, at 200 MHz. Free-space loss is 38.5 dB (effective 39.0 dB with the floor bounce) and the cable costs only 1.1 dB, so the margin is 68.9 dB. Compare the UHF and 2.4 GHz versions of this stage.',
    build: () => ({ scene: make('mic', (s, l) => sameStage(s, l, 200)), walk: SAME_STAGE_WALK }),
  },
  {
    id: 'band-uhf',
    title: 'Same stage at UHF (600 MHz)',
    note: 'Compare: the same link at 600 MHz: free-space loss rises to 48.0 dB (effective 46.0 dB) and the cable costs 2.1 dB, so the margin is 60.8 dB. Doubling the frequency twice more would add another 12 dB of free-space loss, with antennas of equal gain.',
    build: () => ({ scene: make('mic', (s, l) => sameStage(s, l, 600)), walk: SAME_STAGE_WALK }),
  },
  {
    id: 'band-2g4',
    title: 'Same stage at 2.4 GHz',
    note: 'Compare: the same link at 2.4 GHz: free-space loss is 60.1 dB (effective 58.4 dB), 21.6 dB more than at 200 MHz, and the cable costs 5.4 dB, so the margin is 45.2 dB. The shorter wavelength also makes the multipath pattern finer as the mic moves, and the transmit power is 14 dBm in all three versions so only frequency differs; a UK audio PMSE 2.4 GHz system is limited to 10 mW EIRP (draft IR 2030), about 4 dB less.',
    build: () => ({ scene: make('mic', (s, l) => sameStage(s, l, 2400)), walk: SAME_STAGE_WALK }),
  },
  {
    id: 'wifi-busy-2g4',
    title: '2.4 GHz link in a busy Wi-Fi venue',
    note: 'Problem: a 2.4 GHz link 104 m across a venue with busy Wi-Fi, 10 dB fade margin and a 10 dBm (10 mW) transmitter, the UK audio PMSE limit (draft IR 2030). Busy Wi-Fi raises the noise floor by about 20 dB at 2.4 GHz (to -87.6 dBm), which turns an 11.2 dB margin into -8.8 dB: a fail. At 5.8 GHz the same venue would add only about 12 dB. Set the interference option to None and the same link passes; the signal level has not changed, only the noise floor.',
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
    note: 'Best practice: a 50 mW handheld at 590 MHz feeds a receiver set up from published UR4D-class figures; the quoted -102 dBm at 30 dB SINAD is used as the sensitivity, so the margin is 65.5 dB across 15 m. Walk the transmitter towards the receiver: the input reaches -30 dBm (hot, the top of the rated range) at about 8 m and passes the -25 dBm overload level at about 3.5 m (multipath ripples move both points), where the front end is flagged overloaded even though the margin is highest. Keep transmitters well away from the receiver antennas. Based on published specs, some figures (noise figure, squelch threshold, band edges) are assumed.',
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
    note: 'Compare: four 10 mW handhelds share a hybrid combiner with 25 dB isolation, and Mic A and Mic B beat to a product at 605.7 MHz, exactly on Mic C: the worst channel sees its noise floor rise by 20.3 dB. Switching all four to the low-intermod mode lowers the transmitter-side product by an assumed 6 dB and the worst rise to 14.8 dB. The 6 dB is an assumption standing in for a trade-report claim of about 30 percent more compatible channels. Based on published specs, some figures assumed.',
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
    note: 'Compare: the same link and the same 15 kHz audio at a -80 dBm input: Carson bandwidth is 110 kHz at +-40 kHz (SKM 5200-II class), 120 kHz at +-45 kHz (UR4D class), 180 kHz for +-75 kHz broadcast FM and 31 kHz for +-12.5 kHz narrowband two-way (3 kHz audio, so not directly comparable). Above threshold the audio SNR rises 20 log10 of the deviation ratio, 1.0 dB for +-45 and 5.5 dB for +-75 kHz against +-40 kHz, while the threshold CNR stays near 10 dB and the threshold input level rises from -107.6 to -105.4 dBm. All fit a 200 kHz channel (broadcast uses 90 percent) and leave a 220 to 290 kHz gap to a neighbour 400 kHz away, where the receiver rejection is 75 dB. Deviation of the broadcast and narrowband systems, the audio bandwidths, the receiver noise figure and the absence of a tone-key above the audio are assumed.',
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
    note: 'Compare: three analogue FM systems carry the same 15 kHz audio at a -80 dBm input, compared at nominal deviation: the Sennheiser G3 / 2000 class at +-24 kHz needs 78 kHz of Carson bandwidth, the SKM 5200-II class at +-40 kHz needs 110 kHz and the UR4D class at +-45 kHz needs 120 kHz. Above threshold the audio SNR is 4.4 dB better at +-40 kHz and 5.5 dB better at +-45 kHz than at +-24 kHz (20 log10 of the deviation ratio), at the price of a threshold input level that rises from -109.1 to -107.6 and -107.2 dBm. All three use at most 60 percent of a 200 kHz channel and leave 322, 290 and 280 kHz to a neighbour 400 kHz away. Peak deviation of the G3 is twice its nominal figure, so its real occupied bandwidth is wider than this nominal estimate; the 15 kHz audio bandwidth, the receiver noise figure and the nominal-deviation reading are assumed.',
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
