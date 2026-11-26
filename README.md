# RF Bench

Plan, simulate, learn.

A static, dependency-free web tool for planning wireless microphone and in-ear monitor (IEM) RF links,
and for demonstrating the physics behind them. It runs entirely in the browser: no build step, no server,
no accounts. Vanilla ES modules and Canvas 2D.

> **Planning estimates only.** Models are simplified (specular reflections, no diffraction, illustrative
> component values). Always verify a critical system on site with a spectrum analyser and a walk test.

## What it does

**As a link budget tool**
- True-scale top-down plan and side views on a shared metre grid; drag transmitters, antennas, walls and zones.
- Free-space and two-ray (floor) path loss, wall reflections, through-wall loss with thickness, and antenna patterns (directional types include a front-to-back figure).
- The plan view refits when a scene loads and keeps labels from overlapping.
- Cable (including RG8X, hardline and 75 ohm RG6 with a mismatch warning), booster, filter, surge arrestor, attenuator and splitter chains with a power-budget waterfall, margin and pass/marginal/fail. Surge arrestor, RG8X and filter figures are assumed class values; hardline and RG6 are datasheet-based with some interpolation. A 75/50 ohm junction adds a small loss (about 0.18 dB) to the waterfall.
- A "Radio items" sidebar list, grouped by category: microphones by form factor, receive antennas (model, gain, aim, cable/booster/fibre chain, zones, dummy load), splitters (cascade up to 3 stages), receivers (channels, antenna bias, RF loop-through), IEM transmitters (channels, isolator), combiners (passive, active or isolated, with loss and isolation you can override, a cable, fan-out to several transmit antennas, or feeding into a joining combiner) and transmit antennas. Add mic / Add IEM, person assignment (one person can carry several mic and IEM packs), equipment pickers, a Tuning section (frequency, band) and an extra receiver for one mic.
- Rack checks: open-output and unused-port warnings, 50 ohm dummy loads and a what-to-pack count, a powering budget, an ERP check, DC voltage-drop warnings on long powered cable runs, and a warning when two transmitters share a frequency, overlap in bandwidth or sit inside a 100 kHz guard band.
- Builders for the venue (stage, platforms, audience, crowd, ceiling, noise sources, environment, floor, reflectors with Add room walls), People and a Point-to-point link.
- Cascaded noise figure and sensitivity at the antenna terminals (booster at the antenna versus at the rack).
- Squelch with hysteresis, RF overload and headroom, receive diversity (switching, true, ratio), set up inside the receiver and mic radio items.
- Multi-antenna IEM coverage with zones, a coverage heat map and fix suggestions.
- Intermodulation: front-end, transmitter-to-transmitter and passive products, noise floor and coordination checks, with an Intermod demo form.
  With a frequency-paired rack the Intermod demo can take its transmitters from the rack (every in-ear and microphone link, at its own antenna and position, through the rack's combiners), so the two cannot disagree. Products are then worked out at each bodypack or microphone receiver in turn, with a table per receiver and a menu to view any one of them in full.
- Venue underlay: import a venue drawing (SU4SV text) as a grey underlay with layer toggles and height shading.
- Frequency coordination checks by region and band, a scene compare table and named scenes saved in the browser (both in the Scenes pop-out in the top bar).
- Printable report sheet, JSON save/load and shareable links (the scene is stored in the link; nothing is uploaded).

**As a physics demonstration**
- Moving ripples in plan and side views, plus a coherent "Field" mode that shows multipath fringes and nulls.
- FM MPX stereo that degrades to mono as the signal weakens, the 19 kHz pilot, pilot-tone squelch and stray carriers.
- Telemetry above the MPX band, battery sag and gauge error (in the mic radio items).
- Digital links: QAM constellation, BER curve, adaptive modulation and the cliff effect.
- Timeline of RF level, audio level and mute events, plus audio, MPX and RF spectrum views in the bottom bar.
- Modulation lab: animated AM, FM, digital and stereo FM demonstrations, with pre-emphasis and companding.
- Ready-made examples from the Examples menu; Undo/Redo (Ctrl+Z, Ctrl+Shift+Z) covers every edit.

## Run locally

ES modules need an HTTP origin (not `file://`):

    node scripts/serve.mjs 8080      # then open http://localhost:8080/

## Test

    node --test tests/               # Node 20+

`js/model/*` is pure (no DOM), so the physics runs under Node and is covered by unit tests with hand-computed values.
`tests/app-wiring.test.mjs` also checks the app shell without a browser (element ids, module paths, import cycles, relative URLs).
The scene has optional `rack`, `link.txOf` and `imd.fromRack` / `imd.rxLinkId` fields (schema version still 2); older scenes load unchanged.
Tests that use local venue files in `tests/private-venues/` skip themselves when that folder is absent.

## Privacy

Everything runs in your browser. Scenes, saved scenes and settings are kept in `localStorage` on your device only.
Share links carry the scene in the URL fragment (after `#`), which browsers do not send to the server. Nothing is uploaded.

## Layout

- `index.html`, `css/style.css`: shell and styling
- `js/model/`: scene schema, RF maths, parameter libraries (cables, antennas, materials, receivers, modulation, intermod)
- `js/*Tracker.js`, `js/history.js`: live state (squelch, MPX, diversity, telemetry, digital, coverage, intermod)
- `js/view/`, `js/ui/`: canvas views and panels (radio items in `js/ui/rackUi.js`; model `js/model/rack.js`, edits `js/actionsRack.js`)
- `js/share.js`, `js/reportData.js`, `js/io.js`: share links, report data, save/load

## GitHub Pages

All URLs are relative, so the site works from a sub-path (`https://user.github.io/repo/`).
`.github/workflows/pages.yml` runs the tests, then publishes only `index.html`, `css/`, `js/` and `assets/` from a clean `_site/` folder.
In the repository settings choose Pages, Source: GitHub Actions.

## Licence

Released under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify and share it for
noncommercial purposes (personal use, hobby projects, education, research, charities and similar organisations).
Commercial use needs separate permission from the copyright holder.
Copyright (c) 2026 Mark Hughes.

## Conventions

Metres, MHz, dBm, dB, degrees internally. x = stage right, y = toward audience, z = up.
Azimuth 0 = +y, clockwise from above.
