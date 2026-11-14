# Physics notes: FM MPX stereo link and pilot tones

Data lives in `js/model/mpx-params.js`; maths in `js/model/mpx.js`.

All presets are generic and illustrative. They model a textbook FM multiplex (MPX) stereo link in the style of ITU-R BS.450. Real in-ear-monitor systems differ: some use proprietary pilot frequencies or pilot-tone squelch schemes at other frequencies, companding and special pre-emphasis, other deviations, or digital links with no FM multiplex at all. Do not read the numbers as the behaviour of any product.

## 1. Receiver noise and CNR
- Thermal noise: N = -174 dBm/Hz + 10 log10(B_Hz) + NF. kT at 290 K is -173.98 dBm/Hz.
- Channel noise bandwidth B: about 200 kHz for an IEM channel; allowed 100 to 300 kHz.
- CNR = input level (dBm, at the receiver input) - N.
- Worked values: B = 200 kHz, NF 8 dB gives -113.0 dBm; B = 300 kHz, NF 9 dB gives -110.2 dBm; B = 200 kHz, NF 7 dB gives -114.0 dBm. Each doubling of B costs 3 dB.
- The existing link budget (`inputPowerDbm`) feeds this directly: CNR = inputPowerDbm - noise floor.

## 2. FM threshold and mono audio SNR
- Above threshold, for tone modulation: SNR_audio = (3/2) beta^2 (B / W) CNR_B, with beta = peak deviation / W, W the audio bandwidth. In dB: SNR = CNR + I, with I = 10 log10(1.5 beta^2 B / W).
- With B equal to the Carson bandwidth 2 (dev + W), this becomes the textbook 3 beta^2 (beta + 1).
- Worked values: dev 75 kHz, W 15 kHz, B 200 kHz: beta 5, I = 27.0 dB. dev 50 kHz, B 200 kHz: beta 3.33, I = 23.5 dB. dev 75 kHz, B 300 kHz: I = 28.8 dB. A wider deviation buys improvement, which is why wideband FM beats narrowband above threshold.
- Threshold: below about 10 to 12 dB CNR (in the channel bandwidth) click noise appears and the improvement collapses. Presets use 11 to 12 dB.
- Below threshold the model uses a straight line (approx): SNR falls `belowThresholdSlope` dB (3) per dB of CNR lost. Real receivers behave less cleanly and depend on the discriminator and squelch.
- Not modelled: pre-emphasis and de-emphasis (which add several dB of audio SNR), companding, weighting, threshold-extension circuits. `snrCeilingDb` caps the result at the audio-chain limit.

## 3. Stereo penalty
- L+R sits at 30 Hz to 15 kHz. L-R is DSB-SC around 38 kHz, so it occupies 23 to 53 kHz.
- FM discriminator noise has a triangular density (power proportional to f^2). Integrating over the L-R band against the L+R band: 10 log10((53^3 - 23^3) / 15^3) = 16.1 dB. Coherent DSB-SC demodulation and the matrixing (L = M + S, R = M - S) add a few dB more, and part of the deviation is taken by the pilot.
- The standard published result is that stereo reception is about 20 to 23 dB noisier than mono at the same CNR (approx; the figure depends on assumptions about deviation share and weighting). Presets use 22 dB (broadcast-like) and 21 dB (IEM).
- Consequence: at 75 kHz deviation and 200 kHz bandwidth, mono SNR is CNR + 27 dB, stereo is CNR + 5 dB. A stereo link needs about 20 dB more CNR than mono for the same hiss level, which is why receivers shed stereo first.

## 4. Stereo-to-mono blend
- Blend law: a smoothstep in CNR from `blendEndCnrDb` (0, mono) to `blendStartCnrDb` (1, full stereo). It has no hysteresis, so the audio does not chatter. Blend is exposed as 0..1, 1 = stereo.
- Decoder: l' = b l + (1 - b)(l + r)/2, similarly r'. L bleeds into R with amplitude (1 - b)/2.
- Separation: 20 log10((1 + b) / (1 - b)) for ideal blending, so b = 0.9 gives about 25.6 dB, b = 0.5 about 9.5 dB, b = 0 gives 0 dB. The model adds a residual crosstalk floor (`maxSeparationDb`) and a noise-limited cap at low CNR.
- Presets (start / end CNR): broadcast-like 36 / 24 dB, iem-typical 30 / 18 dB, iem-wideband 32 / 20 dB. Broadcast-like is conservative: it gives up stereo while mono is still very clean. These are design values, not measurements (approx).

## 5. Pilot and pilot-tone squelch
- Pilot at 19 kHz, injection 8 to 10 percent of peak deviation (9 percent used; level -20.9 dB relative to 100 percent modulation). Subcarrier at 38 kHz, exactly twice the pilot, suppressed. L-R 23 to 53 kHz, L+R 30 Hz to 15 kHz. The pilot sits in the 15 to 23 kHz gap.
- Pilot detection: a pilot detector (PLL or comparator) locks when the pilot is clearly above noise. In a narrow detector bandwidth the pilot SNR can in principle be high even at low CNR (pilot SNR = CNR + 10 log10(delta_p^2 B / (2 f^2 b)), where delta_p is the pilot deviation and b the detector bandwidth), but below FM threshold click noise destroys it. So practical lock is a design value: presets detect at 16 to 18 dB and drop out 3 to 4 dB lower (hysteresis, as in carrier squelch).
- Stereo decoding requires a locked pilot. Without one the decoder is mono regardless of blend.
- Carrier squelch (the existing `squelchState`, in dBm) opens on any sufficient RF level, so an interferer of adequate strength opens it and its noise or audio is heard.
- Pilot-tone squelch additionally requires the valid pilot. It mutes when the pilot is lost or not locked, and rejects interference, noise bursts and other-channel carriers that do not carry the pilot. The trade-off is that the receiver also mutes whenever the wanted link fades enough to lose the pilot, even though a hissy signal might still have been usable. It does not defeat a co-channel interferer that is stronger and itself carries a pilot.
- Ordering of the CNR points in every preset: FM threshold <= pilot lose < pilot detect <= blend end < blend start. The tests enforce it.

