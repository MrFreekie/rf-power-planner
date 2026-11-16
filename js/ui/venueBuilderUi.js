// Venue builder panel: the stage, platforms, audience, crowd zones, ceiling, noise sources, environment and reflector forms in one place.
// The forms are built by the inspector (they need its field helpers) and handed over through linkDock.js; this panel only hosts them.
import { getVenueDock, subscribeVenueDock, VENUE_DOCK_SECTIONS } from './linkDock.js';

export function mountVenueBuilder({ container }) {
  container.textContent = '';
  const summary = document.createElement('summary'); summary.textContent = 'Venue builder';
  const body = document.createElement('div'); body.className = 'ob-body';
  const intro = document.createElement('p'); intro.className = 'hint';
  intro.textContent = 'The room the show happens in: stage and platforms, audience and crowd, ceiling, noise sources, floor and propagation settings, reflectors.';
  const host = document.createElement('div'); host.className = 'venue-docked';
  body.append(intro, host); container.append(summary, body);
  const draw = () => {
    const dock = getVenueDock(); host.textContent = '';
    if (!dock) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'No link in the scene.'; host.append(p); return; }
    for (const n of VENUE_DOCK_SECTIONS) if (dock[n]) host.append(dock[n]);
  };
  const unsub = subscribeVenueDock(draw); draw();
  return { render: draw, destroy() { unsub(); } };
}
