# Physics notes: RF Bench

Owner: rf-physicist. Data lives in `js/model/library.js`; maths in `js/model/rf.js`.

## Assumptions
- Far-field, narrowband, single frequency per link. 50 ohm system, matched connectors (mismatch/VSWR not modelled).
- Free-space path loss: FSPL = 32.44 + 20 log10(d_km) + 20 log10(f_MHz).
- Two-ray / image method: direct + floor + single-wall + floor-wall paths, summed coherently as complex phasors with phase = -2 pi d / lambda plus reflection-coefficient phase.
- Fresnel reflection coefficients for a smooth, lossy, semi-infinite dielectric with complex permittivity eps_c = epsR - j * sigma / (2 pi f eps0). Vertical polarisation (E in plane of incidence) has a Brewster dip; horizontal does not. Grazing angle is measured from the surface.
- Library epsR and sigma are fixed per material (ITU-R P.2040 near 1 GHz). Real values drift with frequency; across 470-2400 MHz sigma of concrete varies roughly 0.02-0.05 S/m, which changes reflection magnitude by only a few percent.
- Pattern helper `antennaPatternDb(id, azOffsetDeg, elOffsetDeg)` takes offsets from the antenna boresight and uses a separable approximation (azimuth cut + elevation cut, clamped to -40..0 dB). This is accurate near boresight and on the principal planes, rough on diagonals.
- Dipole boresight is broadside; its axis lies at elevation offset +90 (null there). Callers must express the bearing relative to the antenna's `orientation` before calling.
- Body-worn antenna: -3 dBi base gain, plus up to -9 dB behind the torso. `rx.bodyLossDb` / `environment.bodyLossDb` in the scene is additional and must not double count; use either the `body` antenna type with bodyLossDb = 0, or a free antenna with a bodyLossDb figure. Typical measured body loss for a bodypack at the hip is 3-10 dB.
- `absorbDb` (SURFACES.carpet, MATERIALS.drapes) is extra per-bounce loss for porous finishes. It is optional; rf.js should add it to the reflection loss if it uses it.
- Cable attenuation: dB/100 m from datasheets, log-log interpolated, clamped extrapolation outside 100-2400 MHz is acceptable (loss ~ sqrt(f) dominates; use slope of the nearest segment). Temperature and connector loss excluded.

## Model limits
- Specular reflections only. No diffraction (knife-edge around people, stage lip, truss), no scattering from rough surfaces, no transmission through walls.
- Reflectors are finite vertical planes between zMin and zMax; no ceilings or sloping surfaces.
- No polarisation rotation from reflections or antenna cross-polarisation; helical (circular) antennas are treated as linear with a nominal gain. Real CP-to-linear coupling costs 3 dB.
- No fading statistics (Rician/Rayleigh) beyond the explicit `fadeMarginDb`; no Doppler for moving performers.
- Body shadowing is a static dB figure, not geometry-dependent apart from the `body` pattern.
- No intermodulation, co-channel or adjacent-channel interference, noise rise, or receiver desense. Margin is signal vs sensitivity only.
- Near-field: valid for r > 2 D^2 / lambda and r >> lambda. At 470 MHz lambda is 0.64 m, so below about 1 m results are indicative only.

## Validation checklist
1. FSPL at 1 km, 1 GHz = 92.44 dB; at 10 m, 600 MHz = 47.96 dB (tolerance 0.05 dB).
2. Lossless perfect-electric-conductor floor: reflection coefficient magnitude 1, phase pi for horizontal polarisation.
3. Two-ray far field: for hT*hR << d, extra loss vs free space tends to 40 log10(d) - 20 log10(hT hR) total path loss (flat-earth asymptote), reflection coeff -1 at grazing.
4. Vertical polarisation over concrete shows a magnitude minimum near the pseudo-Brewster angle (about 24 deg grazing for epsR 5.31); horizontal does not.
5. Direct path alone with floor 'metal' and Tx on the floor: reflected path cancels or doubles per phase.
6. Cable: 100 m of LMR-400 at 900 MHz = 13.2 dB (datasheet 3.9 dB/100 ft x 3.28); interpolation at 1350 MHz lies between the 900 and 1800 MHz values and above the sqrt(f) chord only by < 1 dB.
7. Link budget waterfall sums: Tx power + antenna gains - FSPL - body loss - fade margin - chain loss = input power; margin = input - sensitivity.
8. Status thresholds: margin < 0 fail; 0..6 marginal; > 6 pass.
9. Path delays: delayNs = lengthM / 0.299792458; reflected paths strictly longer than direct.
10. Pattern: 0 dB at boresight for every antenna, paddle -3 dB near half its 75 deg beamwidth, F/B >= 15 dB for directional types.

