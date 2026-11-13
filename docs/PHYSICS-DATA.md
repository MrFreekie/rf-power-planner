# Physics notes: telemetry data channel and batteries

Data lives in `js/model/data-params.js`; maths in `js/model/telemetry.js`.

Everything is generic and illustrative. Real wireless microphone and in-ear-monitor systems differ: many send status on a proprietary subcarrier, in sub-audio tones, inside a digital link, or on a separate return link. This demonstration models one plausible FM approach. Payload: battery level, status, name, gain and mute flags.

## 1. Where the data channel sits
- FM baseband (see `PHYSICS-MPX.md`): L+R to 15 kHz, pilot 19 kHz, L-R 23 to 53 kHz. A data subcarrier goes above 53 kHz. The RDS data subcarrier is the textbook example: 57 kHz, the third harmonic of the pilot, 1187.5 bit/s, DBPSK. The 'rds-like' preset borrows those numbers; 'narrow-telemetry' uses 60 kHz and 300 bit/s.
- The subcarrier takes a small fraction of the peak deviation (3 to 4 percent in the presets), so it costs little of the audio deviation.
- Because FM noise density rises as f squared, a subcarrier at 57 to 60 kHz sees more noise than the L-R band at 38 kHz (3.5 to 4 dB for the same bandwidth). Its narrow bandwidth is what makes it survive.

## 2. Data-link robustness
- Data subcarrier deviation: dev_d = injectionFrac x peak deviation. Noise at the subcarrier after the discriminator: N0 fs^2 / C per Hz (C carrier power, fs subcarrier frequency).
- Eb/N0 = (dev_d^2 / 2) x CNR x B / (Rb x fs^2), B the channel bandwidth and Rb the bit rate. In dB: Eb/N0 = CNR + 10 log10(dev_d^2 B / (2 Rb fs^2)).
- Worked value, rds-like (dev_d 2.25 kHz at 75 kHz deviation, B 200 kHz): offset -8.84 dB, so 18 dB CNR gives 9.16 dB Eb/N0.
- Below the FM threshold click noise destroys the subcarrier. The model takes a further `belowThresholdSlope` (3) dB off Eb/N0 per dB of CNR below the threshold (approx).
- BER: DPSK, BER = (1/2) exp(-Eb/N0). Noncoherent FSK would be (1/2) exp(-Eb/(2 N0)).
- Packet error rate with no error correction: PER = 1 - (1 - BER)^packetBits. Packets of 96 to 104 bits.
- Results: rds-like PER 56 percent at 15 dB CNR, 1.3 percent at 18 dB, about zero at 22 dB. The PER falls roughly a decade per 2 dB. `DATA_PER_FIT` gives `per50CnrDb` and `perSlopeDb` (15.2 dB and 10 dB, 2 dB per decade) as a logistic summary of this curve.
- Lock and lose CNR with hysteresis (rds-like 18 / 15 dB, narrow-telemetry 14 / 11 dB) are design values. They are below the stereo blend start (30 dB for iem-typical) and within 4 dB of the pilot detect point (16 dB). The data link survives while the stereo is long gone, which is why telemetry is the last thing to fail.
- A reading is flagged stale when no packet arrived for `maxStaleMs` (1.5 s and 3 s; at least three packet intervals).

## 3. Battery physics
Curves are terminal voltage under a light load against fraction of capacity used (shape only, approx).

| Pack | Full | Cutoff | Shape |
|---|---|---|---|
| 2 x AA alkaline | 3.1 V | 1.8 V | steady slope through the whole discharge |
| 2 x AA NiMH | 2.8 V | 1.8 V | quick drop to about 2.5 V, then a gently sloping plateau around 2.4 V, a sharp knee after about 90 percent |
| 1S Li-ion | 4.2 V | 3.0 V | gentle slope 4.2 to 3.6 V, steeper at the end |

