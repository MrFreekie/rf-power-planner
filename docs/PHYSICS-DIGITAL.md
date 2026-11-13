# Physics notes: digital RF link, QAM and forward error correction

Data lives in `js/model/digital-params.js`; maths in `js/model/digital.js`.

All presets are generic and illustrative. Real digital wireless microphone and in-ear-monitor systems use proprietary modulation, coding, framing and latency, and some are not QAM at all. The numbers describe a plausible class of link, not any product.

## 1. Modulation schemes
| Scheme | Bits per symbol | Constellation | Gray labelling |
|---|---|---|---|
| BPSK | 1 | 2 points on the I axis | adjacent points differ by 1 bit |
| QPSK | 2 | 4 points, one per quadrant | per axis |
| 16-QAM | 4 | 4 x 4 grid | per axis, 2 bits each |
| 64-QAM | 6 | 8 x 8 grid | per axis, 3 bits each |
| 256-QAM | 8 | 16 x 16 grid | per axis, 4 bits each |

- Square QAM per-axis levels are 2m - (L - 1), L = sqrt(M), scaled by 1/sqrt(2 (M - 1)/3) to unit average power. Gray labelling per axis means nearest neighbours differ in one bit, so a symbol error usually costs one bit error: BER ~ SER / k.
- Each step up doubles the points per axis-pair and needs about 6 dB more SNR for the same symbol error rate (the minimum distance falls by half for the same average power).

## 2. SNR bookkeeping
- Es = C Ts = C / Rs and N0 = N / B, so Es/N0 = CNR x B / Rs, i.e. CNR = Es/N0 x (Rs / B), with Rs the symbol rate and B the noise bandwidth. In dB: Es/N0 = CNR + 10 log10(B / Rs). Raised-cosine pulses with roll-off alpha need B about Rs (1 + alpha).
- Eb/N0 = Es/N0 / (k R), with k bits per symbol and R the code rate. In dB: Eb/N0 = Es/N0 - 10 log10(k R).
- Example: B 400 kHz, Rs 300 ksym/s gives Es/N0 = CNR + 1.25 dB. With 64-QAM at rate 2/3, Eb/N0 = Es/N0 - 6.02 dB.
- CNR itself is computed from the link budget as for FM: input dBm - (-174 + 10 log10(B) + NF).

## 3. Theoretical BER (AWGN, Gray)
- BPSK: BER = Q(sqrt(2 Eb/N0)) = Q(sqrt(2 Es/N0)). QPSK: BER = Q(sqrt(2 Eb/N0)) = Q(sqrt(Es/N0)); QPSK and BPSK need the same Eb/N0 and QPSK carries twice the data.
- Square M-QAM (nearest-neighbour approximation, good at the BERs of interest): BER ~ (4/k)(1 - 1/sqrt M) Q(sqrt(3 Es/N0 / (M - 1))), Es/N0 = k Eb/N0.
- Requirements, uncoded (computed numerically from these formulas):

| Scheme | Es/N0 for BER 1e-3 | Eb/N0 for 1e-3 | Es/N0 for 1e-6 | Eb/N0 for 1e-6 |
|---|---|---|---|---|
| BPSK | 6.79 dB | 6.79 | 10.53 | 10.53 |
| QPSK | 9.80 | 6.79 | 13.54 | 10.53 |
| 16-QAM | 16.54 | 10.52 | 20.42 | 14.40 |
| 64-QAM | 22.55 | 14.77 | 26.56 | 18.78 |
| 256-QAM | 28.41 | 19.38 | 32.55 | 23.51 |

- Required SNR rises monotonically with order (about 6 to 6.5 dB Es/N0 per step beyond QPSK). The tests enforce monotonicity.

## 4. EVM and MER
- EVM_rms (fraction of rms constellation amplitude) = 10^(-MER/20), equivalently MER = -20 log10(EVM). For an ideal receiver, MER equals the SNR (Es/N0). Real receivers add an implementation loss (filters, phase noise, quantisation, IQ imbalance): MER = SNR - implementation loss (presets: 2 to 3 dB, approx).
- Example: SNR 30 dB with 2.5 dB implementation loss gives MER 27.5 dB and EVM 4.2 percent. 256-QAM needs EVM well under about 2 percent.
- The model draws noisy constellation points with per-axis noise sigma = sqrt(10^(-SNR/10) / 2) on the unit-power constellation, optionally with phase noise and IQ imbalance.

## 5. Forward error correction: the cliff
- FEC adds redundancy (rate R). Decoding works when the raw (pre-FEC) bit error rate is below a tolerance that depends on the code. Just below the tolerance the output is essentially error free (quasi error-free, post-FEC BER about 1e-12 to 1e-6); just above it the decoder fails and the output BER approaches the raw BER. The transition spans well under 1 to a few dB, because error-correction capability is a hard limit and the raw BER itself changes about a decade per dB or two.
- Parametric model: with pc the cliff pre-FEC BER, s the sharpness per decade, floor the quasi error-free BER and w = 1 / (1 + 10^(-s (log10 pre - log10 pc))): log10 post = (1 - w) log10 floor + w log10 min(pre, 0.5). No decoder is simulated.
- Cliff tolerance by code rate (approx, order of magnitude for convolutional plus block codes or short LDPC): 1/2: 8e-2, 2/3: 3e-2, 3/4: 1.5e-2, 5/6: 7e-3, 7/8: 4e-3. Higher rate means less tolerance, so a higher Eb/N0 threshold. For QPSK rate 3/4 the cliff sits at Es/N0 = 6.7 dB (Eb/N0 = 5.0 dB), against 10.5 dB uncoded at 1e-6: a coding gain of about 5.5 dB at that BER. Modern LDPC codes are within 1 to 2 dB of the Shannon limit; the values here are intentionally conservative.
- Frame error rate FER = 1 - (1 - post-FEC BER)^frameBits. Audio quality follows the FER, not the BER: below about 1e-3 it is clean, above a few percent the decoder repeats or mutes.

