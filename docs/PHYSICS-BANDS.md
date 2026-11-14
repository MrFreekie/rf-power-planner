# Physics notes: VHF, 2.4 GHz and 5.8 GHz extension

All numbers are planning estimates (marked approx in `js/model/library.js`). Regional rules differ and change: check the local regulator.

## Cables
Tables now run 100 MHz to 6 GHz (100, 200, 400, 600, 900, 1800, 2400, 3500, 5000, 5800, 6000). Points up to 2400 MHz are datasheet-derived. Higher points use A = a sqrt(f) + b f fitted to the lower points; LMR-400 and LMR-600 agree with Times Microwave at 5.8 GHz (10.9 and 7.1 dB/100 ft). LMR-195 had a slope kink at 600-900 MHz and was smoothed. New cables: `rg316` (SMA jumper, 0.9 x RG174, approx), `cfd-200`, `cfd-400` (class equivalents of LMR-195 and LMR-400, approx). `cableDbPer100m(id, f)` scales as sqrt(f) outside the table; the end-slope extrapolation in rf.js overshoots (LMR-195 by about 15 percent at 6 GHz).

## Antennas
`ANTENNA_VARIANTS` gives `baseType`, `gainDbi` and a `patternOverride`-ready pattern for VHF (whip, dipole, stub, Yagi, LPDA, body), 2.4 GHz and 5.8 GHz (dipole, stub, patch, panel, body). Short stubs: Rr = 36.5 (h / (lambda/4))^2, efficiency Rr/(Rr+4 ohm), directivity 1.8 dBi. A 0.12 m stub is +1.3 dBi at 600 MHz but -1.4 dBi at 200 MHz (about 2.7 dB worse); a 0.37 m whip at 195 MHz is +1.3 dBi. Patch 7 dBi (2.4 GHz) and 8 dBi (5.8 GHz).

## Materials and bodies
- sigma(f) = sigma_1GHz x f_GHz^d (ITU-R P.2040-3 exponents); `materialAt`, `surfaceAt`. At 5.8 GHz concrete sigma is 0.136 S/m, 4 times the value at 1 GHz, so rf.js should call these.
- `WALL_LOSS_BY_FREQ` / `wallLossDb(id, f, thicknessM)`: 200/600/900/2400/5800 MHz. Concrete 0.1 m: 5/8/10/14/21 dB; drywall 2/3/3.2/3.6/5; brick 0.1 m 3.5/5/6/8/11; glass 1.5/2/2.2/3.2/4. Equivalent exponents are 0.2-0.45, not the 0.4-0.7 in zones-params.js (which gives 31 dB for 0.1 m concrete at 5.8 GHz). All stay above the P.2040 slab model (`slabTransmissionLossDb`), a physical lower bound.
- `BODY_SHADOW_DB` at 200/600/900/2400/5800 MHz: hip line of sight 2/3/4/6/8; torso-blocked 6/9/10/18/25; head-worn 2/3/3.5/5/6; hand grip 2/4/5/8/11; packed crowd extra 4/7/8/12/16. Do not stack with the `body-*` pattern rear shadow.

## Bands, power, receivers (`BAND_PROFILES`)
| Band | Limits | Typical Tx | Rx NF / BW / CNR / sensitivity | External noise (quiet/outdoor/urban/noisy) |
|---|---|---|---|---|
| VHF 174-216 | US about 50 mW; UK 10 mW ERP licence-exempt 173.8-175.0; EU 10-50 mW ERP | mic 15, IEM 17 dBm | 7 dB / 200 kHz / 23 dB / -91 dBm | 3/7/10/18 dB at 200 MHz (P.372) |
| 2.4 GHz | EU/UK 100 mW EIRP; US 1 W + 6 dBi | mic 10, IEM 13 dBm | 7 dB / 2 MHz / 14 dB / -90 dBm | 0 |
| 5.8 GHz | EU/UK 25 mW EIRP; US 1 W + 6 dBi (5.85-5.875: about -1 dBm EIRP) | 10 dBm | 9 dB / 2 MHz / 14 dB / -88 dBm | 0 |

DAB III (174-240 MHz) and DVB-T share Band III in the EU; coordinate against local multiplexes.

## Interference floor (2.4 / 5.8 GHz)
Model: `INTERFERENCE_MODEL`, `interferenceRiseDb(freqMHz, venue, {bwMHz, nfDb, fpv})`. rise = 10 log10(1 + I/N), N = -174 + 10 log10(B) + NF. Wi-Fi: average power per 20 MHz channel, summed over channels 1/6/11 (+13 at 0.25) or 149-173, shaped by the 802.11 mask. Bluetooth: per-channel duty and burst level, advertising channels x3. Microwave oven (2.4 GHz): reported separately while running (`eventRiseDb`). `hitProbability` is the chance a packet overlaps a burst.

| Venue | Wi-Fi avg 2.4 / 5.8 (dBm per 20 MHz) | Wi-Fi utilisation 2.4 / 5.8 | Rise at Wi-Fi channel 2.4 / 5.8 | Rise in 2.4 gap (2449.5) | Oven while on (2450) |
|---|---|---|---|---|---|
| quiet | -97 / -100 | 0.05 / 0.03 | 2.0 / 0.6 dB | 0.4 dB | none |
| typical | -87 / -90 | 0.25 / 0.15 | 9.3 / 4.1 dB | 5.5 dB | about +25 dB, 5 percent of time |
| busy | -77 / -80 | 0.6 / 0.4 | 19.6 / 12.3 dB | 16.2 dB | about +40 dB, 20 percent of time |

## Model limits and validation
Specular only, no diffraction. Average-power rise understates bursty interference: digital links should use `hitProbability`. Validation checklist: cable slopes 0.4-0.75 with no kinks; sensitivity = -174 + 10 log B + NF + CNR within 1.5 dB; wall loss above the slab bound; body shadow rises with frequency; rise ordered quiet < typical < busy; Wi-Fi channel centres above gaps. Tests: `tests/library-bands.test.mjs`.
