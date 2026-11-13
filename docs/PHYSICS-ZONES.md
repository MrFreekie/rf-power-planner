# Physics notes: multi-antenna IEM zones

Data lives in `js/model/zones-params.js`; maths in `js/model/rf.js` (wall transmission) and `js/model/coverage.js`.

All presets are generic and illustrative. Real walls and distribution hardware vary; measure on site for critical coverage.

## 1. Wall transmission loss
A signal that passes through a wall loses energy to reflection at the two surfaces and to absorption inside. The reflector model already handles the reflected path; this section is the transmitted path.

- Loss at about 600 MHz for a reference thickness, in `MATERIAL_TRANSMISSION` (ids match `MATERIALS` in the library, plus variants):

| Material | Reference thickness | Loss at 600 MHz | Frequency exponent |
|---|---|---|---|
| Drywall / plasterboard stud wall | 100 mm | 3 dB | 0.4 |
| Brick, single leaf | 100 mm | 5 dB | 0.7 |
| Concrete, thin | 100 mm | 8 dB | 0.6 |
| Concrete, thick | 300 mm | 18 dB | 0.6 |
| Concrete, reinforced | 200 mm | 20 dB | 0.6 |
| Glass, single pane | 10 mm | 2 dB | 0.3 |
| Glass, metal-coated (low-E) | 24 mm | 20 dB | 0.2 |
| Wood door / stage flat | 40 mm | 2.5 dB | 0.4 |
| Drapes | 20 mm | 3 dB | 0.3 |
| Metal sheet | 1 mm | 60 dB | 0 |
| Soil / earth bank | 500 mm | 10 dB | 0.5 |

- Scaling law: L(t, f) = (interfaceDb + absorptionDbPerM x t) (f / 600)^g, g the exponent (see `PHYSICS-CASCADE.md`, section 4). At the reference thickness this equals the table value; thin walls keep the interface loss. Example: brick, 100 mm, 5 dB at 600 MHz becomes 5 x 4^0.7 = 13.2 dB at 2.4 GHz.
- Basis: ITU-R P.2040 permittivity and conductivity values (see the library) give absorption of about 23 dB per metre for concrete at 600 MHz, i.e. 2 to 3 dB per 100 mm, plus interface losses; measured walls add moisture, rebar and voids, hence the larger values here. These are typical, not exact (approx).
- Metal is a screen. Real leakage is through gaps, doors and cable penetrations, so 60 dB is a cap, not a prediction.
- Human crowd is not a wall; it is a fading allowance for receivers in or behind an audience (`CROWD_ALLOWANCE_DB`): sparse 3 dB, dense 6 dB, packed 10 dB (approx).
- The scene has no wall thickness field; the model uses the reference thickness unless a reflector sets `transmissionLossDb` directly. Thickness scaling is available through `transmissionLossDb(id, thicknessM, freqMHz)`.

## 2. Distributed antenna systems for IEM

### Splitting
- A passive N-way splitter divides power: the loss per output is 10 log10(N) + insertion loss. 2-way: 3.0 + 0.3 = 3.3 dB; 4-way: 6.0 + 0.6 = 6.6 dB; 8-way: 9.0 + 1.0 = 10.0 dB (`SPLITTER_PRESETS`). Isolation between outputs is typically 16 to 20 dB for a good splitter; poor isolation lets one antenna's reflections feed another.
- An active distribution amplifier supplies net gain per port (preset 6 dB for 4 ports, 3 dB for 8 ports), with a noise figure of 6 to 7 dB and an output limit of about +10 dBm, so it must not be driven into compression (approx).

