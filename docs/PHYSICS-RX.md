# Physics notes: receiver overload and diversity

Data lives in `js/model/rx-params.js`; maths in `js/model/overload.js` and `js/model/diversity.js`.

All presets are generic and illustrative. They describe a plausible class of receiver, not any product. Datasheets rarely give P1dB or IIP3; look for maximum input level, blocking and intermodulation rejection figures for the receiver you actually use.

## 1. Front-end overload

### Levels
- Sensitivity (scene default: mic -90 dBm, IEM -85 dBm) is the bottom of the range. The AGC reduces gain as the input rises; it runs out at sensitivity + `agcRangeDb` (about -25 dBm in the mic and IEM presets, -35 dBm in the budget preset).
- The 1 dB compression point (`p1dBDbm`, input referred) is where the front end (filter, LNA, first mixer) gain is already 1 dB low. Above it, the AGC cannot help, because the nonlinear stage sits before the controlled gain.
- `maxInputDbm` is the level the manufacturer allows before damage or hard clipping; it is above P1dB.
- Ordering in every preset: sensitivity + AGC range < P1dB < max input. A test enforces it.

### Compression and desensitisation
- Single strong signal: gain falls 1 dB at P1dB and then about 1 dB per dB (output saturates). A constant-envelope FM signal tolerates its own compression well, so a single overloaded wanted carrier is not necessarily distorted.
- A strong unwanted signal (blocker) compresses the gain seen by a weak wanted signal. For a cubic nonlinearity the cross-compression is about twice the self-compression in dB (approx), so a blocker 3 to 5 dB below P1dB already costs the weak signal around 1 dB. The weak link behaves as if its sensitivity were worse by that amount: desensitisation.
- Real receivers also lose sensitivity from reciprocal mixing and phase noise of the local oscillator with blockers at small offsets; not modelled.

### Third-order intermodulation
- Two equal carriers at level P (dBm, at the input) produce IM3 products at 2 f1 - f2 and 2 f2 - f1. Input referred, IM3 = 3 P - 2 IIP3 (dBm), a 3:1 slope: 1 dB more input gives 3 dB more IM3. Relative to each carrier, IM3 = 2 (P - IIP3) dBc.
- For a memoryless cubic nonlinearity IIP3 is about P1dB + 9.6 dB (approx; presets use about +10 dB).
- When the products fall on the wanted channel they act as an extra signal or noise. IM3 reaches the receiver noise floor when P = (N + 2 IIP3) / 3. Worked values for the mic preset (IIP3 -8 dBm, N = -174 + 53 + 8 = -113 dBm in 200 kHz): P = -43 dBm. So two neighbouring transmitters at -43 dBm each, which is easy at a few metres, put IM3 at the noise floor and raise the effective noise over a weak wanted signal.
- Typical trouble spot: several mic or IEM transmitters (or the IEM transmitter antennas) within a metre or two of the receive antenna, often with a booster.

### Overload threshold with hysteresis
- State machine used by the model: 'ok' below P1dB - hot margin (10 dB), 'hot' from there to P1dB, 'overload' at or above P1dB (or max input if lower). To leave a state the input must fall `overloadHysteresisDb` (2 to 3 dB) below the entry threshold, so the indicator does not flicker.

### What the audio does
- Not necessarily muted. The AGC and squelch are measuring the same strong level, so the squelch stays open. The listener hears sudden hiss or crackle and "birdies", distortion of the wanted signal that rides on other transmitters' products, and noise bursts when products drift. In severe cases dropout or a loud burst. Overload is not a low-level problem, so a plain level meter can show a perfectly good signal while the audio is bad.

