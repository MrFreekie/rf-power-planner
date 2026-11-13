# Physics notes: intermodulation (IMD)

Data lives in `js/model/imd-params.js`; maths in `js/model/imd.js`.

All presets are generic and illustrative. Real receivers, combiners, power amplifiers and connectors vary widely, and passive intermodulation changes with temperature, vibration and corrosion. Measure on site for critical rigs.

Intermodulation is the mixing of two or more signals in a nonlinear device so that new frequencies appear. There are three mechanisms, with different scaling.

## 1. Receiver and booster front-end IMD (over the air)
- A weakly nonlinear stage y = a1 x + a3 x^3 mixes the strong signals that arrive at its input. Two tones at f1, f2 produce 2 f1 - f2 and 2 f2 - f1; three tones produce f1 + f2 - f3 and permutations; higher orders (3 f1 - 2 f2, ...) are weaker.
- Levels, input referred (dBm at the device input, which is the level from the link budget at that device):
  - Equal tones: IM3 = 3 P - 2 IIP3. Unequal tones: P(2 f1 - f2) = 2 P1 + P2 - 2 IIP3. Slope 3:1: 1 dB more input gives 3 dB more product. Relative to each carrier: IM3 = 2 (P - IIP3) dBc.
  - Three-tone products (f1 + f2 - f3): P1 + P2 + P3 - 2 IIP3 + 6 dB, i.e. 6 dB above the two-tone product at equal levels.
  - Fifth order, 3 f1 - 2 f2: 3 P1 + 2 P2 - 4 IIP5, slope 5:1 (5 dB in gives 25 dB out). Fifth order matters only when levels are high; IIP5 is typically well above IIP3 (preset 6 dBm against -8 dBm).
- Where the tone levels come from: each transmitter's level at the receiver antenna terminals, from the link budget (distance, antenna gains, cable). A mic held close to the receive antenna is the classic cause: at 2 m and 600 MHz, free-space loss is 34 dB, so a 10 dBm transmitter arrives near -24 dBm and two such tones give IM3 = -56 dBm, 57 dB above the thermal floor.
- Worked value (preset 'mic-rack-typical'): eight transmitters at -35 dBm each into IIP3 -8 dBm. Two-tone IM3 = 3(-35) + 16 = -89 dBm, three-tone -83 dBm; noise floor (200 kHz, NF 8 dB) -113.0 dBm. The products are 24 to 30 dB above the floor and, depending on frequency plan, may land on a wanted channel at 30 dB below a wanted signal of -53 dBm. Reducing every level by 6 dB (a 6 dB pad) cuts the products by 18 dB while the wanted signal falls by 6 dB: a 12 dB net improvement.
- Counts for N transmitters on distinct frequencies (before frequency coincidences): two-tone third-order products 2 fi - fj: N(N - 1); three-tone products fi + fj - fk: N(N - 1)(N - 2)/2; total third order: N^2 (N - 1)/2. N = 2: 2; N = 3: 9; N = 4: 24; N = 8: 224. Fifth-order products (all coefficient sets with sum 1 and sum of magnitudes 5): N = 2: 2; N = 3: 15; N = 8: more than 3rd (`imProductCount`).
- IM products of FM signals are wider than a carrier, about three times the channel bandwidth (an FM 2 f1 - f2 product has bandwidth about 2 B1 + B2).

## 2. Transmitter-to-transmitter reverse intermodulation
- A transmitter's power amplifier is itself nonlinear. Another transmitter's carrier f_b that couples into its output mixes with its own carrier f_a to give 2 f_a - f_b and 2 f_b - f_a, which are then re-radiated. This is the usual IEM combiner problem.
- Coupling: antenna to antenna, free space, L = 20 log10(4 pi d / lambda) - G1 - G2 (Friis), with the 20 log d law and a near-field floor: for d below lambda/2 the loss is clamped to the lambda/2 value (about 16 dB with 0 dBi antennas). At 600 MHz lambda = 0.5 m: 28 dB at 1 m, 34 dB at 2 m. Real patterns and mounting change this; use antenna gains in the direction of the other antenna.
- Combiners: no combiner (separate antennas, isolation = coupling only); passive hybrid (about 3.5 dB insertion loss, 20 to 30 dB isolation, preset 25); circulator or cavity isolated (about 2 dB insertion loss, 40 to 60 dB isolation, preset 50) (`COMBINER_PRESETS`, approx).
- Law: the interferer reaching the PA output is P_int = P_tx_b - isolation (or - coupling). The product is P_prod = P_int - Conv, where Conv is the PA's reverse-IM conversion loss at nominal drive. `TX_REVERSE_IM_CONVERSION_DB`: saturated class C 10 dB, class AB 20 dB, linear class A 30 dB (approx).
- Scaling: the product moves 1 dB per dB of the interferer level (it is linear in the interfering amplitude). With respect to the transmitter's own level, an ideal cubic PA gives 2 dB per dB (2 f_a - f_b contains the own amplitude squared); a PA driven into limiting gives about 1 dB per dB or less, so the conversion loss is quoted at nominal power and only deviations scale (approx).
- Typical resulting levels for 17 dBm transmitters, class AB (20 dB): hybrid combiner with 25 dB isolation: interferer -8 dBm, product -28 dBm = -45 dBc. Isolated combiner with 50 dB: -33 dBm, product -53 dBm = -70 dBc. Separate antennas 1 m apart, 0 dBi: interferer -11 dBm, product -31 dBm = -48 dBc. Each dB of added isolation removes a dB from the product.
- Remedies: isolators or circulators on every transmitter output, adequate antenna spacing and aiming, lower transmit power where the link margin allows, and frequency coordination so the products do not fall on used channels.

