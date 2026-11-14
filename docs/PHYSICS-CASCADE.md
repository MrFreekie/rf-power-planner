# Physics notes: noise-figure cascade, boosters, capture, battery gauge and wall thickness

Data lives in `js/model/rx-params.js`, `js/model/mpx-params.js`, `js/model/data-params.js` and `js/model/zones-params.js`; maths in `js/model/rf.js` (cascade), `js/model/interferer.js` and `js/model/telemetry.js`.

All values are generic and illustrative (marked approx in the parameter files). Real equipment differs.

## 1. Cascaded noise figure
- A receive chain of stages with gain G_i and noise factor F_i (linear, F = 10^(NF/10)) has the Friis noise factor F_total = F1 + (F2 - 1)/G1 + (F3 - 1)/(G1 G2) + ... The first stages dominate: noise added after a lot of gain barely matters, noise added after a lot of loss matters a great deal.
- Passive lossy stages (cable, filter, connector, attenuator, splitter) at the reference temperature have NF equal to their loss and gain equal to minus their loss. A 40 dB cable is a stage with F = 10^4 and G = 10^-4.
- System noise floor at the antenna terminals: N = -174 dBm/Hz + 10 log10(B) + NF_system; B = 200 kHz gives kTB = -121.0 dBm.
- System sensitivity at the antenna terminals = N + required CNR.

### Required CNR
- The quoted sensitivity is a signal level at which the receiver delivers acceptable audio. It implies a CNR: required CNR = sensitivity - (kTB + receiver NF). Presets (`RX_PRESETS`): mic receiver -90 dBm, NF 8 dB gives 23 dB; IEM bodypack -85 dBm, NF 10 dB gives 26 dB; budget receiver -85 dBm, NF 12 dB gives 24 dB. Typical range 20 to 28 dB (approx): well above the FM threshold of 10 to 12 dB, so audio is clean (see `PHYSICS-MPX.md`).
- Typical ranges (`CASCADE_TYPICAL`, approx): receiver NF 6 to 14 dB; antenna-mounted low-noise booster NF 1 to 3 dB, gain 10 to 25 dB, input-referred IIP3 +10 to +30 dBm; cable NF = loss.

### Booster placement: worked example
Receiver NF 10 dB, 200 kHz, required CNR 26 dB, cable 40 dB (for example about 100 m of RG58 at 600 MHz), booster NF 2 dB:

| Arrangement | System NF | Noise floor | System sensitivity at the antenna |
|---|---|---|---|
| Cable then receiver (no booster) | 50.0 dB | -71.0 dBm | -45.0 dBm |
| 20 dB booster at the antenna | 30.0 dB | -91.0 dBm | -65.0 dBm |
| 20 dB booster at the rack (after the cable) | 42.2 dB | -78.8 dBm | -52.8 dBm |
| 30 dB booster at the antenna | 20.1 dB | -100.9 dBm | -74.9 dBm |
| 30 dB booster at the rack | 42.0 dB | -79.0 dBm | -53.0 dBm |

- At the antenna: F = F_b + (F_cable - 1)/G_b + (F_rx - 1)/(G_b G_cable) = 1.58 + 99.99 + 900 = 1001.6 (30.0 dB) for the 20 dB booster. At the rack: F = F_cable + (F_b - 1)/G_cable + (F_rx - 1)/(G_cable G_b) = 10000 + 5850 + 900 = 16750 (42.2 dB).
- Why: the cable's own noise figure is 40 dB, so anything placed after it sees a signal already 40 dB down. A booster at the rack cannot recover noise-figure lost in the cable, only gain; a low-NF stage at the antenna sets the noise figure before the cable loss and the signal arrives at the receiver 20 dB stronger, above the receiver's own noise. The improvement is 12 dB with 20 dB gain and nearly 22 dB with 30 dB; with gain equal to the cable loss the system NF approaches the booster's own NF (10.6 dB for 40 dB gain).
- The net gain from antenna to receiver input is the same in both arrangements (-20 dB), so the receiver input level does not tell the difference. The noise does.
- The price: the booster at the antenna handles the strong signals present at the antenna before the cable attenuates them. Cascade IIP3: 1/IIP3_total = 1/IIP3_1 + G1/IIP3_2 + G1 G2/IIP3_3 + ... (linear mW, input referred; `cascadeIip3Dbm`). A 20 dB booster in front of a receiver of IIP3 -8 dBm and a 20 dB net loss behind it lowers the effective intercept at the antenna far below the booster's own. With a booster at the rack, a 40 dB cable attenuates the strong signals first (see `PHYSICS-RX.md` and `PHYSICS-IMD.md`). Use a booster only where the cable noise figure would otherwise limit the link; use a low-loss cable first. In a strong-signal rig, a pad can be cheaper than a booster.
- Only worthwhile if external noise is lower than the receiver's. ONE model (`EXTERNAL_NOISE_MODEL`, `externalNoiseFigureDb` in rx-params.js): ITU-R P.372 man-made noise Fam = c - 27.7 log10(f_MHz) dB (c = 76.8 business/city, 72.5 residential, 67.2 rural) power-summed with an assumed 1 dB galactic and ground floor. Quiet = rural, outdoor = residential, urban = business; noisy venue adds local sources (dimmers, LED walls, switch-mode supplies) so the total is 12 dB at 600 MHz. Results: urban 13.3 dB at 200 MHz, 3.5 dB at 600 MHz; quiet 5.4 dB at 200 MHz, 1.4 dB at 600 MHz. A system NF below that of the environment does not help.

