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
- Free-space and two-ray (floor) path loss, wall reflections, through-wall loss with thickness, and antenna patterns.
- Cable, booster, filter, attenuator and splitter chains with a power-budget waterfall, margin and pass/marginal/fail.
- Cascaded noise figure and sensitivity at the antenna terminals (booster at the antenna versus at the rack).
- Squelch with hysteresis, RF overload and headroom, receive diversity (switching, true, ratio).
- Multi-antenna IEM coverage with zones, a coverage heat map and fix suggestions.
- Intermodulation: front-end, transmitter-to-transmitter and passive products, noise floor and coordination checks.
- Printable report sheet, JSON save/load and shareable links (the scene is stored in the link; nothing is uploaded).

**As a physics demonstration**
- Moving ripples in plan and side views, plus a coherent "Field" mode that shows multipath fringes and nulls.
- FM MPX stereo that degrades to mono as the signal weakens, the 19 kHz pilot, pilot-tone squelch and stray carriers.
- Telemetry above the MPX band, battery sag and gauge error.
- Digital links: QAM constellation, BER curve, adaptive modulation and the cliff effect.
- Timeline of RF level, audio level and mute events; ready-made examples from the Examples menu.

## Run locally

ES modules need an HTTP origin (not `file://`):

    node scripts/serve.mjs 8080      # then open http://localhost:8080/

## Test

    node --test tests/               # Node 20+

`js/model/*` is pure (no DOM), so the physics runs under Node and is covered by unit tests with hand-computed values.

## Layout

- `index.html`, `css/style.css`: shell and styling
- `js/model/`: scene schema, RF maths, parameter libraries (cables, antennas, materials, receivers, modulation, intermod)
- `js/*Tracker.js`, `js/history.js`: live state (squelch, MPX, diversity, telemetry, digital, coverage, intermod)
- `js/view/`, `js/ui/`: canvas views, panels and the inspector
- `js/share.js`, `js/reportData.js`, `js/io.js`: share links, report data, save/load

## GitHub Pages

All URLs are relative, so the site works from a sub-path (`https://user.github.io/repo/`).
`.github/workflows/pages.yml` runs the tests, then publishes only `index.html`, `css/`, `js/` and `assets/` from a clean `_site/` folder.
In the repository settings choose Pages, Source: GitHub Actions.

## Licence

Released under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify and share it for
noncommercial purposes (personal use, hobby projects, education, research, charities and similar organisations).
Commercial use needs separate permission from the copyright holder.

## Conventions

Metres, MHz, dBm, dB, degrees internally. x = stage right, y = toward audience, z = up.
Azimuth 0 = +y, clockwise from above.
