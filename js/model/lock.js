// Position lock: an optional boolean `locked` on any placeable item stops it being dragged or nudged on the plan and side views
// (so a rigged antenna is not knocked out of place). It never changes the RF maths. Pure: no DOM, no globals.

const KEYS = ['reflectors', 'platforms', 'overheadPanels', 'crowds', 'people', 'noiseSources'];

/** Every lockable item as { it, path }: link tx / rx ends, the placed-object lists and IMD transmitters. */
function* each(scene) {
  if (!scene) return;
  const links = scene.links || [];
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    if (l && l.tx) yield { it: l.tx, path: `links[${i}].tx` };
    if (l && l.rx) yield { it: l.rx, path: `links[${i}].rx` };
  }
  for (const k of KEYS) if (Array.isArray(scene[k])) for (let i = 0; i < scene[k].length; i++) yield { it: scene[k][i], path: `${k}[${i}]` };
  const tx = scene.imd && scene.imd.transmitters;
  if (Array.isArray(tx)) for (let i = 0; i < tx.length; i++) yield { it: tx[i], path: `imd.transmitters[${i}]` };
}

/** The lockable item with this id, else null. */
export function findLockable(scene, id) {
  if (!id) return null;
  for (const { it } of each(scene)) if (it && it.id === id) return it;
  return null;
}

/** True when the item with this id is position-locked. Unknown ids are not locked. */
export function isLocked(scene, id) {
  const it = findLockable(scene, id);
  return !!(it && it.locked === true);
}

/** Ids of every locked item. */
export function lockedIds(scene) {
  const out = [];
  for (const { it } of each(scene)) if (it && it.locked === true && it.id) out.push(it.id);
  return out;
}

/** Validation for validateScene: `locked`, when present, must be true or false. */
export function validateLocks(scene, errors) {
  for (const { it, path } of each(scene)) if (it && typeof it === 'object' && it.locked !== undefined && typeof it.locked !== 'boolean') errors.push(`${path}.locked must be true or false`);
}