## 6. Parameter file notes
- `MPX_PRESETS` entries carry the primary names (`channelBwKhz`, `pilotLoseCnrDb`, ...) and derived aliases read by mpx.js (`bandwidthHz`, `pilotHysteresisDb`, `pilotInjection`, `fmImprovementDb`). They are computed in one place so they cannot disagree; a test checks it. `MPX_DEFAULTS` equals `iem-typical`.
- `fmImprovementDb` in the presets uses the channel bandwidth (formula in section 2). mpx.js falls back to the Carson form 3 beta^2 (beta + 1) when the key is absent.

## Sources
- ITU-R BS.450 (FM sound broadcasting transmission standards, pilot-tone system).
- Haykin, Communication Systems; Taub and Schilling, Principles of Communication Systems (FM noise, threshold, triangular noise).
- Standard broadcast engineering texts on FM stereo (the 20 to 23 dB stereo noise penalty).

## Review of mpx.js
Reviewed `js/model/mpx.js` (final version) against this note. The model matches the physics at the level of a demonstration.

Confirmed correct:
- Noise floor -174 + 10 log10(B) + NF and CNR = input - floor; checked -112.99 dBm for 200 kHz, NF 8.
- Blend is a smoothstep exposed as 0..1; the decoder matrix and `lrLeakOf` ((1 - b)/2) are correct; the separation law ((1 + b)/2 over (1 - b)/2 + residual) equals 20 log10((1 + b)/(1 - b)) without the residual.
- Pilot hysteresis follows `squelchState`; no lock means blend 0 (mono). Pilot level 20 log10(injection) = -20.9 dB at 9 percent.
- The L-R spectral level follows 20 log10(blend), and the noise slope is +6.02 dB per octave (triangular).
- `pilotInjection` is now in `MPX_DEFAULTS` and in every preset (0.09), and mpx.js reads it.

Issues found and status:
1. Fixed during review: with an empty or partial config, `stereoBlend(40)`, `noiseFloorDbm()` and similar returned 0 or NaN because destructured undefined keys overwrote the fallbacks. The final `cfgOf` handles it (verified: `stereoBlend(40)` is 1, `noiseFloorDbm()` is -112.99).
2. Stereo penalty is applied as `penalty * blend` in dB. Physically, partial blend adds the L-R noise as b^2 in power, so SNR = SNR_mono - 10 log10(1 + b^2 (10^(penalty/10) - 1)). The two agree at b = 0 and 1 but differ in between (at b = 0.5 and 22 dB penalty: 11 dB linear versus 17.9 dB power law). Minor and conservative for a demonstration; recommend the power law.
3. The displayed spectrum's noise is relative to CNR only (noise at 10 kHz is about CNR + 11 dB below full-scale), so the picture shows roughly 30 dB less audio SNR than `audioSnrDb` (which includes the 23 to 29 dB FM improvement). Either subtract `fmImprovementDb` in the display or label the plot "relative, exaggerated noise". The relative shape (L-R drowning first) is right.
4. `mpxState` has no pilot-squelch output. To demonstrate pilot squelch it needs `muted = pilotSquelchEnabled && !pilotLocked` and an input for an interferer with no pilot (carrier present, `pilotPresent: false`, so carrier squelch is open but pilot squelch muted). The preset flag `pilotSquelchEnabled` is provided for this.
5. Separation cap `min(maxSeparationDb, cnr + 10)` is ad hoc (approx); fine for display.
6. Above-threshold improvement is for full-deviation tone modulation. Programme audio with a lower average level shows lower SNR; state this in the UI if the number is shown as a measurement.
7. Pilot hysteresis is only referenced to CNR. Real detectors also depend on pilot injection; a low-injection transmitter would lock later. Acceptable.


## Addendum: capture, thresholds and the audio SNR note
- One capture model: the wanted-to-interferer audio ratio `captureSuppressionDb(C/I, captureRatio)` (30 dB at the capture ratio, about 1 dB per dB beyond) caps the audio SNR in `mpxState`. The earlier C/I + 20 cap and `cleanCiDb` are gone.
- Audio SNR is not monotonic in CNR: while the receiver blends between mono and stereo, stereo adds L-R noise (the stereo penalty) so the audio SNR can be lower at a higher CNR than at a lower one. `mpxState` returns `audioSnrNote` (MPX_AUDIO_SNR_NOTE) for the UI.
- Two threshold definitions are in use and are not interchangeable: `fm-deviation.js` takes the threshold as 10 dB CNR in the Carson bandwidth of each system, while the MPX presets use 11 to 12 dB in the 200 kHz channel. The two are different bandwidths, so the same receiver quotes different numbers; the Shure PSM class value (required CNR 10.2 dB at 20 dB SINAD) sits below the 11 dB MPX threshold for the same reason (SINAD point, not threshold knee). Compare figures only within one definition.
- The stereo penalty comment in code: b = 0.5 and p = 22 dB give 10 log10(1 + 0.25 (158.5 - 1)) = 16.06 dB.