### Remedies
- Insert an attenuator pad at the receive antenna (or use the receiver's front-end attenuator): it lowers all signals by the pad value, so IM3 falls 3 dB per dB while the wanted signal falls 1 dB per dB, a net 2 dB improvement per dB. Do not pad so far that the wanted link loses margin.
- Increase distance between the receive antenna and strong transmitters; each doubling of distance cuts the level 6 dB in free space.
- Use directional antennas aimed at the stage and away from other transmitters.
- Use fewer boosters. Only boost when cable loss would otherwise limit the noise figure. A booster before the receiver also amplifies the unwanted carriers and reduces headroom.
- Use a bandpass filter ahead of the first stage when the interferers are outside the band.
- Space operating frequencies so that 2 f1 - f2 does not fall on a used channel (intermodulation-free frequency coordination).

## 2. Diversity

### Why antennas fade differently
Multipath sums a direct and several reflected waves. The sum has deep nulls every half wavelength or so along a line. A second antenna about half a wavelength or more away sits at a different point of the interference pattern, so it rarely sits in a null at the same time. Example: at 600 MHz, lambda is 0.5 m; at 1.8 GHz it is 0.17 m. The deterministic image-based model in `rf.js` already produces different fades at different positions, so no random fading is needed.

### Spatial correlation (Clarke / Jakes)
- Field correlation between two antennas a distance d apart in an isotropic scattering field is J0(2 pi d / lambda). The first zero is at 2 pi d / lambda = 2.405, i.e. d = 0.383 lambda. The envelope correlation is about J0 squared: 0.09 at d = 0.5 lambda, 0.22 at 0.25 lambda, 1 at zero spacing.
- Rule of thumb: half a wavelength or more (`SPACING_RULES`). Closer than about a quarter wavelength the antennas see nearly the same fades and the gain shrinks. In real stages scattering is not isotropic and the correlation is higher for directional antennas aimed the same way; treat J0 as an approximation.

### Schemes
- Antenna switching diversity: one receiver, two antennas, a switch. Stays on the current antenna until its level falls below a threshold (or the other is better by the hysteresis), then switches. Switch time and hold-off of a few ms, hysteresis a few dB (presets: 3 dB, 2 ms). The decision uses the level before the switch, so it can pick the worse antenna, and the switch can click.
- True diversity: two receivers, each with its own antenna. The audio follows the better one, with a small hysteresis (preset: 2 dB, 0.5 ms crossfade). Level follows max(A, B).
- Ratio / maximal-ratio combining: branches are co-phased and summed with weights proportional to their SNR. Output SNR is the sum of branch SNRs, so it is never worse than the best branch and for equal branches gains 3.01 dB.

### Expected gain in Rayleigh fading (uncorrelated branches, 2 branches)
Single branch outage probability for a level x (relative to the mean power): P = 1 - e^-x. Selection of two branches: (1 - e^-x)^2. Maximal ratio: 1 - e^-x (1 + x). The gain is the improvement of the level not exceeded with the stated probability.

| Fade probability | Selection / true | Maximal ratio | Switching (approx) |
|---|---|---|---|
| 10 % | 5.6 dB | 7.0 dB | 4.5 dB |
| 1 % | 10.2 dB | 11.7 dB | 8 dB |

The gain is largest for the deepest, rarest fades, which is exactly what causes dropouts. Mean-level gain is small (0 to 3 dB). Correlated branches reduce these figures. Sources: Brennan 1959; Jakes, Microwave Mobile Communications.

### Not modelled
- Random (statistical) fading, Doppler from moving performers, polarisation diversity, cable differences between the two antennas other than the shared chain.

## Sources
- Razavi, RF Microelectronics; Pozar, Microwave Engineering (compression, intercept, cascade).
- Jakes, Microwave Mobile Communications (Clarke model, diversity); Brennan, "Linear diversity combining techniques" (1959).

## Review of overload.js
Reviewed `js/model/overload.js`. The 3:1 IM3 law, the dBc form 2 (Pin - IIP3), the compression curve (1 dB exactly at P1dB, 1 dB per dB beyond) and the hysteresis state machine are correct. Hand check for the mic preset: IM3 at -30 dBm per tone is -74 dBm.

Issues and suggestions:
1. AGC definition mismatch. `agcAttenDb` measures the AGC range downward from `maxInputDbm`, so it starts at maxInput - range (-75 dBm for the mic preset). The parameter note defines the AGC as running from sensitivity to sensitivity + range (-25 dBm), i.e. out of range well below max input. Suggest `agcAttenDb = clamp(input - sensitivityDbm, 0, agcRangeDb)` and a flag `agcExhausted = input > sensitivityDbm + agcRangeDb`. The parameter file supplies `sensitivityDbm` for this.
2. `distortionPct = 100 * 10^(IM3dBc/20)` is the two-equal-carrier IM3 amplitude relative to one carrier. It is not the distortion of a single wanted FM carrier, which is largely unaffected by compression. Label it "two-carrier IM3" in the UI.
3. `desenseDb` adds the self-compression to the noise rise. Cross-compression of a weak signal by a blocker is about twice the self-compression in dB (cubic nonlinearity), so a strong blocker is slightly under-reported. Acceptable for a demonstration.
4. `hotMarginDb` is a fallback in the model; the presets now supply it (10 dB) so both agree.
5. `baseConfig()` now uses `RX_DEFAULTS` (the bodypack preset), which is consistent with the parameter file. Callers should still pass the preset explicitly when the receiver type matters. The top-level `await import` with a silent catch is legal; a plain static import would fail loudly.
6. Info: noise-floor bandwidth is a fixed 200 kHz, not the link's channel bandwidth.

## Review of diversity.js
Reviewed `js/model/diversity.js`. The three modes are implemented correctly: switching with hysteresis, hold-off and a below-threshold escape, true as instantaneous best with ties keeping the current antenna, ratio as a power sum (equal to the SNR sum for equal noise, so 3.01 dB for equal levels). `gainDb` reports 0 for true, 0 or less for switching, up to 3.01 for ratio. Fading statistics come from geometry (`solveDiversity`, `sweepLink`), which is the right approach for this planner.

Issues and suggestions:
1. Mode key mismatch. The model reads `mode` ('switching' | 'true' | 'ratio') but the presets originally carried only `combining`, so passing a preset such as 'ratio' would have left the mode at the fallback 'switching'. Fixed in `rx-params.js`: each preset now has `mode` equal to its id (a test checks it).
2. The "gain" in the summary is a mean-level number (0 to 3 dB). The physically meaningful diversity gain is the reduction of fade depth at a given probability (10 to 12 dB at 1 %). Use `fadeDepthStats` on `singleBestDbm` versus `aDbm` along a sweep to show that figure, and cite section 2.
3. No spacing check: if `antennaB` is closer than about 0.3 lambda to A the fades are correlated and the demonstration will show little gain. Suggest a UI hint using `SPACING_RULES`.
4. `switchMs` is a hold-off in the model while the preset describes the decision plus audio-mute time. Both mean "do not switch again within this time"; consistent enough.
5. Info: the sweep uses the same cable chain and body loss for both antennas; per-antenna cable loss would need a second chain.