### Long cable branches versus a booster
Cable loss at 600 MHz (library): RG58 21.3 dB per 50 m, LMR-240 10.1 dB, LMR-400 5.4 dB, LMR-600 3.4 dB. A 50 m run of RG58 costs more than the 4-way split itself (6.6 dB); LMR-400 costs about the same as the split. Rule: use lower-loss cable before reaching for gain; use a booster only when the loss of the run would otherwise leave the antenna too low in level. Put the booster near the transmitter or splitter, since loss before it sets the noise figure and loss after it only reduces the radiated power. Cable velocity factor 0.66 to 0.87 gives 3.8 to 5.1 ns per metre of delay (LMR-400: 3.9 ns/m).

### Overlap and interference
- Two antennas radiating the same carrier produce, where their fields overlap, a sum with a phase that depends on the path difference measured in wavelengths. For equal amplitudes |1 + e^(j phi)| = 2 |cos(phi / 2)| with phi = 2 pi (path difference) / lambda: a null every wavelength of path difference (0.5 m at 600 MHz). A cable-length difference of 10 m adds about 39 ns, equal to 24 wavelengths, which merely rearranges where the nulls fall, so the nulls cannot be tuned away by cable length; one centimetre of movement shifts them.
- Depth depends on the level difference between the two signals. Peak-to-null swing = 20 log10((1 + r)/(1 - r)), r = 10^(-delta/20): equal levels: infinite null; 3 dB apart: 15 dB swing; 6 dB: 9.6 dB; 10 dB: 5.7 dB; 20 dB: 1.7 dB. Design the zones so that the overlap region is as small as possible and the antenna levels differ by 10 dB or more where they meet.
- Why the nulls exist. The two copies are coherent if their path difference is shorter than the coherence length of the modulated signal, c / B. For a 200 kHz analog IEM channel that is about 1.5 km, so inside a venue the copies are always coherent and the null pattern is fixed by the carrier wavelength. Only a wideband signal (a 20 MHz digital link has a coherence length of 15 m) behaves as an incoherent power sum once the path difference exceeds that length, and then the nulls average out (and frequency-selective fading takes their place). Do not rely on delay to make FM antennas behave as separate zones. The FM capture effect helps a little: the demodulator follows the stronger copy if it is about 6 to 10 dB stronger.
- Mitigation: directional antennas aimed at their own zones and away from each other; separate antennas physically so the beams meet at a 10 dB or more level difference; balance levels with fixed attenuators in the shorter or lower-loss branches so that no zone is over-driven (overload, see `PHYSICS-RX.md`); keep antennas out of each other's near field; use fewer, higher-quality antennas instead of many overlapping ones. Different frequencies per zone avoid the problem but cost spectrum and require receivers to retune.

## 3. Coverage criteria
- Required level at the bodypack input = squelch threshold + fade margin (+ body shadow if not in the antenna model + crowd allowance).
- Fade margin: 10 to 20 dB for moving, body-worn receivers (preset 'moving-bodypack': 15 dB; static performer 6 dB; critical wide stage with crowd 20 dB). Body shadowing: typically 6 dB, worst 10 dB for a bodypack at the hip (approx; do not double count the body antenna model, see `PHYSICS.md`).
- Example: IEM default squelch threshold -80 dBm (sensitivity -85 + 5) plus 15 dB gives a required -65 dBm.
- Zone pass rule: a zone passes when at least 95 percent of its area is at or above the required level (90 percent static, 98 percent critical). The remaining area should be known and small, not scattered in the middle of the stage.
- A coverage map is computed from the deterministic multipath model, so it includes nulls; mean-level maps hide them. Grid spacing should be no more than a quarter wavelength at the carrier to resolve nulls (0.12 m at 600 MHz) or the pass fraction is only an estimate.

## Sources
- ITU-R P.2040 (building materials and structures), ITU-R P.1238 (indoor propagation).
- Pozar, Microwave Engineering (power dividers, isolation, insertion loss).
- Library cable data: `js/model/library.js`.

## Review of rf.js wall transmission and branches
Reviewed `rf.js` wall transmission (`wallTransmissionLossDb`, `pathWallLoss`). The geometry is sound: a leg counts a wall once when it crosses the wall's segment within its zMin..zMax range, touching legs (reflection points) are skipped, and the loss is added to the path before the coherent sum.

