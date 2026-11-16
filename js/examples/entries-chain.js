// EXAMPLES entries: chain parts (splitter, coupler, LNA, filter, pad, bias tee), body, polarisation, coverage modes and people.
import { reviewScene } from './scenes-review.js';
import { bandPeopleScene } from './scenes-people.js';

export const CHAIN_EXAMPLES = [
  {
    id: 'splitter-two-way-receiver',
    title: 'Splitter: one antenna feeding two receivers',
    note: 'Less ideal: a passive 2-way splitter lets two receivers share one antenna and costs 3.5 dB, so the chain loses 5.6 dB against 2.1 dB without it. The loss comes before the first gain stage, so the system noise figure rises from 10.1 dB to 13.6 dB and the margin falls from 59.5 dB to 56.0 dB. An active splitter (0 dB net gain, assumed 8 dB noise figure) gives 11.9 dB and 57.7 dB. Use active distribution for several receivers (figures illustrative).',
    build: () => ({ scene: reviewScene('splitter-two-way-receiver', {}) }),
  },
  {
    id: 'coupler-monitor-tap',
    title: 'Coupler: a monitoring tap on the IEM feed',
    note: 'Best practice: a 20 dB directional coupler taps the 17 dBm IEM feed for monitoring, so the tap port carries -3.0 dBm, enough for a meter or analyser, while the through path loses only 0.15 dB (margin changes by 0.1 dB). Terminate the unused port and never put bias on a line with a coupler. Figures illustrative.',
    build: () => ({ scene: reviewScene('coupler-monitor-tap', {}) }),
  },
  {
    id: 'lna-no-filter',
    title: 'LNA with no filter beside an IEM transmitter',
    note: 'Problem: a 20 dB LNA at the mic receive antenna with no filter sees the IEM transmitter 3.3 m away at -42.4 dBm and delivers -23.7 dBm to the receiver, which is hot (5.7 dB from the P1dB of -18 dBm) with 0.4 dB of desense. The wanted mic margin is 58.2 dB but the receiver works near compression. Put a bandpass filter ahead of the LNA (see filter-before-booster). Receiver figures illustrative.',
    build: () => ({ scene: reviewScene('lna-no-filter', {}) }),
  },
  {
    id: 'filter-before-booster',
    title: 'Filter before the booster',
    note: 'Best practice: the same scene with a 604 to 608 MHz bandpass (1.5 dB loss, 40 dB rejection, assumed) ahead of the LNA: the IEM carrier reaches the receiver at -65.2 dBm, 47.2 dB below the P1dB, with no desense. The filter costs the wanted mic 1.5 dB (margin 56.7 dB against 58.2 dB), a cheap price. Filter before gain.',
    build: () => ({ scene: reviewScene('filter-before-booster', {}) }),
  },
  {
    id: 'pad-on-iem-transmitter',
    title: 'Pad on an IEM transmitter with the wrong antenna',
    note: 'Less ideal: a pad as the fix. The IEM transmitter drives an antenna cut for 863 to 865 MHz at 606.1 MHz (VSWR 46.2:1), and a 6 dB pad in front of it brings the reflection at the output stage down from 19.6 dBm to 1.6 dBm (1.6:1 at the PA). The price is 6 dB of link margin (38.3 dB against 44.3 dB), which is still plenty. The real fix is the right antenna (figures illustrative, assumed band edges).',
    build: () => ({ scene: reviewScene('pad-on-iem-transmitter', {}) }),
  },
  {
    id: 'bias-tee-booster-up-the-mast',
    title: 'Bias tee: powering a booster up the mast',
    note: 'Best practice: a 12 dB booster at the antenna is powered up 45 m of LMR-400 by a bias tee at the rack, and the model raises no DC warning. The chain gains 6.5 dB net and the system noise figure is 5.2 dB against 10.1 dB for a bare RG58 run. Keep every DC block, analyser and passive splitter off the line between the tee and the booster.',
    build: () => ({ scene: reviewScene('bias-tee-booster-up-the-mast', {}) }),
  },
  {
    id: 'bias-tee-into-dcblock',
    title: 'Bias tee behind a DC block',
    note: 'Problem: the same chain with a DC block between the cable and the bias tee. The paper budget barely changes (margin 64.3 dB against 64.4 dB), but no bias reaches the booster and the model warns that it needs 12 V; a dead booster does not give its 12 dB. Take the block out or move the tee.',
    build: () => ({ scene: reviewScene('bias-tee-booster-up-the-mast', {"block": true}) }),
  },
  {
    id: 'body-contact-sweaty-bodypack',
    title: 'Sweaty bodypack: contact and dampness',
    note: 'Problem: a bodypack antenna against bare skin (6 dB, assumed) and wet with sweat (3 dB more) loses 9.0 dB, so the margin is 42.1 dB against 51.1 dB for the same pack free and dry. The contact option replaces the scene body-loss setting instead of adding to it. A layer of clothing costs 2.5 dB and dry skin 6 dB; keep the antenna off the skin and dry.',
    build: () => ({ scene: reviewScene('body-contact-sweaty-bodypack', {}) }),
  },
  {
    id: 'tilted-whip-vs-vertical',
    title: 'Tilted bodypack whip against a vertical receive antenna',
    note: 'Less ideal: a bodypack whip tilted 60 degrees from the vertical receive antenna loses 5.6 dB to polarisation mismatch (2.9 dB at 45 degrees, 14.1 dB at 85, 15.0 dB at 90 where the 15 dB cross-polar floor applies). The margin falls from 58.8 dB upright to 53.1 dB. Wear the pack upright or use a slant or circular receive antenna (see circular-polarisation-wanted-mic).',
    build: () => ({ scene: reviewScene('tilted-whip-vs-vertical', {}) }),
  },
  {
    id: 'circular-polarisation-wanted-mic',
    title: 'Circular receive antenna for a wandering mic',
    note: 'Best practice: the whip lies flat (90 degrees of tilt), which would cost 15.0 dB against a vertical receive antenna, but a circular helical antenna costs a constant 3.01 dB whatever the angle. You give up 3 dB when the mic is upright to avoid the deep mismatch when it is not. Match the receive antenna to the worst case (gain figures assumed).',
    build: () => ({ scene: reviewScene('circular-polarisation-wanted-mic', {}) }),
  },
  {
    id: 'ground-plane-quarterwave',
    title: 'Quarter-wave whip: ground plane or free cable',
    note: 'Problem: a quarter-wave whip on a free cable has no ground plane, so its gain is only -1 dBi and unpredictable (the model warns). On a rack panel it is +3 dBi, which is 4.0 dB more margin (61.8 dB against 57.8 dB); a body counts 1 dBi and a large plate 5 dBi. Mount it on a panel or a ground plate (gain figures assumed).',
    build: () => ({ scene: reviewScene('ground-plane-quarterwave', {}) }),
  },
  {
    id: 'coverage-modes-compare',
    title: 'Coverage modes: coherent, power and best',
    note: 'Compare: the same two IEM antennas 1.5 m apart over a front zone, combined three ways. Coherent adds the waves with phase, so the worst cell is -77.0 dBm in a null; power adds the powers (-43.1 dBm worst) and best takes the stronger antenna (-45.9 dBm). Plan with power or best and check the coherent nulls separately (see zones-coherent-nulls).',
    build: () => ({ scene: reviewScene('coverage-modes-compare', {}) }),
  },
  {
    id: 'external-noise-urban-vs-quiet',
    title: 'External noise: urban against quiet',
    note: 'Less ideal: a 20 dB low-noise booster at the antenna (system noise figure 2.3 dB) makes the receiver sensitive to a city: urban noise lifts the floor to -116.4 dBm against -118.7 dBm with none and costs 2.3 dB of margin (54.6 dB against 56.9 dB). Without the booster (16.6 dB noise figure) the same city costs only 0.1 dB. Gain cannot fix noise that arrives at the antenna.',
    build: () => ({ scene: reviewScene('external-noise-urban-vs-quiet', {}) }),
  },
  {
    id: 'audio-bandwidth-iem-vs-mic',
    title: 'Audio bandwidth: narrow mic against IEM',
    note: 'Compare: narrow-band mic: the transmitter audio is limited to 9.0 kHz (a user value), so the baseband view puts the ceiling at 9 kHz and leaves a 23.8 kHz gap to the 32.8 kHz control tone. A default mic assumes 18 kHz (gap 14.8 kHz) and a stereo IEM 15 kHz, 4 kHz below the 19 kHz pilot. Set the figure to the real device (design values, not measured).',
    build: () => ({ scene: reviewScene('audio-bandwidth-iem-vs-mic', {}) }),
  },
  {
    id: 'imd-iem-8-with-fifth-order',
    title: 'Fifth-order products: count against level',
    note: 'Less ideal: understand the count: five channels from the third-order clean plan still put 26 fifth-order products in channels (158 with all eight), but their summed level is only -253.5 dBm at the bodypack, far below the -111.0 dBm thermal floor. The 12.6 dB floor rise comes from the other transmitters\' wideband noise (-98.7 dBm), not from intermod. Count hits to coordinate, judge harm by level.',
    build: () => ({ scene: reviewScene('imd-iem-8-with-fifth-order', {}) }),
  },
  {
    id: 'p2p-ground-reflection',
    title: 'Point to point: ground reflection ripple',
    note: 'Problem: a 40 m link between paddles lying flat at 3 m, 606 MHz, with the ground reflection on: it costs 5.0 dB at 40 m, and over 20 to 80 m the reflected ray swings the level from 16.7 dB below the direct ray at 36.2 m to 5.8 dB above at 73.7 m. With vertical polarisation the dip is only 1.9 dB. At 150 m the reflection only adds 2.7 dB and the ripple is gone. The model warns that 40 m is under 100 m (near-field, a mic link is the better model): it is shown for the ripple.',
    build: () => ({ scene: reviewScene('p2p-ground-reflection', {}) }),
  },
  {
    id: 'band-four-piece-people',
    title: 'Four-piece band: a mic and an IEM pack per person',
    note: 'Best practice: four people each carry a mic and an IEM bodypack, and the links are named after them (Anna mic, Anna IEM). The margins run from 27.9 dB (Dev IEM, the weakest) to 47.7 dB (Ben mic); the handheld sits at 1.3 m and the bodypacks at the belt, 1.0 m. Move a person and both of their packs move together with the offsets kept, and deleting a person leaves the links in place (frequencies illustrative).',
    build: () => ({ scene: bandPeopleScene() }),
  },
];
