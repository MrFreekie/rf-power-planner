// Panels that host forms built by the inspector's form engine (handed over through linkDock.js): People, Point-to-point link, Intermod demo.
import { getVenueDock, subscribeVenueDock, getLinkDock, subscribeLinkDock } from './linkDock.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function mountPeoplePanel({ container }) {
  container.textContent = '';
  const body = mk('div', 'ob-body'), host = mk('div', 'venue-docked');
  body.append(host); container.append(mk('summary', null, 'People'), body);
  const draw = () => { const d = getVenueDock(); host.textContent = ''; if (d && d.ppl) { d.ppl.open = true; host.append(d.ppl); } else host.append(mk('p', 'hint', 'No link in the scene.')); };
  const unsub = subscribeVenueDock(draw); draw();
  return { render: draw, destroy() { unsub(); } };
}

/** The selected link's sections when it is point to point (mic and IEM links keep theirs inside their radio items). */
export function mountP2pPanel({ container, store }) {
  container.textContent = '';
  const body = mk('div', 'ob-body'), host = mk('div', 'venue-docked');
  body.append(mk('p', 'hint', 'Select a point-to-point link to edit its path, antennas and cable chain here.'), host); container.append(mk('summary', null, 'Point-to-point link'), body);
  const draw = () => {
    const d = getLinkDock(), sel = store.getSelection && store.getSelection();
    const link = d && d.link && d.p2p; host.textContent = '';
    container.hidden = !link;
    if (link) for (const n of ['link', 'p2p', 'tx', 'rx', 'chain', 'rxchain', 'chainB']) if (d[n]) host.append(d[n]);
    void sel;
  };
  const unsub = subscribeLinkDock(draw); draw();
  return { render: draw, destroy() { unsub(); } };
}

/** The Intermod demo form, at the top of the Intermodulation panel while the demo is on. */
export function mountImdForm({ container }) {
  const slot = mk('div', 'imd-form');
  const draw = () => {
    const d = getVenueDock(); slot.textContent = '';
    if (d && d.imd) { d.imd.open = true; slot.append(d.imd); }
    if (slot.parentNode !== container) container.prepend(slot); else if (container.firstChild !== slot) container.prepend(slot);
  };
  const unsub = subscribeVenueDock(draw); draw();
  return { render: draw, destroy() { unsub(); } };
}
