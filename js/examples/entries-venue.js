// EXAMPLES entries: intermodulation, antenna band, audience, ceiling, fibre, IEM, front-of-house, video wall, even-order and tone MPX examples.
import { iemHall } from './helpers.js';
import { bandScene, audienceScene, ceilingScene, rofScene, rofBranchScene } from './scenes-venue.js';
import { sosScene, fohScene, videoWallScene } from './scenes-foh.js';
import { evenScene, toneMpxScene, imdScene, iem8Scene } from './scenes-imd.js';

export const VENUE_EXAMPLES = [
  {
    id: 'imd-too-close',
    title: 'Two mics too close to the receive antenna',
    note: 'Problem: mics B and C are held next to the receive antenna, so each arrives far stronger than the wanted mic A. The level meter shows the own transmitter of the link (about -46 dBm); in the intermod panel mic A is about -39.5 dBm at the antenna. The receiver front end is not perfectly linear and mixes them: twice B minus C lands exactly on the channel of mic A and buries it. The squelch closes with the reason intermod.',
    build: () => ({
      scene: imdScene('mic', 605.6, [
        ['Mic A (wanted)', 605.6, 14, 2, 3, 1.5], ['Mic B', 606.0, 14, 9.5, 6.5, 2.0], ['Mic C', 606.4, 14, 9.3, 6.0, 2.0], ['Mic D', 607.2, 14, 6, 2, 1.5],
      ], {}),
    }),
  },
  {
    id: 'imd-iem-no-isolation',
    title: 'IEM combiner with no isolation',
    note: 'Problem: three IEM transmitters share a simple passive combiner with only 15 dB of isolation. Each one leaks a little of the others back into its own output stage, where the amplifier mixes them. Twice 606.0 minus 606.4 lands on 605.6, the channel of the third transmitter, as a spurious signal radiated from the antenna.',
    build: () => ({
      scene: imdScene('iem', 605.6, [
        ['IEM A (wanted)', 605.6, 10, 1.0, 1.0, 1.5], ['IEM B', 606.0, 10, 1.2, 1.0, 1.5], ['IEM C', 606.4, 10, 1.4, 1.0, 1.5],
      ], { preset: 'iem-combiner-no-isolation', iip3Dbm: 10, combiner: { type: 'hybrid', isolationDb: 15, lossDb: 3.5 } }, iemHall),
    }),
  },
  {
    id: 'imd-iem-isolators',
    title: 'IEM combiner with isolators: same transmitters',
    note: 'Best practice: the same three transmitters, now through an isolated combiner with circulators. The isolators cut each interferer by 50 dB instead of 15 before it reaches the other amplifiers. The product made in an amplifier grows one decibel per decibel of interferer (the own carrier of the transmitter is not reduced), so it falls by the 35 dB isolation difference less 1.5 dB because this combiner loses 1.5 dB less on the way out: about 33.5 dB, not 100 dB. The 3 dB per dB rule belongs to products made in the receiver, where every carrier is lowered.',
    build: () => ({
      scene: imdScene('iem', 605.6, [
        ['IEM A (wanted)', 605.6, 10, 1.0, 1.0, 1.5], ['IEM B', 606.0, 10, 1.2, 1.0, 1.5], ['IEM C', 606.4, 10, 1.4, 1.0, 1.5],
      ], { preset: 'iem-combiner-isolated', iip3Dbm: 10, combiner: { type: 'isolated', isolationDb: 50, lossDb: 2 } }, iemHall),
    }),
  },
  {
    id: 'imd-move-apart',
    title: 'Move them apart: intermods fall',
    note: 'Best practice: same four frequencies as the first intermod example, but the mics are now 8 to 9 metres from the receive antenna. The products fall three decibels for every decibel the carriers fall, so even this small increase in distance leaves the wanted channel clean. Drag a mic towards the antenna and watch it return.',
    build: () => ({
      scene: imdScene('mic', 605.6, [
        ['Mic A (wanted)', 605.6, 14, 2, 3, 1.5], ['Mic B', 606.0, 14, 2.0, 6.5, 1.5], ['Mic C', 606.4, 14, 2.5, 2.0, 1.5], ['Mic D', 607.2, 14, 3, 4, 1.5],
      ], {}),
    }),
  },
  {
    id: 'imd-iem-8-combined',
    title: 'Eight IEMs: all through one isolated 8-way combiner (A)',
    note: 'Best practice: eight coordinated IEM transmitters (606.1 to 623.7 MHz, 25 mW each, no third-order product in any channel) feed one isolated 8-way combiner (4.5 dB through, 45 dB port isolation, assumed) and one directional antenna. Every channel loses the same 4.5 dB and reaches the bodypack at about -37.3 dBm; the worst pair of transmitters is 45.0 dB apart, so the strongest product made in an output stage (2f1-f2) is only -102.3 dBm at the bodypack, -64.9 dBc. The plan is not free of fifth-order products: 158 still land in channels, but their summed level is only -244.0 dBm, and the 12.6 dB floor rise at the worst channel is wideband noise from the other transmitters, not intermod. Pros: one antenna, balanced levels; cons: 4.5 dB lost per channel, one point of failure; compare the 7 plus 1 and 4 plus 4 examples (figures illustrative).',
    build: () => ({ scene: iem8Scene('A') }),
  },
  {
    id: 'imd-iem-7-plus-1-omni',
    title: 'Seven IEMs on a directional antenna, one on an omni 2.5 m away (B)',
    note: 'Problem: the same eight frequencies: seven go through a combiner (4 dB, 45 dB isolation) to the directional antenna, the eighth goes straight to an omni antenna 2.5 m in front of it, inside the main lobe. the omni transmitter has no isolator: the field of the other seven reaches its output stage only 33.1 dB down, where it mixes; the worst product is 2f8-f1 at -91.6 dBm at the bodypack (-53.1 dBc), 10.7 dB worse than the single combiner; it lands outside the IEM band but is still radiated; the odd channel is also weaker at the bodypack (-38.5 dBm against -36.8 dBm). Fixes, all in the model: move the omni to the side of the antenna, in a pattern null (42.8 dB, -101.8 dBm), put it 6 m away (-97.8 dBm), or add an isolator (35 dB) on the omni transmitter; Pros: directional gain for seven channels, lower combiner loss; Cons: an unprotected transmitter, different coverage per channel, harder to document. Illustrative figures.',
    build: () => ({ scene: iem8Scene('B') }),
  },
  {
    id: 'imd-iem-4plus4-combined',
    title: 'Eight IEMs: two 4-way combiners and a passive 2-way to one antenna (C)',
    note: 'Less ideal: the same eight frequencies in two 4-way isolated combiners (3 dB, 40 dB, each transmitter with its own 20 dB isolator) joined by a passive 2-way hybrid (3.5 dB, 25 dB, assumed) to the same directional antenna. every channel now loses 6.5 dB, 2.0 dB more than the 8-way, so the bodypack gets -39.3 dBm; inside a group the isolation is 40.0 dB; between groups the path is 3 + 25 + 3 + 20 = 51.0 dB because each transmitter is still protected by its own isolator, and the worst product is -99.3 dBm (-59.9 dBc), 3.0 dB worse than the 8-way; take the isolators away (a plain 4-way and hybrid) and the cross-group isolation falls to 31.0 dB and the worst product rises to -90.3 dBm. Pros: modular, cheaper units, a failed module takes out four channels, not eight; Cons: more loss, more connectors, the hybrid is the weak link. Illustrative figures.',
    build: () => ({ scene: iem8Scene('C') }),
  },
  {
    id: 'band-whip-wrong-band',
    title: 'Antenna band: a whip cut for 470-520 MHz used at 830 MHz',
    note: 'Problem: the receive whip is cut for UHF band A (470-520 MHz, assumed) but the link is at 830 MHz. Its VSWR is 59.3:1, a mismatch loss of 11.9 dB (about 3.9 times less range in free space), where a whip cut for 790-865 MHz loses 0.0 dB. The swap of antennas between bands is a classic field error. Design bands and the resonance model are assumed teaching figures.',
    build: () => ({ scene: bandScene('whip-wrong-band') }),
  },
  {
    id: 'band-uhf-vs-2g4',
    title: 'Antenna band: a 2.4 GHz antenna on a 600 MHz link, and the reverse',
    note: 'Compare: a 2.4 GHz antenna on a 600 MHz microphone link has a VSWR of 1235.3:1 and loses 24.9 dB (the model caps the loss at 30 dB). The reverse, a UHF 600-700 MHz antenna on a 2440 MHz link, loses 18.1 dB at 259.2:1. A mismatched antenna reflects the power rather than burning it, but the link margin falls by the same amount. Assumed teaching model.',
    build: () => ({ scene: bandScene('uhf-vs-2g4') }),
  },
  {
    id: 'band-iem-tx-wrong-antenna',
    title: 'Antenna band: IEM transmitter into an antenna cut for 863-865 MHz',
    note: 'Problem: the 100 mW IEM transmitter at 606.1 MHz drives an antenna cut for 863-865 MHz (assumed, a whip about 8 percent wide at best): VSWR 46.2:1, 10.8 dB mismatch loss, and 92 percent of the power (19.6 dBm) returns to the output stage, which can stress the PA or trigger foldback. A 6 dB pad cuts that to 7.6 dBm (1.6:1 at the PA, the reflection crosses the pad twice); an isolator (0.5 dB forward, 20 dB reverse, assumed) gives 1.2:1 at the PA and -0.9 dBm. The real fix is the right antenna. Illustrative figures.',
    build: () => ({ scene: bandScene('iem-tx-wrong-band') }),
  },
  {
    id: 'band-wideband-vs-whips',
    title: 'Antenna band: one wideband antenna against narrow whips cut per band',
    note: 'Compare: a wideband antenna (470-960 MHz, assumed log-periodic or paddle, flat about 1.3:1) loses 0.07 dB at 830 MHz, the same link with a whip cut for 470-520 MHz loses 11.9 dB. The whip cut for 790-865 MHz is as good (0.0 dB) but only in its own band, so a wideband antenna is the safe choice when several bands are in use. The price is lower gain and a less clean pattern, assumed.',
    build: () => ({ scene: bandScene('wideband-vs-whips') }),
  },
  {
    id: 'band-whip-trim',
    title: 'Antenna band: trimming a whip, the VSWR dip and the 606 MHz channel',
    note: 'Best practice: a whip cut for 570-608 MHz (assumed) sits at the top edge of its band at 606 MHz: VSWR 1.69:1 and 0.30 dB of mismatch loss. Trimmed to resonate at 596-616 MHz the VSWR at 606 MHz is 1.0:1 and the loss 0.00 dB. A NanoVNA S11 sweep shows the dip move as the whip is cut (returnLossSweep in the model draws it). A hand or the body shifts the dip, assumed.',
    build: () => ({ scene: bandScene('whip-trim') }),
  },
  {
    id: 'band-filter-wrong-band',
    title: 'Antenna band: a 863-865 MHz bandpass filter on a 606.1 MHz channel',
    note: 'Problem: the transmit chain has a bandpass filter for 863-865 MHz (assumed 40 dB rejection) but the IEM runs at 606.1 MHz: the signal at the bodypack drops from -36.4 to -76.4 dBm and the margin from 53.6 to 13.6 dB. A filter must be chosen for the channel, like an antenna. The warning in the link says so.',
    build: () => ({ scene: bandScene('filter-wrong-band') }),
  },
  {
    id: 'audience-crowd',
    title: 'Audience: a standing crowd between the stage and a low receive antenna',
    note: 'Problem: a handheld microphone on stage and a receive antenna 1.5 m high at the back of the room, across 20 m of standing audience (2 persons per m2, heads at 1.75 m). The ray runs through the crowd below head height and loses 26.0 dB, the cap (assumed 0.9 dB per metre per person per m2), so the margin falls from 51.5 to 25.5 dB. Raising the antenna to 2.5 m still leaves 20.3 dB, because a ray just over the heads grazes them within its first Fresnel zone; at 4 m, about 2 m above the heads, 6.6 dB is left. Absorption figures are assumed and unverified.',
    build: () => ({ scene: audienceScene() }),
  },
  {
    id: 'ceiling-metal-roof',
    title: 'Ceiling: a metal-roofed tent or shed over a 15 m link',
    note: 'Problem: a metal roof 5 m up is a near-perfect reflector at 606 MHz. Its ray arrives only 0.9 dB below the direct ray and 1.6 m behind it, and with the floor ray the sum changes the received level by -1.6 dB (it can be a fade or a boost depending on the spot). Move the receiver a little to see the pattern change; wavelength is 0.5 m. Material and geometry are illustrative.',
    build: () => ({ scene: ceilingScene('tent') }),
  },
  {
    id: 'ceiling-arena-flown',
    title: 'Ceiling: arena roof 15 m up, receive antenna flown at 12 m',
    note: 'Less ideal: a flown antenna 3 m under a metal arena roof sits so close to its own reflection that the ceiling ray is only 0.6 dB below the direct one and 2.4 m longer. The coherent sum changes the received level by +4.5 dB at this spot (a different spot can fade). Flown antennas near roofs need height or pattern checks, not just distance. Illustrative figures.',
    build: () => ({ scene: ceilingScene('arena') }),
  },
  {
    id: 'ceiling-low-club',
    title: 'Ceiling: a low plasterboard club ceiling over a 12 m link',
    note: 'Compare: a plasterboard ceiling at 2.8 m reflects much less than metal: its ray is 9.1 dB below the direct ray and 0.3 m longer, a +1.9 dB change in the received level at this spot. Low ceilings add short-delay reflections that move the nulls closer together. Illustrative figures.',
    build: () => ({ scene: ceilingScene('club') }),
  },
  {
    id: 'rof-coax-vs-fibre',
    title: 'RF over fibre: a 300 m antenna run in coax, passive fibre and active fibre',
    note: 'Compare: the receive antenna head is 300 m from the rack. RG213 coax delivers -89.6 dBm to the receiver (margin 5.4 dB); a passive RF over fibre link (assumed -25 dB gain, 30 dB noise figure, 1.1 dB optical loss, so 2.2 dB more RF loss) gives -61.2 dBm with a system noise figure of 36.5 dB; one with built-in amplifiers gives -26.2 dBm at 12.4 dB. The fibre adds 1.47 microseconds of delay, irrelevant for audio. All fibre module figures are assumed placeholders: use a datasheet.',
    build: () => ({ scene: rofScene('passive') }),
  },
  {
    id: 'rof-branch-mismatch',
    title: 'RF over fibre: two antenna branches with different fibre lengths',
    note: 'Problem: an IEM transmitter feeds two antenna branches over passive RF over fibre, 0.1 km and 0.6 km (assumed modules). The delay spread is 2450 ns, so combined at RF the two do not add in phase (1 ns is 216 degrees at 600 MHz) and the link warns. Use equal fibre lengths on branches that are combined coherently. Figures are illustrative.',
    build: () => ({ scene: rofBranchScene() }),
  },
  {
    id: 'sos-iem-too-close',
    title: 'Side of stage: IEM antenna 0.5 m from the mic receiver antenna',
    note: 'Problem: a 100 mW IEM transmitter (20 dBm, 614.0 MHz) faces a mic receive paddle 0.5 m away with the same polarisation and a 12 dB booster behind it. Only 8.2 dB separates them, so +22.3 dBm reaches the receiver input against a -18 dBm P1dB and a -10 dBm maximum (assumed receiver figures): 40.3 dB over, desense capped at 40 dB, and the wanted mic margin falls from 46.3 dB to 6.3 dB. The IM3 product of the IEM and the mic is +32.4 dBm, so the booster makes it worse. Free-space figures; a real room adds or subtracts a few dB.',
    build: () => ({ scene: sosScene('too-close') }),
  },
  {
    id: 'sos-iem-crossed-pol',
    title: 'Side of stage: 3.3 m apart, slant mic antennas, rack in between',
    note: 'Less ideal: the IEM antenna is vertical and the mic antennas slant 45 degrees, so the wanted mic loses 3 dB of polarisation (never a null) and the IEM is only 3 dB cross-polar; they are 3.3 m apart, both paddles aimed at the stage so each sits in the other side lobe, with a rack screen (2.5 dB, assumed) between. Coupling is 46.9 dB, the IEM reaches the receiver at -31.4 dBm with 13.4 dB of headroom, and desense is 0. The wanted mic keeps 50.4 dB of margin, which already includes that 3 dB. A horizontal mic antenna would isolate 14.9 dB more but cost the wanted mic 15.0 dB, so distance and the antenna patterns do the work here.',
    build: () => ({ scene: sosScene('crossed-pol') }),
  },
  {
    id: 'sos-iem-best-practice',
    title: 'Side of stage: best practice (filter, low power, remote antennas)',
    note: 'Best practice: the IEM runs 10 mW (10 dBm) from a stand at the stage-side edge aimed at the stage, and the IEM link still has 40.4 dB of margin. The mic antennas are 10.8 m away, high and behind its beam, slant 45 degrees so the wanted mic loses only 3 dB, with a 604 to 608 MHz bandpass filter (40 dB rejection, assumed) and 15 m of cable. Coupling is 54.9 dB but only -89.5 dBm reaches the receiver input (71.5 dB of headroom, no desense) and the wanted mic keeps 46.5 dB, a margin that already includes the polarisation loss. Distance and the filter do most of the work; power only costs the IEM margin you need.',
    build: () => ({ scene: sosScene('best') }),
  },
  {
    id: 'foh-mic-iem-audience',
    title: 'FOH: low antennas behind a standing crowd',
    note: 'Problem: mic receive and IEM transmit paddles sit at table height (1.2 m) at FOH, 26 m from the performer, behind 18 m of standing crowd at 4 persons per m2 (assumed absorption 0.9 dB per metre per person per m2, capped at 26 dB). The crowd takes 26.0 dB and the performer body 3 dB on the mic link, leaving it 6.0 dB of margin (-89.0 dBm at the receiver input) and the IEM link 17.6 dB. At 1 per m2 the crowd takes 16.2 dB and the mic margin is 15.7 dB; a seated crowd at 1.5 per m2 still leaves only 8.4 dB for the mic and 19.3 dB for the IEM, because a ray just over the seated heads grazes them within its first Fresnel zone.',
    build: () => ({ scene: fohScene('low') }),
  },
  {
    id: 'foh-raised-antennas',
    title: 'FOH: antennas raised to 5 m on a truss',
    note: 'Best practice: the same paddles aimed at the stage on a truss at 5.0 m pass more than 1 m over the heads for most of the crowd: the mic ray keeps only 2.6 dB of absorption and the receiver input rises to -60.7 dBm. The mic margin recovers from 6.0 dB to 34.3 dB (28.3 dB) and the IEM margin from 17.6 dB to 42.4 dB (24.8 dB); the IEM still loses 5.0 dB because the bodypack is low on the performer. Height is the cheapest fix, so raise the antennas before adding gain.',
    build: () => ({ scene: fohScene('raised') }),
  },
  {
    id: 'foh-remote-antennas',
    title: 'FOH: antennas at the stage side, 45 m of cable back to FOH',
    note: 'Best practice: the antennas move to the stage side at 3.0 m, 9 m from the performer and outside the crowd, with 45 m of LMR-400 back to FOH. A 15 dB booster at the antenna end and a 12 dB pad at the receiver input give a mic margin of 63.2 dB and an input of -31.0 dBm, 13.0 dB under P1dB (level ok); without the pad the input would be -19.0 dBm, 1.0 dB under P1dB and hot. The IEM link pays 4.9 dB of cable and has no booster (power limit), so it keeps 55.1 dB; the same booster after the cable gives 61.9 dB, and the active RF over fibre preset (assumed figures, same pad) gives 58.9 dB at -33.1 dBm. Against the low antennas that recovers 57.2 dB on the mic and 37.5 dB on the IEM.',
    build: () => ({ scene: fohScene('remote') }),
  },
  {
    id: 'video-wall-class-b',
    title: 'Video wall: EMC class B noise, FOH versus stage side',
    note: 'Problem: a 14 m LED wall behind the band radiates at the class B limit (30 / 37 dBuV/m at 10 m, a ceiling, assumed). The FOH paddle 27 m away looks straight at it: -98.3 dBm in 200 kHz lifts the floor 14.3 dB and cuts the mic margin from 34.2 dB (wall off) to 19.8 dB. A stage-side receiver sees 18.9 dB of rise but is close to the mic, so it keeps 47.6 dB. The metal wall also returns a reflection only 3.5 dB below the direct ray, so expect multipath. This source does not pulse: the floor is a steady line in the RF spectrum.',
    build: () => ({ scene: videoWallScene({ preset: 'class-b', rx: 'foh' }) }),
  },
  {
    id: 'video-wall-noisy',
    title: 'Video wall: noisy budget panels',
    note: 'Problem: budget panels or poor cabling (class A plus 15 dB, assumed) put -73.3 dBm in the FOH receiver and raise the floor by 39.2 dB, so the mic margin falls to -5.0 dB and the link fails. A wall at the class A limit leaves 10.0 dB. With the receiver at the stage front, 3 m from the wall, the noisy wall still leaves only 8.2 dB, and 22.6 dB with the receiver at the stage side. A CE-marked wall can still be the loudest thing in the band. This source does not pulse: the floor is a steady line in the RF spectrum.',
    build: () => ({ scene: videoWallScene({ preset: 'noisy', rx: 'foh' }) }),
  },
  {
    id: 'video-wall-fixes',
    title: 'Video wall: the fixed scene (distance, aim, cabling)',
    note: 'Best practice: this is the fixed version of video-wall-noisy, whose FOH receiver has a margin of -5.0 dB: the receiver sits at the stage side aimed at the performer with the wall off its beam, and ferrite chokes and shielded data cable bring the wall down to class B (15 dB less, assumed). The noise in the receiver is -93.6 dBm, 18.9 dB of rise, and the mic margin is 47.6 dB, 52.6 dB better. Moving the receiver alone gives 22.6 dB (27.6 dB better) and the class B wall alone 19.8 dB at FOH (24.8 dB better). This source does not pulse: the floor is a steady line in the RF spectrum.',
    build: () => ({ scene: videoWallScene({ preset: 'class-b', rx: 'side' }) }),
  },
  {
    id: 'video-wall-solid-vs-mesh',
    title: 'Video wall: solid metal, mesh and carbon fibre construction',
    note: 'Compare: three wall sections side by side on one stage (solid metal, 10 mm metal mesh and carbon mesh, class A noise), each with a receiver 2.5 m behind it: the crossing loss is 40.0, 27.9 and 28.9 dB, and the noise reaching each receiver is -87.5, -72.1 and -75.0 dBm (the solid one includes the neighbouring walls leaking in), leaving margins of 12.7, -2.6 and 0.2 dB. Seen from FOH the metal and metal mesh both reflect at -3.5 dB and carbon at -9.5 dB. Holes of 100 mm (a coarse curtain) shield only 7.9 dB at 606 MHz, so a mesh wall is no free pass at UHF. All construction figures are assumed. This source does not pulse: the floor is a steady line in the RF spectrum.',
    build: () => ({ scene: videoWallScene({ preset: 'class-a', rx: 'back', sections: ['solid-metal', 'mesh-metal', 'mesh-carbon'] }) }),
  },
  {
    id: 'even-wideband-booster',
    title: 'Even-order products: 500 and 700 MHz mics on a wideband booster',
    note: 'Problem: two mics on 500 and 700 MHz, 2.5 m from the receive antenna, drive a wideband booster (IIP2 +30 dBm, assumed): the sum (1200 MHz) and difference (200 MHz) products are both -88.7 dBm, 24.3 dB over the receiver noise floor, and fall 2 dB per dB of input against 3 dB for IM3. Neither lands in the 600 MHz channel, but the 200 MHz one sits in a VHF band the system also uses. A 470-698 MHz bandpass behind the booster (40 dB, assumed) takes both to -128.7 dBm, 15.7 dB under the floor.',
    build: () => ({ scene: evenScene('wideband') }),
  },
  {
    id: 'even-vhf-uhf-booster',
    title: 'Even-order products: VHF and UHF mics into one booster',
    note: 'Problem: a 190 MHz VHF mic and a 475 MHz UHF mic share one wideband booster and the receiver listens on 665 MHz: f1 + f2 is exactly 665 MHz, -76.9 dBm in the wanted channel and 36.1 dB over the floor. A 470-698 MHz bandpass in front of the booster (60 dB, assumed) removes the VHF tone before it can mix and drops the product to -136.9 dBm. Separate antennas or a filter ahead of any shared gain stage is the fix.',
    build: () => ({ scene: evenScene('vhf-uhf') }),
  },
  {
    id: 'even-second-harmonic',
    title: 'Even-order products: a 902 MHz IEM transmitter and a 1.8 GHz bodypack',
    note: 'Problem: a 902 MHz IEM transmitter 1.5 m from a 1795 MHz bodypack radiates a second harmonic 50 dB down (assumed), arriving at -74.1 dBm in the 1785-1805 MHz band, 38.9 dB over the floor. A 60 dB low-pass on the transmitter output (assumed) takes it to -134.1 dBm, 21.1 dB under the floor. The bodypack filter keeps the 902 MHz carrier itself out of the receiver, so the harmonic is the only even-order problem.',
    build: () => ({ scene: evenScene('harmonic') }),
  },
  {
    id: 'even-narrow-uhf-good',
    title: 'Even-order products: narrow-band UHF, the good case',
    note: 'Best practice: two UHF mics 8.2 MHz apart into a narrow-band receiver (IIP2 +40 dBm, assumed) give a sum near 1220 MHz and a difference of 8.2 MHz at -99.2 dBm, none in the wanted channel or any other band the system uses. Only the third-order product 2f1-f2 at -72.8 dBm matters here. Keep the wanted bands apart by more than an octave and even order products stay out of band.',
    build: () => ({ scene: evenScene('narrow-uhf') }),
  },
  {
    id: 'tone-pilot-products',
    title: 'Programme tone and the 19 kHz pilot: where the products come from',
    note: 'Problem: a 1 kHz sine at 40 percent of 75 kHz peak deviation (30 kHz, beta 30) rides with the 10 percent pilot (7.5 kHz, beta 0.395). In the baseband the two only add, but a limiter 6 dB under its nominal drive (assumed) puts products at 18 and 20 kHz (-49.5 dB), 17 and 21 kHz (-60.2 dB) and 37 and 39 kHz (-72.4 dB), and the pilot cubed lands at 57 kHz (-94.3 dB) in the RDS band. In the RF the FM itself adds sidebands at fc +- n x 1 kHz +- m x 19 kHz with weights J_n(30) J_m(0.395), filling about 102 kHz. Cures: a low-pass before the limiter, no limiting of the composite, and a pilot-notched limiter.',
    build: () => ({ scene: toneMpxScene('products') }),
  },
  {
    id: 'tone-pilot-beat',
    title: 'Programme tone near the pilot: a 19.3 kHz tone beats with it',
    note: 'Problem: a 19.3 kHz tone leaks past the 15 kHz audio low-pass, which is only 41.4 dB down there (assumed filter), leaving it 28.4 dB under the 9 percent pilot. It beats with the pilot at 300 Hz, inside the decoder loop bandwidth (assumed), wobbling the pilot phase by up to 2.2 degrees and costing stereo separation. A tone above 23 kHz would fold down through the L-R demodulator instead (25 kHz appears at 13 kHz). Keep the tone at 15 kHz or lower, steepen the filter or notch the pilot region.',
    build: () => ({ scene: toneMpxScene('beat') }),
  },
  {
    id: 'tone-sweep-pilot',
    title: 'Swept tone through the MPX: the moment it reaches the pilot',
    note: 'Problem: a swept tone passes 17 kHz where the assumed filter is only 21.2 dB down, leaving it 8.2 dB under the pilot and wobbling its phase by up to 22.8 degrees at a 2000 Hz beat. This is where the stereo decoder flickers or drops lock. The same sweep above 23 kHz folds down by 38 kHz through the L-R path. The cure is a steeper audio filter with the limiter placed after it.',
    build: () => ({ scene: toneMpxScene('sweep') }),
  },
  {
    id: 'tone-key-harmonics',
    title: 'Mono mic: a 10.9 kHz tone overloaded lands its third harmonic on the tone-key',
    note: 'Problem: a 10.9 kHz tone at 60 percent deviation with the stage at its nominal limit (0 dB) has a third harmonic at 32.7 kHz, -36.6 dB under 100 percent modulation. The assumed 32.768 kHz tone-key window is 1 kHz wide, so the harmonic sits inside it and can hold the squelch open or mute it. Tone-key frequencies are not published for real systems, so check on the bench. Cures: low-pass the audio after the limiter, back off the level, or notch the tone-key frequency.',
    build: () => ({ scene: toneMpxScene('tone-key') }),
  },
  {
    id: 'tone-overdeviation',
    title: 'Overdeviation: a loud tone plus the pilot passes 100 percent',
    note: 'Problem: a 1 kHz tone at 95 percent of peak deviation plus the 9 percent pilot sums to 104 percent, 0.3 dB over the limit, so the limiter clips (beta 71). The third harmonic sits at -28.4 dB, the J0 J0 carrier term falls to -33.9 dB as the Bessel weights spread over about 186 kHz, and products at 18 and 20 kHz reach -36.9 dB. The pilot cubed lands at 57 kHz (-86.2 dB) in the RDS band. Limit the programme before the pilot is added and keep the tone below 91 percent.',
    build: () => ({ scene: toneMpxScene('overdev') }),
  },
];