## 2. FM capture and a stray pilotless carrier
- FM receivers show the capture effect: with two co-channel signals the stronger one suppresses the weaker. Capture ratio = the C/I at which the weaker signal is suppressed by 30 dB; 1 to 3 dB for good receivers, 6 dB or more for poor ones (`INTERFERER_PARAMS`, preset values 1.5 (broadcast-like), 3 (IEM typical), 2 (wideband); approx).
- Wanted-to-interferer audio ratio S(C/I), approx: 0 dB at C/I = 0, 30 dB at the capture ratio, then about 1 dB per dB (`captureSuppressionDb`). Between -capture and +capture neither signal wins: a garbled beat of both. Above it the weaker signal is nearly inaudible: a C/I of 3 dB already gives 30 dB suppression in a good receiver, though multipath and modulation overlap make real capture less clean than the textbook figure. Above about 20 dB C/I (`cleanCiDb`) the interferer is inaudible in programme material.
- Carrier squelch: it looks at total RF level (about that of the stronger signal), so a stray carrier above the squelch threshold opens it, even when the wanted audio is gone.
- Pilot-tone squelch: it needs the 19 kHz pilot of the wanted transmitter. A stray carrier without a pilot, once it captures the demodulator, removes the pilot and the receiver mutes; if the wanted signal captures, its pilot is intact and the squelch stays open. Pilot squelch rejects pilotless carriers because they carry no pilot, but it cannot reject an interferer that carries a pilot of its own.

## 3. Battery gauge: reported versus true percent
- A device estimates charge from the loaded terminal voltage through a fixed voltage-to-percent map. The map cannot know the real curve, the load current or the temperature. Terminal voltage under load = V(used) - I R(used), with internal resistance rising as the cell is used (alkaline pack 0.4 to 2.0 ohm, NiMH 0.1 to 0.25, Li-ion 0.15 to 0.35; load 150 mA (mic) and 120 mA (IEM bodypack); approx).
- Maps (`GAUGE_MAPS`): alkaline linear 2.0 to 3.0 V; NiMH linear 2.2 to 2.6 V; Li-ion table.
- Results (maximum error over the discharge): alkaline about 30 points (the gauge shows empty while 30 percent of the capacity remains: the voltage sags under load); NiMH about 14 (the plateau around 2.4 V maps to the middle of the scale, then the knee arrives with little warning; a NiMH pack set to the alkaline map reads 15 or more points high near the end); Li-ion about 7. `reportedPercent(id, used, kind, mapId)` returns the reported value; true percent is 100 (1 - used).
- Warning levels per chemistry are in `BATTERY_PRESETS` (percent and volts).

## 4. Wall thickness
- Loss through a wall = two surface (interface) losses plus absorption proportional to thickness: L(t) = interfaceDb + absorptionDbPerM x t, scaled with frequency by (f/600)^g. Reference values and the split are in `MATERIAL_TRANSMISSION` (for example brick 100 mm: 5 dB = 1.5 dB interfaces + 35 dB/m x 0.1 m; concrete 100 mm: 8 dB = 2.5 + 55 x 0.1). At the reference thickness the table value is returned; thinner walls keep the interface loss; thicker walls add the absorption. Pure proportionality to thickness would make an almost-zero thickness lossless, which is wrong.
- Examples: brick 50 mm 3.25 dB (proportional law 2.5); brick 200 mm 8.5 dB (proportional law 10). Basis: ITU-R P.2040 absorption of lossy dielectrics (about 23 dB/m for concrete at 600 MHz) plus interface losses; the larger values here include moisture and reinforcement (approx).

