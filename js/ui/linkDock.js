// Where the selected link's property sections (Link, Transmitter, Receiver, cable chains) are shown. The inspector builds them for the
// selected link and hands them here; the Radio items list puts each one inside the item it belongs to. Not saved, no scene data. DOM nodes only.
let sections = null; // { link, tx, rx, chain, rxchain, chainB } -> <details> elements of the selected link, or null
const subs = new Set();
export const LINK_DOCK_SECTIONS = Object.freeze(['link', 'tx', 'rx', 'chain', 'rxchain', 'chainB', 'p2p']);
export const getLinkDock = () => sections;
export function setLinkDock(map) { sections = map; for (const cb of [...subs]) cb(sections); }
export function subscribeLinkDock(cb) { subs.add(cb); return () => subs.delete(cb); }

// The scene-wide venue sections (stage, platforms, audience, crowd, ceiling, noise sources, environment, reflectors), shown in the Venue builder panel.
let venue = null;
const venueSubs = new Set();
export const VENUE_DOCK_SECTIONS = Object.freeze(['stage', 'plats', 'aud', 'crowd', 'ovh', 'noise', 'env', 'refl']);
export const getVenueDock = () => venue;
export function setVenueDock(map) { venue = map; for (const cb of [...venueSubs]) cb(venue); }
export function subscribeVenueDock(cb) { venueSubs.add(cb); return () => venueSubs.delete(cb); }