## 3. Passive intermodulation (PIM)
- Any junction with a nonlinear current-voltage behaviour carries PIM with no active device: oxidised or loose connectors (metal-oxide-metal diodes), ferromagnetic materials (steel, nickel plating, hysteresis), cracked solder joints, rusty fences, truss joints and other metal in the near field of an antenna. The metal acts as an accidental mixer for the carriers that reach it, and it re-radiates the products.
- PIM is specified in dBc relative to one carrier at the test condition of two +43 dBm carriers (`PIM_REFERENCE_DBM`). Typical figures (approx): low-PIM hardware -160 dBc; good connector -125; loose or dirty -105; corroded -90; ferromagnetic -75; rusty contact -65.
- Scaling about 3:1 with power: the absolute product rises 3 dB per dB of carrier power, so dBc changes 2 dB per dB: dBc(P) = dBcRef + 2 (P - 43). A corroded connector (-90 dBc at 43 dBm) at 17 dBm per carrier is -142 dBc, i.e. -125 dBm for 17 dBm carriers: harmless. A rusty contact at 17 dBm per carrier is -117 dBc = -100 dBm, 13 dB above the receiver noise floor of -113 dBm. So PIM is only a serious problem at high power or close to a receive antenna.
- It varies with movement because the junction changes: a vibrating stage truss, a swinging cable or a flexing connector modulates the nonlinearity, giving unstable noise-like birdies that come and go. Clean connectors, torque to specification, avoid ferromagnetic hardware, and keep rusty metal away from antennas.

## 4. The receiver noise floor with IMD
Total in-channel interference power = thermal + Sigma IM products landing in channel + coupled transmitter noise + reciprocal mixing, with a gain loss from compression:

- Thermal: -174 dBm/Hz + 10 log10(B) + NF.
- IM products landing within the receiver bandwidth: the power sum of the individual products.
- Transmitter noise skirt: P_noise = P_tx_at_rx + L(offset) + 10 log10(B), L in dBc/Hz at the offset (`TX_NOISE_DBC_PER_HZ`, approx: -105 at 200 kHz, -118 at 500 kHz, -128 at 1 MHz, -140 at 5 MHz, -148 at 20 MHz). Example: a transmitter received at -30 dBm one megahertz away adds -30 - 128 + 53 = -105 dBm in 200 kHz, which lifts the floor from -113 dBm by about 8.6 dB.
- Reciprocal mixing: the same relation with the receiver's local oscillator phase noise and a blocker, P = P_blocker + L_LO(offset) + 10 log10(B).
- Desensitisation from compression of a strong blocker (see `PHYSICS-RX.md` and `rx-params.js`): the weak wanted signal sees a lower gain, equivalent to a loss of sensitivity by the compression in dB.
- Tolerable products: the product must be below the noise floor by a margin (6 dB) or below the wanted signal by the required carrier-to-interference ratio (30 dB for clean audio).

## 5. Coordination rules (`coordinationRules`, approx)
- Minimum centre-to-centre spacing of 300 kHz for 200 kHz channels.
- An IM product's centre must lie at least (B_wanted + B_product)/2 = 2 B (400 kHz for 200 kHz channels) from every used channel centre.
- Equal spacing is the worst case: channels at f, f + d, f + 2d make 2(f + d) - f land on f + 2d. Use an intermodulation-free frequency set, check third order first, then fifth order if levels are high, and keep a guard band at the edge of a block.
- Reduce the cause as well: distance, pads, isolators, clean connectors.

## Sources
- Razavi, RF Microelectronics; Pozar, Microwave Engineering; Crols and Steyaert, CMOS Wireless Transceiver Design (intercept points, intermodulation).
- IEC 62037 series (passive intermodulation measurement, 2 x 43 dBm convention).
- Friis free-space transmission formula for antenna coupling.

