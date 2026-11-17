// EXAMPLES entries: noise sources, weak and strong TV, booster overload, mode contrast, body-worn and diversity.
import { ACROSS } from './helpers.js';
import { noiseSourceScene } from './scenes-review.js';
import { weakTvScene, boosterOverloadScene, modeContrastScene, bodyWornScene, diversityCombiningScene } from './scenes-signal.js';

export const NOISE_TV_EXAMPLES = [
  {
    id: 'noise-flash-at-pit',
    title: 'Noise: a speedlight at the photo pit',
    note: 'Problem: a photographer\'s speedlight 2 m from the FOH receive antenna is a 1 ms broadband click about 3 times a second (duty 0.3 percent, assumed): -49.9 dBm at its peak but only -75.1 dBm on average. The average lifts the floor by 36.9 dB and leaves 17.4 dB of margin, and the peak is 62.1 dB above the floor, the pop on the squelch. Keep flashes away from the antenna and use a filtered, shielded run (figures assumed). Select the link and watch the RF spectrum: the floor jumps to the peak with each flash, about three times a second, and falls back in between, in time with the plan rings; the margin quoted is the average.',
    build: () => ({ scene: noiseSourceScene('flash-at-pit') }),
  },
  {
    id: 'noise-ptt-beside-bodypack',
    title: 'Noise: a PTT radio beside an IEM bodypack',
    note: 'Problem: a 2 W business UHF handheld keyed 1.5 m from the IEM bodypack puts -9.1 dBm at the antenna, 83.1 dB above what the 606 MHz channel filter passes (selectivity assumed). In the channel that is -92.3 dBm while keyed and -97.5 dBm on average (30 percent duty), a 13.7 dB floor rise and 37.3 dB of margin. A 0.5 W PMR446 radio gives 7.4 dB and 43.6 dB, so keep crew radios away from bodypacks (figures assumed). In the RF spectrum the floor steps up while the radio is keyed and drops back when it is released, in time with the plan rings; the margin quoted is the duty-weighted average.',
    build: () => ({ scene: noiseSourceScene('ptt-beside-bodypack') }),
  },
  {
    id: 'noise-phone-buzz',
    title: 'Noise: a GSM phone near the FOH receiver',
    note: 'Problem: a GSM 900 phone 1 m from the receive antenna bursts 2 W (33 dBm) for 0.577 ms every 4.615 ms, the 217 Hz frame: +1.9 dBm at the antenna, -87.4 dBm in the channel at the peak and -96.4 dBm on average (duty 12.5 percent). The floor rises 15.7 dB; the audible 217 Hz buzz from an audio cable or preamp that demodulates the burst is not modelled. Put phones in flight mode or away from antennas and cables (figures assumed). In the RF spectrum the floor pulses 217 times a second, too fast to follow by eye, so it reads as a flicker between the peak and average levels, in time with the plan rings; the margin quoted is the average.',
    build: () => ({ scene: noiseSourceScene('phone-buzz') }),
  },
  {
    id: 'noise-dimmer-circuit',
    title: 'Noise: a dimmer rack near the receiver',
    note: 'Less ideal: a triac dimmer 3 m from the receive antenna chops twice per mains cycle (120 Hz, duty 1.2 percent, assumed) and is strong at VHF but weak at 606 MHz: -90.6 dBm at the peak, -109.8 dBm on average, a 4.2 dB floor rise and 50.1 dB of margin. Through the air it is a small problem at UHF; the buzz that reaches the audio comes through cables and the mains, so use balanced audio and filtered power (figures assumed). In the RF spectrum the floor pulses with the dimmer, 120 times a second, in time with the plan rings; the margin quoted is the average.',
    build: () => ({ scene: noiseSourceScene('dimmer-circuit') }),
  },
  {
    id: 'noise-eng-press-pit',
    title: 'Noise: an ENG crew at the press pit',
    note: 'Problem: an ENG crew at the barrier (camera transmitter, two PTT radios, an LED light and a van generator, about 12 m from the FOH receiver) raises the floor by 17.6 dB together and leaves 36.7 dB of margin. The LED light dominates at -97.2 dBm, then the generator at -98.6 dBm, the PTT radios at about -108 dBm average, and the 2.3 GHz camera transmitter only -115.8 dBm because it is far out of band. Agree lights off, radios and generator away from the antennas with the press (figures assumed). The RF spectrum shows continuous and keyed parts together: the LED light and generator lift the floor steadily, while the PTT radios pulse on top of it in time with the plan rings; the margin quoted is the average.',
    build: () => ({ scene: noiseSourceScene('eng-press-pit') }),
  },
  {
    id: 'tv-weak-on-channel',
    title: 'Weak TV: a mic on top of a weak local channel',
    note: 'Less ideal: a mic 0.4 MHz above the centre of UK channel 33 (566 to 574 MHz) shares the block with a weak local transmitter (-85 dBm at the antenna, assumed). The 7.6 MHz block is flat noise, so a 200 kHz mic channel sees 15.8 dB less, -100.8 dBm, which lifts the floor by 11.5 dB and leaves 43.3 dB of margin. It works as a fallback if the channel is licensed or permitted; check the local database and scan first. The occupancy is illustrative. This source does not pulse: the floor is a steady line in the RF spectrum.',
    build: () => ({ scene: weakTvScene('on-channel') }),
  },
  {
    id: 'tv-weak-free-gap',
    title: 'Weak TV: the mic moved to a free gap',
    note: 'Best practice: the same mic on channel 30 (542 to 550 MHz), two channels from the nearest transmitters on 33 and 34 in the illustrative occupancy. The weak block is now 65.9 dB down (selectivity assumed), the floor rise is 0.0 dB and the margin is 55.3 dB. A free channel costs nothing: prefer it to any shared one. This source does not pulse: the floor is a steady line in the RF spectrum.',
    build: () => ({ scene: weakTvScene('free-gap') }),
  },
  {
    id: 'tv-weak-strong-neighbour',
    title: 'Weak TV: weak channel with a strong adjacent block',
    note: 'Less ideal: the mic stays on weak channel 33 but channel 34 next door is strong (-45 dBm at the antenna, assumed). The adjacent block is held 51.6 dB down by the receiver selectivity (assumed), -96.6 dBm in the channel, so with the weak block the floor rises 16.9 dB and the margin falls to 38.0 dB. A real filter skirt decides this one: measure it or move away. This source does not pulse: the floor is a steady line in the RF spectrum.',
    build: () => ({ scene: weakTvScene('strong-neighbour') }),
  },
  {
    id: 'tv-strong-cochannel',
    title: 'Strong TV: the failure contrast, a strong signal in the channel',
    note: 'Problem: the same mic on channel 33 where the block is strong (-45 dBm at the antenna, assumed) puts -60.8 dBm of noise in the 200 kHz channel. The floor rises 51.2 dB and only 3.7 dB of margin is left, so the link is marginal. A strong broadcast channel is not usable: pick another one. This source does not pulse: the floor is a steady line in the RF spectrum.',
    build: () => ({ scene: weakTvScene('strong-cochannel') }),
  },
  {
    id: 'booster-overloaded-by-radio',
    title: 'Booster overload: a keyed crew radio 1 m from the receive antenna',
    note: 'Problem: a 12 dB booster sits straight on the receive antenna and a crew radio (33 dBm ERP, assumed) is keyed 1 m away, putting +1.9 dBm at the antenna. The booster would put out 13.9 dBm against an output 1 dB point of 10.4 dBm (OIP3 20 dBm assumed, minus 9.6 dB), so it compresses 3.5 dB and the wanted mic loses the same. The margin falls from 7.6 dB without the booster to 4.1 dB, only while the radio is keyed. A booster raises weak signals and everything strong beside them.',
    build: () => ({ scene: boosterOverloadScene('overloaded') }),
  },
  {
    id: 'booster-filtered-before-radio',
    title: 'Booster behind a bandpass filter: the radio never reaches it',
    note: 'Best practice: the same booster behind a 600 to 612 MHz bandpass filter (30 dB stopband rejection and DC-passing, both assumed) sees the crew radio at only -17.6 dBm at its output. It stays far below the 10.4 dBm output 1 dB point, so there is no compression and the margin is 7.6 dB, the same as with no radio keyed. The filter costs 1.5 dB of loss but it protects the booster from every out-of-band transmitter. Compare with the overloaded example, where the margin is 4.1 dB.',
    build: () => ({ scene: boosterOverloadScene('filtered') }),
  },
  {
    id: 'analog-fm-weak-gradual',
    title: 'Analogue FM at -107 dBm: noisy, but still there',
    note: 'Compare: at -107 dBm the receiver sees a CNR of 6.0 dB, 5.0 dB under the FM threshold knee of 11 dB (assumed). The audio is hissy at 19.5 dB SNR but the voice is still carried, and it was 51.5 dB at -85 dBm: analogue noise grows gradually as the signal falls. The FM signal takes 110 kHz of the 200 kHz channel (Carson). The next example is the digital mic at the same level.',
    build: () => ({ scene: modeContrastScene('analog-fm', 'weak') }),
  },
  {
    id: 'digital-weak-cliff',
    title: 'Digital mic at -107 dBm: the same level, the cliff',
    note: 'Compare: the same -107 dBm with a digital mic (fixed QPSK 3/4 in a 200 kHz channel, assumed) is 1.1 dB under the frame-error cliff and the audio is muted. The cliff is only 0.6 dB wide, from a frame error rate of 1e-3 at -105.6 dBm to 90 percent at -106.3 dBm, so the audio is perfect one moment and gone the next. At -85 dBm it is clean with 20.9 dB to spare. Digital is the better link until it fails, and then it fails all at once.',
    build: () => ({ scene: modeContrastScene('digital', 'weak') }),
  },
  {
    id: 'body-worn-thin-margin',
    title: 'Body-worn link with a thin margin: not proven',
    note: 'Problem: a bodypack 70 m from the receiver has 7.6 dB of margin, with 10 dB of body loss and a 15 dB cross-polar floor (horizontal against vertical antennas, which is why the model warns about polarisation) both assumed. A body-worn margin under 10 dB is not called proven, because body loss changes by several dB with posture. The assumptions could move it by about 7.1 dB (10.0 dB if every error went the wrong way). Shorten the path, align the antennas, or walk-test it.',
    build: () => ({ scene: bodyWornScene('thin') }),
  },
  {
    id: 'body-worn-proven-twin',
    title: 'The same bodypack 25 m away: a proven margin',
    note: 'Best practice: the same bodypack 25 m from the receiver has 16.5 dB of margin, over the 10 dB a body-worn link needs and over the 7.1 dB the assumptions could take off. It is called proven although the same assumed 10 dB body loss and 15 dB cross-polar floor are in it (the polarisation warning is that deliberately assumed floor, and aligning the antennas would add margin again). Compare with the 70 m case, where the margin is 7.6 dB.',
    build: () => ({ scene: bodyWornScene('short') }),
  },
  {
    id: 'diversity-correlated-antennas',
    title: 'Diversity with antennas 0.1 wavelength apart: the same fades',
    note: 'Problem: antenna B sits 0.05 m (0.1 wavelength) from antenna A, so both see the same floor-reflection fade of 8.8 dB. Switching and selection combining gain 0.0 dB at the 1 percent level because there is nothing better to switch to. Maximal-ratio combining gains only its 3.0 dB for adding two copies of the same signal. Spacing the antennas fixes the fade, not combining.',
    build: () => ({ scene: diversityCombiningScene('correlated'), walk: ACROSS }),
  },
  {
    id: 'diversity-spaced-antennas',
    title: 'Diversity with antennas 0.8 wavelength apart: combining modes compared',
    note: 'Compare: antenna B is 0.4 m (0.8 wavelength) above A, so its fade falls at a different distance. At the 1 percent level switching gains 4.9 dB, selection 6.5 dB and maximal-ratio 8.8 dB over one antenna, and the worst fade shrinks from 8.8 dB to 4.3 dB with ratio combining. Switching trails selection because it waits for a 3 dB hysteresis before it moves. Compare with the 0.1 wavelength case, where none of this is available.',
    build: () => ({ scene: diversityCombiningScene('spaced'), walk: ACROSS }),
  },
];
