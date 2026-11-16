// Which link the pointer is on, shared by the plan and the inventory list so each lights up what the other is pointing at.
// Not saved, not undoable and not part of the scene: it only says "this link is being looked at". No DOM.
let focusId = null;
const subs = new Set();

export const getLinkFocus = () => focusId;

/** setLinkFocus(id | null): notifies subscribers only when the value changes. */
export function setLinkFocus(id) {
  const next = id || null;
  if (next === focusId) return;
  focusId = next;
  for (const cb of [...subs]) cb(focusId);
}

/** subscribeLinkFocus(cb) -> unsubscribe. cb(linkId | null). */
export function subscribeLinkFocus(cb) { subs.add(cb); return () => subs.delete(cb); }

/** linkIdOfItem(scene, itemId) -> id of the link whose transmitter or receiver has this id, else null. */
export function linkIdOfItem(scene, itemId) {
  if (!itemId) return null;
  const l = ((scene && scene.links) || []).find((q) => q.tx.id === itemId || q.rx.id === itemId);
  return l ? l.id : null;
}