- Typical runtime (approx): mic transmitter 10 h (alkaline), 8 h (NiMH), 12 h (Li-ion); IEM bodypack 8, 6.5 and 10 h. Real figures depend on transmit power, backlight and temperature.
- State of charge from voltage: a simple gauge maps voltage to percent (`socMap`). Alkaline: poor (about 25 percent error), because the slope is shallow and the voltage also depends on load current, temperature and rising internal resistance, so the same percent can be 0.2 V apart. NiMH: worst in the plateau (about 30 percent error; 15 to 90 percent charge lies within about 0.1 V), then the knee comes with almost no warning. Li-ion: best (about 8 percent).
- Warnings (percent and volts): alkaline 25 / 10 percent, 2.2 / 2.0 V; NiMH 20 / 8 percent, 2.3 / 2.16 V; Li-ion 20 / 8 percent, 3.5 / 3.3 V.

### Effect on RF
A regulated transmitter holds full power until the supply falls to `vRegV`. Below it the power amplifier runs out of headroom and output power falls with the square of the excess voltage, then the unit drops out at `vMinV`:

P = Pnom for V >= vRegV; P = Pnom ((V - vMinV) / (vRegV - vMinV))^2 for vMinV < V < vRegV; P = 0 for V <= vMinV.

Values: alkaline 2.2 / 1.9 V, NiMH 2.3 / 2.0 V, Li-ion 3.4 / 3.1 V. Halfway between the two voltages (alkaline 2.05 V) the power is 25 percent, 6 dB down. Because the sag only costs link margin, a link with good margin never notices it and a marginal link dropping out near the end of a battery is a typical field symptom. An IEM bodypack's RF receiver is not power-limited this way; its failure mode is audio headroom, then brownout shut-down.

## Sources
- IEC 62106 (RDS) for the textbook 57 kHz / 1187.5 bit/s numbers.
- Proakis, Digital Communications; Haykin, Communication Systems (DPSK and FSK error rates); Taub and Schilling (triangular FM noise).
- Manufacturer discharge curves for AA alkaline, NiMH and Li-ion cells (shape only).

## Review of telemetry.js
Reviewed the final `js/model/telemetry.js`. Deterministic, monotonic battery discharge, hysteresis lock, per-slot hash for packet loss and the stale logic are correct and tidy. The module reads `BATTERY_PRESETS` directly (curve, `tx` law, runtime by `kind`), which matches this note: the power-sag law is P/Pnom = ((V - vMin)/(vReg - vMin))^k, capped at 40 dB at dropout.

Issues and suggestions:
1. `perFromCnr` is a logistic with a default centre at `loseCnrDb` and 2 dB per decade. The slope agrees with the Eb/N0 law, but the centre does not: PER = 0.5 occurs at 15.2 dB (rds-like) and 10 dB (narrow-telemetry), not at the lose thresholds 15 and 11 dB. `data-params.js` exports `DATA_PER_FIT` with `per50CnrDb` and `perSlopeDb` per preset (merge it into the config; the module already reads both keys). It is kept out of the presets so existing behaviour and tests are unchanged. The logistic is otherwise an acceptable stand-in for the BER law.
2. `percentReported = round(soc x 100)` is an ideal gauge. To show why alkaline and NiMH gauges are poor, derive it from the voltage via `socMap` (and add load dependence); then the reading and the true state of charge visibly disagree.
3. `lowWarning` is a single fixed threshold (soc <= 0.15). The presets give warn and critical levels in percent and volts that differ per chemistry (the NiMH knee needs a voltage warning).
4. `dead` is true only at soc <= 0, while the transmit law says the unit drops out at `vMinV` (2.0 V alkaline, reached near 90 percent used). Report dropout when V <= vMinV.
5. `BATTERY_MODELS` is now only a fallback. Its curves (alkaline full 3.2 V, NiMH with no plateau, sag 20 log10(vReg/V) with no dropout) disagree with the presets; keep the fallback only if the parameter file may be absent.
6. `data-params.js` still exports `BATTERY_CHEMISTRIES` (the same data in [state of charge, volts] form). It is unused now and can be dropped by whoever owns the integration.
7. Info: the default config falls back to `DATA_DEFAULTS` (narrow-telemetry). Pass a preset explicitly for rds-like.