## Sources
- Friis (1944), noise factor of cascaded stages; Pozar, Microwave Engineering; Razavi, RF Microelectronics (noise figure, IIP3 cascade).
- ITU-R P.372 (radio noise); ITU-R P.2040 (building materials).
- Taub and Schilling, Principles of Communication Systems (FM capture).
- Manufacturer discharge curves (shape only) for the battery gauge.

## Review of the cascade in rf.js
Reviewed `cascadeNoise`, `chainItemNoise` and the link solve. The Friis recurrence, passive NF = loss, splitter and combiner NF = loss, the receiver stage appended last for mic links, and the reporting of the margin at the antenna terminals are correct. For a passive chain it reproduces the old margin exactly (floor and sensitivity both shift by the chain loss). The worked example above gives the same values (50.0, 30.0 and 42.2 dB; checked with the parameter helper `cascadeNfDb`).

Issues and suggestions:
1. `requiredSnrDb` is derived from the scene's sensitivity and the receiver NF, so changing the receiver NF in the scene while leaving the sensitivity alone lowers the required CNR by the same amount and the system sensitivity at the antenna does not move. A user who raises NF from 8 to 12 dB expects a worse receiver. Take the required CNR from the preset (`requiredCnrDb`, now in `RX_PRESETS`) or freeze it when the scene is created, and let the sensitivity be derived.
2. IIP3 cascade is not modelled: a booster raises the system NF benefit but lowers the effective intercept; the overload and IMD models should use `cascadeIip3Dbm` over the chain.
3. The default booster NF (3 dB) is reasonable (`CASCADE_TYPICAL.defaultBoosterNfDb`); a booster with NF higher than the cable-plus-receiver it replaces can be net harmful at the rack.
4. External noise (a floor of 1 to 12 dB above kT) is not part of the cascade; at the antenna terminals the total noise is max-like, so very low system NFs overstate the benefit. A note in the UI would suffice.
5. For IEM links the cascade is informational; correct, since the chain sits before the transmit antenna.

## Review of interferer.js and its use in mpxState
Reviewed `js/model/interferer.js`. Capture logic (|C/I| below the capture ratio is a garbled beat, otherwise the stronger signal wins), carrier level seen by the carrier squelch (the stronger signal) and the pilot rule (the pilot belongs to whoever captures; a pilotless interferer that captures removes the pilot) agree with section 2.

Issues and suggestions:
1. The capture ratio is a fixed 3 dB default in the module and in the interferer option of `mpxState`; the presets now carry `captureRatioDb` (1.5, 3, 2). Read it from the configuration.
2. `audioQuality` rises smoothly from 0 at C/I = -capture to 1 at +20 dB, about 0.17 right at the capture ratio. By the definition of the capture ratio (30 dB suppression of the weaker signal) the wanted audio is already almost clean at C/I = capture, so the ramp is pessimistic. A quality derived from `captureSuppressionDb` (clean above about 30 dB suppression, garbled below about 10 dB) would follow the physics more closely.
3. The carrier level is `max(wanted, interferer)`; the power sum is up to 3 dB higher when they are equal. Immaterial for a squelch.
4. Info: capture is a steady-state property; fading changes C/I in real time so the capture region flickers. A deterministic model is fine for a demonstration.

## Review of telemetry.js (battery gauge)
Reviewed the gauge path in `batteryStep`. It now takes the loaded voltage and the gauge map from `data-params.js` (`loadedVoltage`, `reportedPercent`, `BATTERY_LOAD`), reports `trueSocPercent`, `reportedPercent` and `gaugeErrorPct` (negative = reads low), and falls back to an ideal gauge for an explicit `model`. The numbers agree with section 3 (the alkaline gauge reads 0 while 30 percent remains; a full Li-ion pack reads 99 percent because of the load sag).

Issues and suggestions:
1. `GAUGE_LOAD_SAG_V` in `telemetry.js` duplicates the internal-resistance data in `BATTERY_LOAD`. Keep one source, preferably the parameter file.
2. `lowWarning` combines percent and voltage thresholds from the preset; the voltage test uses the open-circuit voltage while real devices see the loaded voltage, so the warning arrives later than on a real device. Use the loaded voltage.
3. `dead` is now tied to `vMin` (good) but the preset's `tx.vMinV` and the module's `vMin` should be the same field.
4. A gauge map chosen for the wrong chemistry (`gaugeMap` option) is supported; the UI could expose it, since it is the commonest real-world cause of a misleading gauge.
