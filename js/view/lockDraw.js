// Padlock badge drawn beside every position-locked item's main handle (shape, not colour, so it reads in greyscale).
import { isLocked, findLockable } from '../model/lock.js';
import { setLocked } from '../actions.js';

/** Draw a small padlock next to the first position handle of each locked item. `handles` are the frame's hit handles. */
export function drawLockBadges(ctx, th, scene, handles) {
  const seen = new Set();
  for (const hd of handles) {
    if (!hd.itemId || seen.has(hd.itemId) || /Rot$|^tilt|^zoneP|^branch/.test(hd.kind) || !isLocked(scene, hd.itemId)) continue;
    seen.add(hd.itemId);
    const x = hd.sx + 9, y = hd.sy - 14;
    ctx.save();
    ctx.fillStyle = th.paper; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(x, y - 3, 3.2, Math.PI, 0); ctx.stroke(); // shackle
    ctx.beginPath(); ctx.rect(x - 4.5, y - 3, 9, 7); ctx.fill(); ctx.stroke(); // body
    ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(x, y + 0.5, 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/** The L key: flip the position lock of the selected item and say so. */
export function toggleSelectionLock(store, announce) {
  const id = store.getSelection(), it = findLockable(store.getScene(), id);
  if (!it) return;
  const next = it.locked !== true;
  setLocked(store, id, next);
  announce?.(`${it.name || 'Item'} position ${next ? 'locked' : 'unlocked'}`, { key: 'lock', delay: 0 });
}