## Sources
- ITU-R P.2040-3 (building materials), P.527-6 (ground), P.525 (free-space).
- Times Microwave LMR datasheets; Belden 9913, 8214, 8259, 8267; Pasternack RG174/RG58/RG213.
- Shure UA874/PA805/PA805Z2 and Sennheiser A 1031-U published polar patterns (approximated analytically).
- Values marked `// approx` in library.js are interpolated or recalled from public datasheets and should be re-verified against the specific cable batch before relying on them for a regulatory or critical link budget.

## Review of rf.js
Reviewed rf.js (408 lines). The core physics is correct. Numerical spot checks (omni, concrete floor, vertical pol, 600 MHz, ht 1.5 m, hr 2 m): effective path loss 98.5 dB at 500 m and 122.4 dB at 2 km vs flat-earth asymptote 98.4 / 122.5 dB; PEC floor at 30 deg grazing gives Gamma = -1.0; concrete vertical pol at 23.4 deg grazing (Brewster) gives |Gamma| = 0.037 and at 1 deg gives -0.91; dipole axis null -37.9 dB; paddle rear -18 dB; FSPL formula matches Friis.

Confirmed correct:
- Complex permittivity eps_c = epsR - j 60 sigma lambda (equals sigma / (2 pi f eps0)) with e^{+jwt} convention, consistent with propagation phase e^{-jkd}.
- TM/TE Fresnel formulas, both -> -1 at grazing; vertical pol on a floor = TM, on a vertical wall = TE (swapped for horizontal). Incidence from normal -> grazing = 90 - inc.
- Image method with unfolding, crossing test rejects Tx and Rx on opposite sides of a wall, wall length and zMin/zMax checked, spreading uses the full unfolded length.
- Antenna frame (right = (cos az, -sin az, 0), up = right x boresight) matches the library convention, so the dipole null lands on its up-axis.
- Waterfall sums, chain order for mic vs IEM, status thresholds.

Issues and suggestions (none block phase 1-2):
1. Minor, `antennaGainDb` (rf.js:120): azimuth and elevation table values are summed without clamping, so a far off-axis direction can go below the library floor of -40 dB (not reached by current tables, but a patternOverride could). Suggest `Math.max(rel, -40)` (the library `antennaPatternDb` clamps).
2. Minor, `fsplDb` (rf.js:40): clamp is 1 mm, which yields negative FSPL (a gain) inside the near-field. At 600 MHz, d = 0.02 m gives -5.97 dB. Suggest clamping d to at least lambda / (4 pi) (about 4 cm at 600 MHz) or 0.1 m so FSPL stays >= 0 dB, and flag results for d < 1 m as indicative.
3. Minor, body loss (rf.js:396): `environment.bodyLossDb + rx.bodyLossDb` are both applied, and the `body` antenna type already has -3 dBi gain and up to -9 dB rear shadow. The UI must make it clear these stack, otherwise a bodypack is double penalised.
4. Minor, analytic fallback (rf.js:84-90): the analytic paddle/helical/logperiodic half-power widths (70/60/65 deg) differ from the library tables (75/80/65 deg) and `analyticRelDb` body/omni return 0. Only used for string pattern overrides, so low impact, but better to derive both from one source.
5. Info, `chainItemLossDb` booster (rf.js:308): noise figure ignored; for long RX cable runs before a booster the system noise figure, not just signal level, sets the real sensitivity. Document as a limit (done above), consider a later NF cascade (Friis formula for noise).
6. Info, a very low reflected-path margin is reported only in `relDb`; deep fades (path loss > FSPL by 20+ dB) are real at fixed positions but a moving performer sweeps through them. Consider showing min/max path loss over +/- half a wavelength in the UI rather than a single number.
7. Info, all paths use the same polarisation Fresnel mode regardless of the actual ray geometry (e.g. steep floor+wall paths); acceptable for near-horizontal rays, which dominate stage geometries.
