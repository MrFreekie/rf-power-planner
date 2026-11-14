// "Walk all": plan a shared walk for every microphone link and every Intermod transmitter. Pure (no DOM).
//   planWalkAll(scene) -> { items: [{ linkId } | { imdId }], offset: {x,y,z} | undefined }
// IEM links are left out (their mobile end is the performer's bodypack, which Walk already handles). All items share one
// displacement, so the group moves together; the direction (left or right) is the one with more room on the stage.
export function planWalkAll(scene) {
  const items = [];
  const xs = [];
  for (const l of scene.links || []) {
    if (l.kind !== 'mic') continue;
    items.push({ linkId: l.id });
    xs.push(l.tx.pos.x);
  }
  const imd = scene.imd && scene.imd.enabled && Array.isArray(scene.imd.transmitters) ? scene.imd.transmitters : [];
  for (const t of imd) { items.push({ imdId: t.id }); xs.push(t.pos.x); }
  if (!items.length) return { items, offset: undefined };
  const W = scene.stage && scene.stage.width > 0 ? scene.stage.width : 0;
  const room = { right: W - Math.max(...xs), left: Math.min(...xs) };
  const want = 0.4 * W;
  const dir = room.right >= room.left ? 1 : -1;
  const dx = Math.min(want, dir === 1 ? room.right : room.left);
  // less than half a metre of room: no shared offset, startMultiWalk then mirrors each item across the stage
  return { items, offset: dx >= 0.5 ? { x: dir * dx, y: 0, z: 0 } : undefined };
}
