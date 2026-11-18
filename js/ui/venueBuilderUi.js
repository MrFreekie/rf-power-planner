// Venue builder panel: the stage, platforms, crowd zones, ceiling, noise sources, environment and reflector forms in one place.
// The forms are built by the inspector (they need its field helpers) and handed over through linkDock.js; this panel only hosts them.
import { getVenueDock, subscribeVenueDock, VENUE_DOCK_SECTIONS } from './linkDock.js';

export function mountVenueBuilder({ container }) {
  container.textContent = '';
  const summary = document.createElement('summary'); summary.textContent = 'Venue builder';
  const body = document.createElement('div'); body.className = 'ob-body';
  const intro = document.createElement('p'); intro.className = 'hint';
  intro.textContent = 'The room the show happens in: stage and platforms, crowd zones, ceiling, noise sources, floor and propagation settings, reflectors.';
  const host = document.createElement('div'); host.className = 'venue-docked';
  // The floor surface select is wired in app.js; its element moves here from the top bar so the venue settings sit together.
  const floorSel = document.getElementById('floor'), floorLabel = floorSel && floorSel.closest('label');
  // The venue drawing import button (opens its dialog) also moves here from the top bar.
  const importBtn = document.getElementById('btn-venue');
  const row = document.createElement('div'); row.className = 'venue-import-row';
  if (importBtn) row.append(importBtn);
  body.append(intro, row);
  if (floorLabel) { floorLabel.classList.add('venue-floor'); body.append(floorLabel); }
  body.append(host);
  container.append(summary, body);
  const draw = () => {
    const dock = getVenueDock(); host.textContent = '';
    if (!dock) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'No link in the scene.'; host.append(p); return; }
    for (const n of VENUE_DOCK_SECTIONS) if (dock[n]) host.append(dock[n]);
  };
  const unsub = subscribeVenueDock(draw); draw();
  return { render: draw, destroy() { unsub(); } };
}