## 6. Adaptive modulation and coding (AMC)
- The transmitter and receiver agree on the highest order the channel supports. The hold threshold for each order is the CNR at which the code's cliff is reached plus implementation loss plus a fade margin (1.5 dB): hold(order) = Es/N0(cliff BER) + implementation loss + margin - 10 log10(B / Rs). Stepping up needs the hold threshold plus a hysteresis (2 dB in the presets); stepping down occurs as soon as the CNR falls below the current hold threshold, possibly several orders at once.
- Ladder: 256-QAM, 64-QAM, 16-QAM, QPSK, then the link is down. Throughput falls in steps instead of the audio degrading, which is how a digital link trades capacity for robustness.
- Preset hold thresholds (CNR, dB): iem-ofdm-like-adaptive QPSK 8.2, 16-QAM 14.6, 64-QAM 20.2; wideband-adaptive 10.3, 16.8, 22.5, 28.2; mic-qpsk-fixed QPSK 9.0.

## 7. Presets (all illustrative)
| Preset | Channel / symbol rate | Code | Orders | Latency | Concealment |
|---|---|---|---|---|---|
| iem-ofdm-like-adaptive | 400 kHz / 300 ksym/s | 2/3 | QPSK, 16, 64 | 2 ms | repeat last frame 30 ms, then mute |
| mic-qpsk-fixed | 200 kHz / 150 ksym/s | 3/4 | QPSK only | 3 ms | repeat 40 ms, then mute |
| wideband-adaptive | 1000 kHz / 800 ksym/s | 3/4 | QPSK to 256 | 4 ms | repeat 60 ms, then mute |

- Concealment: when frames fail, the decoder repeats the last good audio frame (hiding a dropout of a few frames), and after the allowed repeat time it mutes. Typical latency of digital links is a few ms (framing, interleaving, buffering), higher than analog FM.
- The first preset in the file is the default, and it is adaptive so that merging a partial configuration into the defaults never forces a fixed order.

## 8. Analog FM versus digital
- Analog FM degrades gracefully: audio SNR falls about 1 dB per dB of CNR above threshold, hiss grows, stereo blends to mono, then the FM threshold brings crackle around 10 to 12 dB. The listener gets progressive warning.
- Digital is flat then a cliff: audio is bit-exact (a fixed noise floor from the converters) down to the FEC cliff, then it collapses within 1 to 2 dB into repeated frames and mute. A margin of 6 dB or more above the cliff is wise. Adaptive modulation turns the cliff into steps in capacity, but when even QPSK fails the link is gone.
- Digital wins on noise-free audio, immunity to the multipath nulls below the cliff and efficient use of spectrum; analog wins on latency and soft failure.

## Sources
- Proakis, Digital Communications; Sklar, Digital Communications: Fundamentals and Applications (error rates, Gray mapping, coding gain).
- Taub and Schilling; Haykin (FM comparison).

## Review of digital.js
Reviewed `js/model/digital.js`. Confirmed correct: the erfc approximation, Q function, Es/N0 and Eb/N0 conversions (CNR = Es/N0 x Rs/B), BPSK and QPSK formulas, the square M-QAM approximation (table values reproduced to within 5 percent at 1e-3, 10 percent at 1e-6), unit-power Gray constellations, EVM = 100 x 10^(-(SNR - loss)/20), the monotone logistic FEC cliff, the AMC ladder with hysteresis (step-up needs hold + H, step-down below hold), throughput, and `berCurve` coded Es/N0 = Eb/N0 + 10 log10(k R).

Issues and suggestions:
1. Default merge leak. The configuration is `{ ...FALLBACK, ...DIGITAL_DEFAULTS, ...cfg }`, so a field present in the defaults but not in the supplied config leaks through. This showed up with `fixedOrder` when the fixed-QPSK preset was first in the file: partial configurations became fixed-QPSK links and the strong-signal test returned order 4 instead of 256. The params file now makes the default preset adaptive and gives every non-fixed preset `fixedOrder: null`. Prefer merging the defaults only when the caller passes no preset.
2. Implementation loss is applied to EVM and MER but not to the BER. `berUncoded` receives the raw Es/N0, so the real cliff lies at the loss (2 to 3 dB) lower CNR than the hold threshold, in addition to the 1.5 dB margin. AMC then steps down 3.5 to 4.5 dB before any error appears. If the margin is meant to be 1.5 dB, call `berUncoded(order, es - implLossDb)`.
3. The `fixedOrder` path keeps the link up down to hold - 6 dB, a fixed offset that has no basis in the preset; with 2 above, the fixed link's failure point should come from the cliff itself.
4. Concealment has no recovery hysteresis: the badMs timer resets and audio unmutes as soon as FER drops below `concealFer`. Real decoders wait for several good frames. Presets supply `concealMaxMs` (30 to 60 ms), well under the model's 200 ms fallback; this needs the params to be loaded, which the default import does.
5. The cliff midpoint is not the failure point: at pre-FEC BER equal to pc the post-FEC BER is about 1e-7, and the FER reaches 5 percent at about 1.2 pc (roughly 0.3 dB higher). That is a sharp cliff placed where intended; just remember pc is the failure point.
6. `analogVsDigitalCurve` maps analog quality as (SNR - 10)/50, an arbitrary scale; label the plot as illustrative. The digital curve is stateless (no hysteresis), which is right for a static comparison.
7. `frameBits` fallback is 1000; the presets compute it from frame length, symbol rate and code rate at QPSK (about 450 for the mic preset).