## Review of imd.js
Reviewed `js/model/imd.js`. Hand checks with three 17 dBm transmitters at 600.0, 600.4 and 600.8 MHz (about 5 m from the receive antenna): the front-end level law, thermal floor (-113.0 dBm), the coordinated product list and the PIM scaling reproduce the formulas in this note.

Confirmed correct:
- Front-end level law P = sum |a_i| L_i - (n - 1) IIPn + 20 log10(m / m_ref) reproduces 2 P1 + P2 - 2 IIP3 for two-tone third-order products, +6 dB for equal-level three-tone products, and 3 P1 + 2 P2 - 4 IIP5 for 3 f1 - 2 f2. Other fifth-order products correctly carry their multiplicity (for example 2 f1 + f2 - 2 f3 is 9.5 dB above the two-tone fifth-order product). The product enumeration matches `imProductCount` (2, 9, 24, 50 for N = 2 to 5, third order).
- Antenna coupling: Friis with gains toward each other, 6.02 dB per doubling, and the lambda/2 near-field floor (the same constant as `imd-params.js`).
- Reverse IM: interferer at the PA output minus conversion loss, radiated through the same path as the transmitter's own carrier; linear in the interferer level; level at the receiver is consistent with the combiner loss.
- PIM: (43 + dBcRef) + 2 (Pa - 43) + (Pb - 43), which is P + dBcRef + 2 (P - 43) for equal tones (3:1 absolute scaling). A corroded connector at 13.5 dBm per carrier gives -135.5 dBm at the junction, matching the dBc law.
- Noise floor: power sum of thermal, in-channel products within +-B/2, and coupled transmitter noise using `coupledNoiseDbm`. The rise is reported for the worst channel.

Issues and suggestions:
1. A real collision is hidden. `coordinationCheck` (and the collision flag in `spectrum` markers) skips a product when the channel it lands on is one of its own source tones. That is correct for a positive-coefficient tone (it would need f_k = f_j), but not for the negative-coefficient tone: with evenly spaced channels f1 + f3 - f2 = f2 lands exactly on channel 2 (here -87.8 dBm against a wanted level near -41 dBm). It is a genuine in-channel interferer, but it is not listed, so the worst case of equally spaced channels is under-reported (the noise floor does include it). Only skip nothing, or skip only when the matching coefficient is positive.
2. Shared-combiner reverse IM subtracts both insertion loss and isolation (28.5 dB for the hybrid preset). Isolation is a port-to-port figure that already includes the split, so the interferer is 3.5 dB lower than the note's law (P_tx - isolation); products are under-reported by that amount. Use isolation only, or define `isolationDb` as excess isolation.
3. The fifth-order reverse product uses a hard-coded extra 15 dB. Move it to the parameter file (for example `TX_REVERSE_IM_5TH_EXTRA_DB`).
4. Cascade IIP3 is not modelled. A booster in `rxChain` has its own IIP3, and the cascade follows 1/IIP3_total = 1/IIP3_1 + G_1/IIP3_2 (linear units), so a high-gain preamp lowers the effective intercept of the whole chain. This is the physical reason to use fewer boosters. At present the receiver IIP3 is applied at the chain output only. Suggest a cascade helper.
5. PIM with separate antennas takes the second carrier's power at the junction as P_b minus the coupling between the two transmit antennas. A junction in one transmitter's own line does not see the other transmitter's field at the antenna terminals but the field at the antenna's position, which is the same order of magnitude; acceptable. For an accidental mixer such as a rusty fence, the junction sees the fields at its own position and re-radiates over its own path; the model has no fence position, so use the preset `rusty-contact` as an equivalent at the antenna.
6. `reverse IM` assumes the conversion loss at nominal power. If the scene lets a user lower transmit power, the product follows the interferer 1:1 and the own power by 0 dB; with a cubic PA the true dependence on own power would be 2:1 (see section 2). Consistent with the stated simplification.
7. Info: `spectrum` draws every product at its centre frequency as a narrow line. FM products are about three times the channel bandwidth wide (`productBandwidthFactor`), so the picture understates how much of the neighbouring channel they cover.

Figures checked numerically against the module (two 17 dBm transmitters 600.0 and 600.4 MHz): raising both transmitters by 3 dB raises the front-end IM3 product by 9.00 dB (3:1) and the PIM product by 9.00 dB (3:1); halving the transmitter-to-transmitter distance raises the reverse-IM product by 6.02 dB (4 m to 2 m and 8 m to 4 m); the thermal floor is -112.99 dBm for 200 kHz and NF 8 dB; product enumeration for eight transmitters at real frequencies gives the same counts as `imProductCount` (224 third order, and the same fifth-order count). The test file for the module was still being edited when this was written, so some of its tests were failing in the last full run (noise floor worst-channel selection); the figures above are not affected.
