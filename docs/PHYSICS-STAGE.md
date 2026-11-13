# Physics notes: stage height and raised platforms

Data lives in `js/model/stage-params.js`; maths in `js/model/floor.js` and `js/model/rf.js`.

All values are generic and illustrative (marked approx in the parameter file). Real decks differ in construction, skirting and cabling.

## 1. Why a raised floor matters
- Positions are heights above the local floor (deck or platform); the reflecting plane is the local floor. The two-ray ground reflection depends on the antenna heights above the plane that actually reflects, not above the ground.
- Path difference between the direct and reflected rays: D = sqrt(d^2 + (ht + hr)^2) - sqrt(d^2 + (ht - hr)^2), which is about 2 ht hr / d for d much larger than the heights. For a reflection coefficient close to -1 (grazing incidence) the two rays cancel when D = k lambda (k = 1, 2, ...), giving nulls at d_k = 2 ht hr / (k lambda); between them the sum is up to 6 dB high.
- Worked example, 600 MHz (lambda 0.4997 m), receiver at 1.5 m above the ground in the audience, horizontal distance 10 m:
  - Microphone 1.5 m above the ground (flat stage): ht = hr = 1.5 m. D = 0.440 m = 0.88 lambda. Nulls at d_k = 2 x 2.25 / (k x 0.4997): 9.0 m, 4.5 m, 3.0 m ...
  - Same microphone 1.5 m above a 1.2 m deck (absolute height 2.7 m). Using the ground plane: ht = 2.7 m, hr = 1.5 m, D = 0.774 m = 1.55 lambda; nulls at 16.2 m, 8.1 m, 5.4 m. Using the deck plane: ht = 1.5 m, hr = 0.3 m (the receiver is 0.3 m above the deck level), D = 0.089 m = 0.18 lambda; the first null is at 1.80 m and there are no nulls beyond it.
  - So raising the stage by 1.2 m moves the first null from 9 m to 16 m under the ground-plane model, and the deck-plane model removes all nulls beyond 1.8 m. Which of the two is correct depends on where the reflection point is (next paragraph). Ignoring the deck altogether puts nulls in the wrong places, a many-metre error.
- Specular point. The reflection point lies at x_s = d ht / (ht + hr) from the transmitter (ground plane: 6.43 m; deck plane: 8.33 m in the example). It is valid only when it lies on the floor level it assumes: a deck-plane reflection is real only if x_s is on the deck; a ground-plane reflection is real only if x_s is on the lower floor and the reflected ray is not blocked by the deck body.
- Different floor heights for the Tx and Rx: the effective plane depends on the specular point, which depends on the plane. Iterative solution: start with the floor height at the midpoint of the two feet, find the specular point, look up the local floor height there, update the plane and repeat; accept when the height stops changing. Convergence is normally immediate. The iteration fails near an edge, where each candidate plane puts the reflection point on the other level (oscillation). In that case there is no valid specular reflection and the physical answer is a partial reflection (see edges below).
- Accuracy limit: any reflection point within about one first Fresnel zone of an edge is only partly a reflection. The first Fresnel zone radius is r = sqrt(lambda d1 d2 / (d1 + d2)): 1.12 m for d1 = d2 = 5 m at 600 MHz (0.56 m at 2.4 GHz).

## 2. Platform bodies as obstructions
- A ray from a low point (audience floor, orchestra pit) to a point low on a raised deck can cross the platform volume. It crosses the riser face when its height at the face is below the deck height: ray height at distance x from the transmitter = z_tx + (z_rx - z_tx) x / D. Example: transmitter 0.3 m above a 1.2 m deck (z = 1.5 m), 4 m behind the edge, receiver on the floor at 0.3 m, 10 m away: the ray is 1.02 m high at the edge, below 1.2 m, so it enters the body through the face.
- A stage deck is mostly a hollow box: two skins, legs, bracing, cables. Through-loss = interface loss + absorption per metre of chord, times (f/600)^g, capped:

| Body (`PLATFORM_BODY`) | Interface | Absorption | 2 m chord at 600 MHz | Cap |
|---|---|---|---|---|
| Stage deck, wood on frame (default) | 3 dB | 1 dB/m | 5 dB | 20 dB |
| Solid riser (filled timber or foam) | 3 dB | 8 dB/m | 19 dB | 40 dB |
| Steel truss deck | 4 dB | 3 dB/m | 10 dB | 30 dB |
| Steel or aluminium plate deck | 30 dB | 0 | 30 dB | 60 dB |
| Concrete podium | 2.5 dB | 55 dB/m | 60 dB (capped; 112 uncapped) | 60 dB |

- Basis: ITU-R P.2040 gives dry wood about 5 dB/m at 600 MHz (epsR 1.99, sigma 0.0047 S/m); moisture and fixings add. Concrete matches the wall table in `zones-params.js`. The default is the hollow wood-on-frame deck (5 dB for a typical 2 m chord): light, because most real decks are hollow. If the underside is closed with solid panels or filled, choose the solid riser.
- Mapping from the library floor surface (`SURFACE_PLATFORM_BODY`): wood, carpet and glass: wood-on-frame; metal: steel truss; concrete: concrete; grass: solid riser (an earth bank). `PLATFORM_OBSTRUCTION` gives `interfaceDb` and `dbPerM` by surface in the form the floor model reads.

