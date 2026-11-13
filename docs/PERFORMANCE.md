# Rendering performance notes

Measured in headless Edge (software raster, no GPU) at 1280x900 with the example `zones-backstage-corridor`, Intermod on,
Digital on, all sidebar panels open, Walk running, ripples on. Numbers are per animation frame at the 30 fps ripple cap.

| Item | Cost (1x CPU) |
| --- | --- |
| Plan view draw (grid, heat map, rings, overlays) | about 4.4 ms |
| Walk tick (store update plus trackers) | about 3.4 ms |
| Side view draw | about 0.9 ms |
| Timeline draw | about 0.2 ms |
| Meters, MPX, digital, imd, diversity canvases | below 0.1 ms (off screen, skipped) |

At 1x that is roughly 9 ms of every 33 ms frame. With 4x CPU throttling (phone-like) the frame work rose to about 36 ms, so the ripple
loop now lowers its own frame rate to about 3x the measured draw cost (20 or 10 fps, never below 10) instead of saturating the main thread.

What was done
- `createCanvasHost` (js/view/util.js) skips drawing while its canvas is outside the viewport (IntersectionObserver, 120 px margin). It stays
  dirty and repaints when it scrolls back into view. Background tabs already stop requestAnimationFrame.
- `readTheme` caches the computed palette; it is rebuilt only on a theme or media change (getComputedStyle was about 1% of the profile).
- Heat map and ripple field already render into offscreen buffers and are re-blitted; the field cache key now includes the ink colour so a theme switch repaints it.
- Ripples pause for `prefers-reduced-motion`, a hidden tab, an off-screen pane, or the Pause button.

Not done (candidates)
- Cache the static plan layers (grid, stage hatch, heat map) into one offscreen canvas; would save about 1 to 1.5 ms of the 4.4 ms plan draw.
- `js/ui/inspector.js` spends about 90 to 150 ms per 6 s while walking (it is outside the view layer).
