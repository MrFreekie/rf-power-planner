// Pure helpers for the People section, the group outline and the budget rows. No DOM.
import { linkOwners, personPackPositions } from '../model/people.js';

const fin = Number.isFinite;

/** The person who carries a link, or null: { person, which: 'mic' | 'iem' }. */
export function personOfLink(scene, linkId, owners = null) {
  const o = (owners || linkOwners(scene && scene.people)).get(linkId); // pass `owners` (linkOwners(people)) to build the map once per draw
  if (!o) return null;
  const person = (scene.people || []).find((p) => p.id === o.personId);
  if (!person) return null;
  const out = { person, which: o.which };
  if (o.extra) { out.extra = true; out.extraIndex = (person.extraLinkIds || []).indexOf(linkId); } // a backup mic pack: "Mic 2" is extraIndex 0
  return out;
}

/** Options for adding a backup mic pack to a person: [{ value, label, swap }] of mic links that are not already theirs (main or backup). Links carried by someone else are flagged swap:true. */
export function extraChoices(scene, person) {
  const owners = linkOwners(scene.people), out = [];
  for (const l of scene.links || []) {
    if (l.kind !== 'mic' || l.id === person.micLinkId || (person.extraLinkIds || []).includes(l.id)) continue;
    const o = owners.get(l.id);
    if (!o) out.push({ value: l.id, label: l.name, swap: false });
    else { const other = (scene.people || []).find((p) => p.id === o.personId); out.push({ value: l.id, label: `${l.name} (carried by ${other ? other.name : 'someone'}, swap)`, swap: true }); }
  }
  return out;
}

/**
 * Options for a person's mic or IEM dropdown: [{ value, label, swap }]. Links nobody carries are plain; links carried by another person are
 * listed too but flagged swap:true (choosing one asks for confirmation, then the other person receives this person's previous link).
 * The first entry is "none".
 */
export function linkChoices(scene, person, which) {
  const kind = which === 'iem' ? 'iem' : 'mic', owners = linkOwners(scene.people), out = [{ value: '', label: 'None', swap: false }];
  for (const l of scene.links || []) {
    if (l.kind !== kind) continue;
    const o = owners.get(l.id);
    if (o && o.personId === person.id) { out.push({ value: l.id, label: l.name, swap: false }); continue; }
    if (!o) out.push({ value: l.id, label: l.name, swap: false });
    else { const other = (scene.people || []).find((p) => p.id === o.personId); out.push({ value: l.id, label: `${l.name} (carried by ${other ? other.name : 'someone'}, swap)`, swap: true }); }
  }
  return out;
}

/** Group outline in world coordinates: the person's floor point plus the live positions of their packs. null when the person is not placed. */
export function groupPoints(scene, person) {
  if (!person || !person.pos) return null;
  const pts = [{ x: person.pos.x, y: person.pos.y, what: 'person' }];
  for (const [which, key] of [['mic', 'micLinkId'], ['iem', 'iemLinkId']]) {
    const l = person[key] && (scene.links || []).find((q) => q.id === person[key]);
    if (!l) continue;
    const e = which === 'mic' ? l.tx : l.rx;
    pts.push({ x: e.pos.x, y: e.pos.y, what: which, linkId: l.id, itemId: e.id });
  }
  for (const id of person.extraLinkIds || []) { // backup mic packs stay inside the outline too
    const l = (scene.links || []).find((q) => q.id === id);
    if (l) pts.push({ x: l.tx.pos.x, y: l.tx.pos.y, what: 'mic', extra: true, linkId: l.id, itemId: l.tx.id });
  }
  return pts;
}

/** Circle that encloses the group points with padding (metres): { x, y, r }. Pure. */
export function groupCircle(pts, padM = 0.45) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy));
  return { x: cx, y: cy, r: r + padM };
}

const marginWord = (m) => (!fin(m) ? '-' : `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(1)} dB`);

/**
 * Both margins of a person: [{ which, linkId, name, marginDb, status, text }] from a solver callback solve(link) -> result | null.
 * Words accompany the numbers: status in capitals.
 */
export function personMargins(scene, person, solve) {
  const rows = [];
  for (const [which, key] of [['mic', 'micLinkId'], ['iem', 'iemLinkId']]) {
    const l = person[key] && (scene.links || []).find((q) => q.id === person[key]);
    if (!l) continue;
    let r = null; try { r = solve(l); } catch { r = null; }
    const m = r && fin(r.marginDb) ? r.marginDb : NaN, st = r && r.status ? String(r.status).toUpperCase() : 'UNKNOWN';
    rows.push({ which, linkId: l.id, name: l.name, marginDb: m, status: st, text: `${which === 'iem' ? 'IEM' : 'Mic'} ${marginWord(m)} ${st}` });
  }
  (person.extraLinkIds || []).forEach((id, i) => { // each backup mic pack: its own margin
    const l = (scene.links || []).find((q) => q.id === id); if (!l) return;
    let r = null; try { r = solve(l); } catch { r = null; }
    const m = r && fin(r.marginDb) ? r.marginDb : NaN, st = r && r.status ? String(r.status).toUpperCase() : 'UNKNOWN';
    rows.push({ which: 'mic', extra: true, linkId: l.id, name: l.name, marginDb: m, status: st, text: `Mic ${i + 2} ${marginWord(m)} ${st}` });
  });
  return rows;
}

/** Budget rows for the active link when its carrier has two links: both margins side by side. */
export function peopleBudgetRows(scene, link, solve) {
  const o = link && personOfLink(scene, link.id);
  if (!o) return [];
  const m = personMargins(scene, o.person, solve);
  if (!m.length) return [];
  const worst = m.reduce((a, b) => (fin(b.marginDb) && (!fin(a.marginDb) || b.marginDb < a.marginDb) ? b : a), m[0]);
  return [{ label: o.person.name, value: m.map((x) => x.text).join('  |  ') + (m.length > 1 ? `. Weaker: ${worst.extra ? 'backup mic' : worst.which === 'iem' ? 'IEM' : 'mic'}` : ''), severity: m.some((x) => x.status === 'FAIL' || x.status === 'DEAD') ? 'warning' : m.some((x) => x.status === 'MARGINAL') ? 'info' : 'ok' }];
}

/** Paths-table rows for the active link's carrier: one row with both margins side by side ({ kind, length, delayNs, relDb } strings). */
export function peoplePathRows(scene, link, solve) {
  const o = link && personOfLink(scene, link.id);
  if (!o) return [];
  const m = personMargins(scene, o.person, solve);
  if (!m.length) return [];
  return [{ kind: `Person: ${o.person.name}`, length: '-', delayNs: '-', relDb: m.map((x) => x.text).join(' | ') }];
}

/** Move a person's link packs' stored offsets after a pack was dragged: returns the new world pack positions for the person (for the tests). */
export { personPackPositions };
