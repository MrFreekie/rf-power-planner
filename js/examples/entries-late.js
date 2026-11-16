// EXAMPLES entries: measurements and calibration, presenter, squelch, coordination, per-channel TV levels, SR 2050, compare and generator noise.
import { noiseSourceScene } from './scenes-review.js';
import { weakTvScene, boosterOverloadScene, weakTvTwoMicScene, tvLevelsScene } from './scenes-signal.js';
import { measurementsScene, twoWallsScene } from './scenes-measure.js';
import { bandPeopleScene, bandWalkEndScene, presenterScene, bandSwapScene } from './scenes-people.js';
import { squelchBurstScene, coordScene, squelchPilotScene } from './scenes-squelch-coord.js';
import { sr2050Scene, compareChangeScene } from './scenes-misc.js';

export const LATE_EXAMPLES = [
  {
    id: 'measurements-body-loss-high',
    title: 'Walk test: the readings say the body loss is higher than assumed',
    note: 'Problem: twelve synthetic readings along a 62 m walk are on average 7.0 dB weaker than the model predicts with the assumed 3 dB of body loss. The fit recovers 10.0 dB of body loss and brings the residual from 7.0 dB rms down to 0.2 dB. A wall or a cross-polar floor cannot explain a constant offset on this open path, so body loss is the one the data points to. Apply the fit, then re-check the margin.',
    build: () => ({ scene: measurementsScene('body-loss-high') }),
  },
  {
    id: 'measurements-clean-match',
    title: 'Walk test: the readings match the model',
    note: 'Best practice: twelve synthetic readings along the same walk agree with the model to 0.2 dB rms with the assumed 6 dB of body loss. No calibration is suggested, so the assumption stands for this transmitter, antenna and body position. Repeat the walk with a different performer or pack position before trusting it for others.',
    build: () => ({ scene: measurementsScene('clean-match') }),
  },
  {
    id: 'presenter-with-backup-bodypack',
    title: 'Presenter: a main bodypack and a hot-spare backup',
    note: 'Best practice: a presenter wears the main mic bodypack on the belt and a hot-spare backup on the other hip, 0.3 m apart, on a different frequency (607.3 against 606.1 MHz) so the two never share a channel. At 11 m the margins are 34.6 dB (main) and 34.0 dB (backup), and with the IEM at 614.1 MHz no third-order product comes closer than 1200 kHz to any channel. The person owns the main mic, the backup and the IEM, so moving or turning them carries all three packs with the offsets kept. Frequencies are illustrative.',
    build: () => ({ scene: presenterScene() }),
  },
  {
    id: 'two-mics-one-weak-tv-block',
    title: 'Weak TV: two mics sharing one weak block',
    note: 'Less ideal: two mics 1.0 MHz apart (570.4 and 571.4 MHz) both sit on the weak channel 33 block (-85 dBm at the antenna, assumed). The TV noise is the same in both 200 kHz channels (-100.8 dBm, floor +11.5 dB), leaving 43.3 dB and 43.4 dB of margin. Their two third-order products, 569.4 and 572.4 MHz, land 1000 kHz from the nearest channel, so the IMD panel shows no hit; a third mic still needs a coordinated frequency.',
    build: () => ({ scene: weakTvTwoMicScene() }),
  },
  {
    id: 'squelch-noise-burst',
    title: 'Squelch: a flash burst opens the gate',
    note: 'Problem: a photographer speedlight 21.9 m from the FOH antenna is a 1 ms click 3 times a second: -70.5 dBm at its peak, -95.8 dBm on average, against a floor of -112.0 dBm. With the mic transmitter off the idle level is -95.7 dBm, 5.7 dB under the -90 dBm squelch, but each flash reaches -70.5 dBm, 19.5 dB over it, so in 10 s the gate opens 30 times for 30 ms and the desk hears pops. A carrier squelch cannot tell a flash from a mic: a pilot squelch needs a locked pilot and ignores it. In the RF spectrum the floor pulses with each flash, in time with the plan rings and the squelch opening; the margin and levels quoted as averages hide those peaks.',
    build: () => ({ scene: squelchBurstScene() }),
  },
  {
    id: 'band-four-piece-walk',
    title: 'Four-piece band: moving the singer carries her packs',
    note: 'Compare: moving Anna from the middle of the stage (8, 7.5) to the stage-right front (14.5, 8.5), by dragging her on the plan, carries her handheld and IEM pack with her, offsets kept. Her mic margin falls from 36.8 to 30.7 dB (-6.1 dB) while her IEM rises from 36.8 to 47.7 dB (+10.9 dB) because she is nearer the IEM antenna, and the other six links do not change (0.0 dB). The scene is the start; the animated walk moves only her mic pack along that line, so her IEM pack stays behind while it runs.',
    build: () => ({ scene: bandPeopleScene(), walk: { to: { ...bandWalkEndScene().links[0].tx.pos }, speedMps: 0.8, pingPong: true } }),
  },
  {
    id: 'coord-equal-spacing',
    title: 'Coordination: three mics equally spaced by 400 kHz',
    note: 'Problem: three mics at 600.0, 600.4 and 600.8 MHz: 2f2-f1 lands on mic 3, 2f2-f3 on mic 1 and f1+f3-f2 on mic 2, three distinct third-order hits (two 2-mic, one 3-mic; the panel lists 8 products counting fifth order and the reverse path). The products reach -67.4 dBm in the channel and lift the worst floor by 45.6 dB. Load it in the coordination lab and compare it with the spread plan.',
    build: () => ({ scene: coordScene('equal') }),
  },
  {
    id: 'coord-spread-plan',
    title: 'Coordination: the same three mics on a spread plan',
    note: 'Best practice: the same mics at 600.0, 601.0 and 603.3 MHz: no third-order product comes closer than 1000 kHz to a channel (hand: 2f2-f1 = 602.0, 2f1-f2 = 599.0, f1+f3-f2 = 602.3, f2+f3-f1 = 604.3). Nothing lands in a channel, so the products add no noise; the floor still rises 9.4 dB from the transmitter noise skirts of mics about 3 m away (assumed model). The wanted mic keeps 50.9 dB of margin, the same as in the equal plan.',
    build: () => ({ scene: coordScene('spread') }),
  },
  {
    id: 'measurements-too-few-readings',
    title: 'Walk test: three readings at nearly one distance',
    note: 'Less ideal: three readings 29 to 31 m from the transmitter are 7.0 dB weaker than the model on average. The fit says 10.0 dB of body loss (0.3 dB rms left) but warns that three readings are too few and sit at nearly the same distance, so in a real venue the offset could equally be a wall or a polarisation loss. Walk a range of distances, through the wall if there is one, before applying it; the twelve-reading walk is the better test.',
    build: () => ({ scene: measurementsScene('too-few') }),
  },
  {
    id: 'tv-weak-6mhz-us-plan',
    title: 'Weak TV, North America: a mic on a 6 MHz channel',
    note: 'Less ideal: with the TV channel width set to 6 MHz a mic 0.4 MHz above the centre of channel 26 (542 to 548 MHz) shares the block with a weak local station (-85.0 dBm at the antenna, assumed). The block occupies 5.38 MHz, so a 200 kHz mic channel sees 14.3 dB less, -99.3 dBm, which is 1.5 dB more than the same power in a 7.6 MHz block; it lifts the floor by 13.0 dB and leaves 42.3 dB of margin. Check the local database and scan first; the occupancy is illustrative. This source does not pulse: the floor is a steady line in the RF spectrum.',
    build: () => ({ scene: weakTvScene('on-channel', 6) }),
  },
  {
    id: 'noise-dect-intercom',
    title: 'Noise: a DECT crew intercom beside a 1.9 GHz mic',
    note: 'Problem: a DECT-type crew intercom beltpack 4.0 m from the receive antenna of a 1893 MHz mic puts -29.0 dBm at the antenna and -75.6 dBm in the 200 kHz channel at the peak (one 0.417 ms slot in every 10 ms frame, duty 4.2 percent), -89.4 dBm on average. The floor rises 21.7 dB and the margin falls to 17.8 dB, with 20.2 dB between the wanted signal and each burst; the 100 Hz buzz an audio path can demodulate is not modelled. Keep intercoms off the mic band and away from the antennas (figures assumed). The RF spectrum shows a 100 Hz flicker of the floor up to the burst level, in time with the plan rings; the slot is only 4.2 percent of the frame and the margin quoted is the average.',
    build: () => ({ scene: noiseSourceScene('dect-intercom') }),
  },
  {
    id: 'noise-pyro-trigger-433',
    title: 'Noise: a pyro cue trigger near a 433 MHz mic',
    note: 'Less ideal: a pyro cue trigger on 433.9 MHz sends 0.1 s command bursts (duty 0.1 percent, assumed) from 19.1 m away to the receiver of a licence-free mic on 433.1 MHz. Each burst is -81.9 dBm in the channel after 38.1 dB of assumed selectivity, 30.3 dB above the floor, but the average is -111.9 dBm, a 3.2 dB floor rise with 50.2 dB of margin left. The wanted signal is 40.3 dB above each burst so the show works, but a dropout on the cue would be heard; coordinate the trigger channel (figures assumed). In the RF spectrum the floor is quiet until a cue is sent, then a single 0.1 s step appears in time with the plan rings: easy to miss in the average, which is the margin quoted, but not in the show.',
    build: () => ({ scene: noiseSourceScene('pyro-trigger-433') }),
  },
  {
    id: 'booster-padded-before-radio',
    title: 'Booster behind a pad: the radio is tamed, the wanted signal pays',
    note: 'Less ideal: a 10 dB pad ahead of the booster cuts the keyed crew radio at the booster output from 13.9 dBm to 3.9 dBm, so the compression falls from 3.5 dB to 0.1 dB and the keyed margin rises from 4.1 dB to 7.5 dB. The pad costs the wanted mic 10 dB all the time, so with the radio off the margin is 27.5 dB instead of 37.5 dB. A bandpass filter (booster-filtered-before-radio) gives 7.6 dB keyed and 36.0 dB unkeyed, so a pad is a blunt cure (figures assumed).',
    build: () => ({ scene: boosterOverloadScene('padded') }),
  },
  {
    id: 'measurements-two-walls-per-material',
    title: 'Walk test: a brick wall and a plasterboard wall, a fit for each',
    note: 'Problem: fourteen synthetic readings along a 63 m walk are 7.7 dB weaker than the model on average (8.8 dB rms), because the path crosses a brick wall at 15 m and a plasterboard partition at 30 m and the table losses are too low. The per-material fit adds 8.1 dB for brick and 2.8 dB for plasterboard and leaves 0.2 dB rms, against 1.3 dB for one figure on every wall and 4.2 dB for body loss; eleven readings cross the brick and seven the plasterboard, so the fit is not marked low confidence. The three readings in clear line of sight already match to 0.4 dB, which is why the walls and not the body loss are blamed, but a wall figure can also hide a fade or a pack in a different place. Apply the fit, then walk it again (readings synthetic, true wall losses assumed).',
    build: () => ({ scene: twoWallsScene('uncalibrated') }),
  },
  {
    id: 'measurements-calibrated',
    title: 'Walk test: the per-material fit applied',
    note: 'Best practice: the same walk after applying the per-material fit (brick +8.1 dB, plasterboard +2.8 dB, stored in the scene): the readings now agree with the model to 0.2 dB rms instead of 8.8 dB, the worst single reading is 0.4 dB off, and asking for a fit again suggests nothing. The margin at the receiver behind both walls falls from 28.1 dB to 17.2 dB, which is the truer figure, so calibrating moved the plan toward the venue. The figures belong to these two walls, this transmitter and this body position: a new venue or another performer needs a new walk (readings synthetic).',
    build: () => ({ scene: twoWallsScene('calibrated') }),
  },
  {
    id: 'measurements-wall-explains-offset',
    title: 'Walk test: the step at a wall is the wall, not the body',
    note: 'Problem: thirteen synthetic readings are 4.8 dB weaker than the model on average (6.6 dB rms), but the six taken before a brick wall at 30 m match it to 0.4 dB and the seven behind it are about 9 dB low. The fit names the wall: an extra 8.9 dB per wall crossed leaves 0.2 dB rms, where changing the body loss would still leave 4.5 dB. Because the clear-path readings agree, a wall is the likelier cause than the body, though the fit still warns that a wall figure can absorb body loss or a fade. Apply it and re-check the margin behind the wall (readings synthetic, wall loss assumed).',
    build: () => ({ scene: twoWallsScene('one-wall') }),
  },
  {
    id: 'tv-per-channel-levels',
    title: 'TV block levels set per channel from measurements',
    note: 'Best practice: three TV channels carry levels set by you instead of the assumed -75 dBm: channel 30 empty at -108 dBm, channel 33 weak at -85 dBm and channel 34 strong at -52 dBm (stand-ins for analyser readings at the antenna). Over the -112.0 dBm floor of this receiver a 200 kHz mic channel in each block sees a rise of 0.3, 11.5 and 44.2 dB, where the assumed level would have said about 21 dB on all three, flagging the empty channel and understating the strong one. Mic 1 on channel 33 keeps 54.9 dB of margin and mic 2 on channel 30 keeps 55.2 dB: the levels drive only the noise-rise strip of the spectrum map, never the link budget, so use the TV level controls under the map to set or clear one. This source does not pulse: the floor is a steady line in the RF spectrum.',
    build: () => ({ scene: tvLevelsScene(true) }),
  },
  {
    id: 'noise-keyed-vs-continuous-spectrum',
    title: 'Noise: a keyed PTT radio against a steady LED light',
    note: 'Compare: a business UHF PTT radio keyed 3.0 m from the receive antenna and an LED camera light 10.5 m away lift the floor by almost the same average amount, 16.1 dB and 15.9 dB (-96.0 and -96.2 dBm in the channel), and together by 19.0 dB, leaving 35.4 dB of margin. They are not the same noise: the radio is keyed 30 percent of the time and reaches -90.8 dBm while keyed, 5.2 dB over its average, while the light is a steady -96.2 dBm. In the RF spectrum the floor steps up and down with each key-up while the part from the light is a flat line under it, in time with the plan rings. Mute either source to see its own effect; the average margin hides the steps (figures assumed).',
    build: () => ({ scene: noiseSourceScene('keyed-vs-continuous') }),
  },
  {
    id: 'squelch-pilot-vs-flash',
    title: 'Squelch: pilot squelch ignores the flash',
    note: 'Best practice: the geometry of squelch-noise-burst as an IEM pack (transmitter off, speedlight 21.9 m away, carrier squelch at -90 dBm) with pilot squelch switched on. Each flash still reaches -70.5 dBm at its peak, 19.5 dB over the threshold, which would open a carrier squelch 30 times in 10 s, but the gate also needs a locked 19 kHz pilot, a flash has none, and so it stays shut. Keep pilot squelch on for IEM packs wherever cameras or radios are around; it does nothing for a mic link, which has no pilot. The RF spectrum floor still pulses with each flash because the noise is unchanged, but the gate ignores it (levels assumed).',
    build: () => ({ scene: squelchPilotScene() }),
  },
  {
    id: 'band-four-piece-swap-person',
    title: 'Four-piece band: a spare pack assigned to a person',
    note: 'Best practice: the bodypack on 608.9 MHz is lying in a case at stage right, 8.5 m from the drummer, and is still called Spare bodypack with 31.8 dB of margin. Assign it to Dev in the people panel as his mic: the pack jumps to his belt (0.15 m to his right, 0.05 m behind, height kept at 1.0 m), is renamed Dev mic and shows 45.4 dB of margin, because it is now 2.4 m from the receive antenna instead of 10.2 m. The other seven links do not change. Assign every pack before checking the plan, so each figure is for where the pack is worn and not where it was left (positions illustrative).',
    build: () => ({ scene: bandSwapScene(false) }),
  },
  {
    id: 'iem-sr2050-legacy-range',
    title: 'SR 2050 IEM tuned in a legacy range',
    note: 'Less ideal: an SR 2050 IEM transmitter at 826.0 MHz, in the Dw range of 790 to 865 MHz that only the 2019 sheet lists (the 10/2023 sheet shows Aw+, Gw, Gw1, GBw and Bw), feeds an EK 2000 IEM pack 25.0 m away. At the standard 30 mW (14.8 dBm) the margin is 51.0 dB and at 50 mW it is 53.2 dB, so the extra 2.2 dB is not needed on a clear path. The weakness is the range: a unit bought today may not cover it, and what 826 MHz may be used for differs by country, so check the range printed on the unit and the local rules (frequency illustrative, power options from the data sheet).',
    build: () => ({ scene: sr2050Scene('std-30mw') }),
  },
  {
    id: 'noise-flash-trigger-24',
    title: 'Noise: a 2.4 GHz flash trigger on the channel of a 2.4 GHz mic',
    note: 'Problem: a camera radio flash trigger (10 dBm ERP, 2 percent duty, assumed) 7.2 m from the receive antenna sits on the same 2440.0 MHz channel as a 2.4 GHz mic 19 m away. In the 200 kHz channel each packet reaches -57.4 dBm, 0.6 dB stronger than the mic at -57.9 dBm, and the average of -74.3 dBm lifts the floor by 36.5 dB and leaves 0.6 dB of margin. A 2.4 GHz mic shares its band with every trigger, Wi-Fi access point and phone in the building, which UHF does not: move the mic or the trigger channel, and compare wifi-busy-2g4. In the RF spectrum the floor pulses with each packet, in time with the plan rings; the margin quoted is the average.',
    build: () => ({ scene: noiseSourceScene('flash-trigger-24') }),
  },
  {
    id: 'noise-motor-hoist-vs-led-wall-light',
    title: 'Noise: a chain hoist motor against an LED wall light',
    note: 'Compare: with the mic transmitter off, a brushed chain hoist motor 10.0 m from the antenna (1000 clicks a second, duty 5 percent) and an LED wall light 11.2 m away have the same average, -96.8 and -96.7 dBm, and lift the floor by 15.3 and 15.4 dB. The clicks of the hoist reach -83.8 dBm, 6.2 dB over the -90 dBm squelch, so a carrier squelch chatters open while it runs, but the steady light never gets there (idle -96.6 dBm, 6.6 dB under). The light does something else: it lifts the floor by 15.4 dB for every mic that is on, all the time. In the RF spectrum the floor of the hoist flickers between average and peak in time with the plan rings while the light is a flat line; mute one source to see the other (figures assumed).',
    build: () => ({ scene: noiseSourceScene('hoist-vs-led') }),
  },
  {
    id: 'compare-single-change',
    title: 'Compare: one change, the receive cable',
    note: 'Compare: a mic 19 m from the receiver with 60 m of RG58 on the receive side has 29.7 dB of margin. Take a snapshot, change only the cable to LMR-400 and Compare shows 48.8 dB, 19.2 dB more, and credits it to the cable alone, since nothing else differs. The cable is the first stage of the receive chain, so its loss goes straight into the noise floor (-87.3 dBm against -106.5 dBm). Change one thing at a time and the comparison can name its cause (figures assumed).',
    build: () => ({ scene: compareChangeScene(false) }),
  },
  {
    id: 'generator-inverter-van',
    title: 'Noise: a tour generator beside the FOH position',
    note: 'Problem: a tour generator 8.0 m from the FOH receive antenna is continuous broadband noise, 41.5 dBuV/m at 10 m at 606 MHz (a 45 dBuV/m class source that falls away above 500 MHz, assumed). It puts -90.2 dBm in the 200 kHz channel, lifts the floor by 21.8 dB and takes the margin from 54.3 dB to 32.5 dB. It is strongest at VHF, so a VHF mic would suffer more. Park it as far away as the cable allows and out of line of sight of the antenna. This source does not pulse: the floor is a steady line in the RF spectrum.',
    build: () => ({ scene: noiseSourceScene('generator-van') }),
  },
  {
    id: 'booster-higher-p1db',
    title: 'Booster with a higher P1dB: the radio compresses it far less',
    note: 'Less ideal: the same unfiltered booster with a 20.0 dBm output 1 dB point (assumed) instead of 10.4 dBm. The keyed crew radio still reaches its output at 13.9 dBm but the booster now compresses only 0.1 dB, so the keyed margin is 7.6 dB instead of 4.1 dB and 37.5 dB with the radio off. The model still warns that the stage is being driven toward its 1 dB point, and a second radio or a closer one brings the compression back. A bandpass filter (booster-filtered-before-radio) removes the radio instead of tolerating it.',
    build: () => ({ scene: boosterOverloadScene('high-p1db') }),
  },
];