Issues and suggestions:
1. The parameter table is read through `lossDb`, `refMHz` and `freqExponent`. `zones-params.js` supplies these (plus `lossDb600`), so the table takes effect. The fallback table inside `rf.js` disagrees with it (concrete 14 dB, brick 9 dB, glass 3 dB, metal 30 dB against 8, 5, 2 and 60 dB at the reference thickness) and uses a fixed square-root frequency law. Keep it only as a safety net.
2. The scene has no thickness. The reference thickness is assumed (100 mm for masonry). Add an optional `thicknessM` to reflectors and call `transmissionLossDb` for the real thickness, or document the assumption in the UI.
3. Reflection and transmission loss are modelled independently. For a thin lossy wall the sum of reflected and transmitted power plus absorption should not exceed the incident power. With these values it does not (concrete reflects about 0.5 in amplitude and transmits about 0.4), so the pair is consistent.
4. A wall crossing counts the loss once even when the leg crosses at a grazing angle; a long slanted path inside a thick wall would lose more (path through the wall is thickness / cos(theta)). Minor.
5. Branch sum (`prepareBranches`, `evalPrepared`): the splitter loss 10 log10 N + insertion, per-branch chain loss and the chain phase from electrical length (length / velocity factor) agree with section 2, and the coherent sum is the right default for an analog IEM link (coherence length about 1.5 km). For a wideband digital link (coherence length of metres) the `power` mode is the better default. `splitterLossDb` reads only `insertionLossDb`; an active distribution amplifier (net gain per port, `splitterPortLossDb` in the params) cannot be expressed. Suggest a `gainDb` field on `link.splitter`.

## Review of coverage.js
Reviewed `js/model/coverage.js`. Grid indexing, the resumable budgeted loop, the point-in-polygon test with edge inclusion and the zone statistics (minimum, power mean, 5th percentile, pass fraction, worst point) are correct and deterministic. The suggestion search (move, attenuate, gain, scored on the target zone with a penalty for harm to other zones) is a sensible brute-force approach.

Issues and suggestions:
1. Threshold. `evaluate` compares the level with `link.rx.sensitivityDbm` (plus the zone margin). The criterion in section 3 is the squelch threshold plus the fade margin; the squelch (default sensitivity + 5 dB) closes the audio before the sensitivity limit is reached. Use `link.rx.squelch.thresholdDbm` when the squelch is enabled, falling back to the sensitivity. `requiredLevelDbm` in the params gives the formula.
2. Pass rule. `pass` means every cell passes (100 percent). The recommended rule is a pass fraction of at least 95 percent (`passAreaFraction` in `COVERAGE_PRESETS`). Suggest `pass = passFraction >= (zone.passAreaFraction ?? 0.95)`, and keep `passFraction` visible so a nearly passing zone is not shown as a failure without context.
3. Double counting of the fade margin. `prepareBranches` subtracts `environment.fadeMarginDb` (and body loss) from every branch level, while `zoneStats` adds `zone.requiredMarginDb`. If both are set the margin counts twice. Document that one of them should be used, or drop one.
4. Grid spacing. The default cell is 0.5 m, but the deterministic multipath pattern has nulls every half wavelength (0.25 m at 600 MHz), so a 0.5 m grid undersamples the nulls and samples a random-looking subset of them. The pass fraction is then an estimate, not a measurement. For small zones use a cell of a quarter wavelength or less, or state that the figures are sampled.
5. Suggested moves go toward the zone's worst point, which can increase the overlap between branches and deepen comb nulls elsewhere; the harm term only covers other zones, not the overlap region inside the same zone. Acceptable as a heuristic.
6. `rxHeight` is one height for the whole grid (the link's receiver height by default); body-worn receivers move between roughly 0.8 and 1.8 m. Evaluating two heights would show the height dependence of nulls.