## 3. Riser faces as reflectors
- The vertical front faces of a deck or platform reflect like walls, from the lower floor up to the deck top. Use the existing wall reflection coefficients with the face material from `MATERIALS` (`RISER_FACE_MATERIAL` by body; `SURFACE_RISER_FACE_MATERIAL` by floor surface: wood to wood, concrete to concrete, metal to metal, carpet to drapes). A skirt of cloth absorbs rather than reflects; `carpet` is not a wall material in the library.
- Because the through-loss of a riser is the platform obstruction, the face reflector carries no separate transmission loss (otherwise it would be counted twice).
- Edges are treated specularly only. There is no diffraction over the deck edge or around a platform corner. A shadow boundary in reality is soft, roughly one first Fresnel zone wide (about 1 m at 600 MHz and 5 m + 5 m), and the field in the shadow is not zero (knife-edge diffraction loss is about 6 dB at the edge and rises gradually). The on/off treatment can be wrong by about 6 dB within that band and more deep inside the shadow (approx, `EDGE_MODEL`).

## 4. Deck materials for the floor reflection
Mapped to the library `SURFACES` ids (`DECK_SURFACE_ID`): wood (plywood or floorboards) to `wood`; steel or aluminium plate to `metal` (almost total reflection, reflection coefficient close to -1 at all angles for horizontal polarisation); carpet-covered to `carpet` (a little extra loss at grazing incidence); concrete to `concrete`; glass to `glass`. Typical deck heights come in steps of 0.2 to 2.0 m (`DECK_HEIGHT_STEPS_M`); stage sizes from 5 x 3.5 m (small club, 0.6 m deck) to 20 x 14 m (arena, 1.5 m deck) (`STAGE_SIZE_PRESETS`, illustrative).

## 5. Validation checklist
1. With deck height 0 and no platforms every result is identical to the flat-floor model.
2. Path difference for ht = hr = 1.5 m, d = 10 m is 0.440 m; for ht = 2.7 m, hr = 1.5 m it is 0.774 m (0.088 m for 1.5 m and 0.3 m).
3. Raising both antennas and the floor by the same height changes nothing (positions are relative to the local floor).
4. A receiver below the reflecting plane (for example in a pit below a deck with the transmitter above it) gets no floor reflection from that plane.
5. The reflection point of a returned floor path lies on a floor whose height equals the plane height used.
6. Obstruction chord for a ray through a 1.2 m deck: interface + dB/m x chord; chord zero when the ray passes above the deck top; a ray starting on the top surface is not inside.
7. A riser-face reflection exists only between the lower floor and the deck top.
8. Obstruction loss is capped and frequency scaled as in the table.
9. Nulls move as 2 ht hr / (k lambda): doubling the transmitter height above the plane doubles the null distances.
10. Continuity: moving the Tx or Rx a few centimetres must not change the level by many dB; large jumps indicate an on/off edge decision (see the review).

## Sources
- ITU-R P.527 (ground reflection), ITU-R P.526 (diffraction and Fresnel zones), ITU-R P.2040 (building materials).
- Standard two-ray propagation texts (image method, path difference).

## Review of floor.js and the rf.js floor changes
Reviewed `js/model/floor.js` (floor height lookup, absolute positions, platform boxes, riser faces, chords) and the floor reflection and obstruction code in `rf.js`. Confirmed correct: heights are relative to the local floor and converted to absolute at the solver edge; a flat scene returns the unchanged objects (checklist item 1); riser faces run from the lower floor to the deck top with no extra transmission loss (not counted twice); chords are merged across overlapping bodies, and a ray starting on a top surface is not inside; a receiver below the plane gets no floor path (the `hitPlane` sign test); the image method for the floor with walls in either order uses the local floor height.

Issues and suggestions:
1. A phantom floor reflection is returned. The plane-height iteration (`unfoldFloor`, three passes) does not check that the final specular point lies on the floor level used. Test: deck 1.2 m high from x = 0 to its edge, transmitter 1.5 m above the deck at x = 2 m, receiver 1.5 m above the ground at x = 12 m. With the edge at 8 m or less the result is right (reflection at x = 8.43 m on the ground). With the edge at 8.5 m or more the path is returned with its reflection point at x = 10.33 m and z = 1.2 m: a reflection from a deck that is not there (floor height 0 at that point). Near the transition (an edge between the two specular points) neither plane is valid. Fix: after the iteration, accept the path only if `floorHeightAt` at the reflection point equals the plane used, otherwise drop it (or, better, scale the reflection amplitude by the fraction of the first Fresnel zone that lies on that plane, so the level changes continuously).
2. Discontinuity. The on/off decision above makes the level jump by several dB when the receiver moves a few centimetres across the boundary; checklist item 10 fails. A smooth transition over about one Fresnel zone removes it.
3. A ground reflection whose specular point lies under the deck footprint is accepted only if the plane lookup there returns 0; the ray from the ground reflection point to the transmitter passes through the deck body and should be obstructed (its chord loss is added since the leg passes through the platform box, so the combination is consistent).
4. The obstruction loss has no cap and no frequency scaling: `chordsThrough` returns interface + dB/m x chord, so a long chord through concrete is hundreds of dB. `stage-params.js` provides `maxLossDb` and a frequency exponent per body (`PLATFORM_BODY`), and the table in `PLATFORM_OBSTRUCTION` carries `maxLossDb`; apply `min(maxLossDb, ...)` and the (f/600)^g factor. The built-in fallback in `floor.js` (wood 0.5 dB + 3 dB/m) is lighter at the interface and heavier per metre than the default hollow deck (3 dB + 1 dB/m); the parameter file now supplies `PLATFORM_OBSTRUCTION`, so the fallback is only a safety net.
5. Riser face material: `risersOf` uses the box's floor surface id directly as the reflector material. `carpet` (and any surface id that is not a `MATERIALS` id) falls back to the default wall. Use `SURFACE_RISER_FACE_MATERIAL` from the parameter file (carpet maps to drapes).
6. Info: the deck is modelled as a solid box for obstruction, so a transmitter placed inside the stage volume (a pit below the deck) is treated as inside the body; its position should be rejected or flagged in the editor.
